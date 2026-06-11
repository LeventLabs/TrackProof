#!/usr/bin/env node
import { BitgetMarketData } from "@trackproof/bitget";
import { openStore, readChain, TrackProof } from "@trackproof/sdk";
import { verifyCapsule, verifyChain, type TradeDecisionBody } from "@trackproof/core";
import { parseArgs } from "./args.js";

const HOME = process.env.TRACKPROOF_HOME ?? ".trackproof";

const HELP = `trackproof — verifiable track records for AI trading agents

Usage:
  trackproof emit   --instrument <SYMBOL> [--granularity 1min] [--demo]
  trackproof replay [--last]                 Local G1 + G3 verification
  trackproof verify [--last] [--with-anchor]
  trackproof --help

Simulation / paper only. Market history uses Bitget's public endpoints (no API key needed).`;

const FLAG = (v: string | boolean | undefined, fallback: string): string =>
  typeof v === "string" ? v : fallback;

async function cmdEmit(flags: Record<string, string | boolean>): Promise<void> {
  const instrument = FLAG(flags.instrument, "BTCUSDT");
  const granularity = FLAG(flags.granularity, "1min");
  const source = new BitgetMarketData();

  const end = Date.now();
  const candles = await source.getCandles({ instrument, granularity, startTime: end - 30 * 60_000, endTime: end });
  if (candles.length < 2) {
    throw new Error(`not enough candles for ${instrument} (${candles.length}) — try a more liquid symbol or wider window`);
  }
  // Drop the last candle: it is likely still open. Capsules pin closed candles only (R2.4).
  const closed = candles.slice(0, -1);

  const capsule = new TrackProof({ home: HOME }).emit({
    instrument,
    granularity,
    candles: closed,
    action: { side: "long", size: "1", type: "market" },
    reasoning: flags.demo ? "demo: sample market long" : undefined,
  });

  const body = capsule.body as TradeDecisionBody;
  console.log("Emitted capsule (simulation / paper only):");
  console.log(`  agent_id      ${capsule.agent_id.slice(0, 16)}…`);
  console.log(`  seq           ${capsule.seq}`);
  console.log(`  instrument    ${instrument} (${granularity})`);
  console.log(`  inputs        ${closed.length} closed candles`);
  console.log(`  inputs_digest ${body.inputs_digest.slice(0, 16)}…`);
  console.log(`  action        ${body.action.side} ${body.action.size} ${body.action.type}`);
  console.log(`Stored in ${HOME}/. Run \`trackproof replay --last\` to verify it.`);
}

async function cmdVerify(flags: Record<string, string | boolean>, withAnchor: boolean): Promise<void> {
  const chain = readChain(openStore(HOME));
  if (chain.length === 0) {
    console.log("No capsules yet — run `trackproof emit` first.");
    return;
  }
  const target = chain[chain.length - 1]!;
  const g1 = await verifyCapsule(target, new BitgetMarketData());
  const g3 = verifyChain(chain);

  console.log(`Verifying last capsule (seq ${target.seq}, ${chain.length} in chain):`);
  const failReason = g1.verdict !== "PASSED" && g1.reason ? ` — ${g1.reason}` : "";
  console.log(`  G1 (real data + replay): ${g1.verdict}${failReason}`);
  if (g1.kind === "trade_decision" && g1.verdict === "PASSED") {
    if (g1.outcome === "settled" && g1.fill?.filled) {
      console.log(`     fill ${g1.fill.fillPrice}   P&L ${g1.pnl} (descriptive, not execution-realistic)`);
    } else {
      console.log(`     outcome PENDING — window not yet complete; replay later for final P&L`);
    }
  }
  console.log(`  G3 (chain complete):     ${g3.ok ? "yes" : `NO — broken at seq ${g3.firstBadSeq}`}`);
  console.log(
    `  G2 (on-chain commitment): ${withAnchor ? "not available yet — pending the anchor layer" : "skipped (use --with-anchor once available)"}`,
  );
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.help || command === "" || command === "help") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "emit":
      return cmdEmit(flags);
    case "replay":
      return cmdVerify(flags, false);
    case "verify":
      return cmdVerify(flags, Boolean(flags["with-anchor"]));
    case "install":
      console.log("`install` (skill + MCP server) ships with the distribution package — coming soon.");
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
