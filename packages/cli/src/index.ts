#!/usr/bin/env node
import { BaseAnchorStore } from "@trackproof/base";
import { BitgetMarketData } from "@trackproof/bitget";
import { anchorCapsules, capsuleLeaf, verifyCapsule, verifyChain, verifyCommitment, type TradeDecisionBody } from "@trackproof/core";
import { loadAnchor, openStore, readChain, saveAnchor, TrackProof } from "@trackproof/sdk";
import { INSTALL_TARGETS, installSkill, isInstallTarget, type InstallTarget } from "@trackproof/skill";
import { anchorRun, formatEvidenceReport, gatherEvidence, runAgents } from "@trackproof/demo-agents";
import { parseArgs } from "./args.js";

const HOME = process.env.TRACKPROOF_HOME ?? ".trackproof";
const ANCHOR_ADDRESS = (process.env.TRACKPROOF_ANCHOR_ADDRESS ??
  "0x290825Ee1124617649c527A2230881e63173519D") as `0x${string}`;
const DEMO_HOME = process.env.TRACKPROOF_DEMO_HOME ?? ".trackproof-demo";

const HELP = `trackproof — verifiable track records for AI trading agents

Usage:
  trackproof emit    --instrument <SYMBOL> [--granularity 1min] [--demo]
  trackproof anchor                            Merkle-root the chain and anchor it on Base
  trackproof replay  [--last]                  Local G1 + G3 verification
  trackproof verify  [--last] [--with-anchor]  Adds G2 (on-chain commitment) with --with-anchor
  trackproof demo    [--no-anchor]             Run the 3 demo agents over live history, then anchor on Base
  trackproof evidence                          Print verifiable usage evidence (capsules, fakes, anchors)
  trackproof install --target claude|codex|openclaw
  trackproof --help

Simulation / paper only. Market history uses Bitget's public endpoints (no API key needed).
Anchoring (write) needs DEPLOYER_PRIVATE_KEY; verification reads are keyless.`;

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

  if (!withAnchor) {
    console.log("  G2 (on-chain commitment): skipped (use --with-anchor)");
    return;
  }
  const anchor = loadAnchor(openStore(HOME));
  if (!anchor) {
    console.log("  G2 (on-chain commitment): no local anchor — run `trackproof anchor` first");
    return;
  }
  const proof = anchor.proofs[capsuleLeaf(target)];
  if (!proof) {
    console.log("  G2 (on-chain commitment): this capsule is not in the latest anchor — run `trackproof anchor`");
    return;
  }
  const record = await new BaseAnchorStore({ anchorAddress: ANCHOR_ADDRESS }).getByRoot(anchor.root);
  if (!record) {
    console.log("  G2 (on-chain commitment): anchored root not found on-chain yet");
    return;
  }
  const outcomeStart = g1.kind === "trade_decision" ? g1.outcomeStart : undefined;
  const commitment = verifyCommitment(target, proof, record, outcomeStart);
  console.log(
    `  G2 (on-chain commitment): included=${commitment.included} certifiable=${commitment.certifiable}` +
      `${commitment.reason ? ` — ${commitment.reason}` : ""} (Base block ${record.block})`,
  );
}

function cmdInstall(flags: Record<string, string | boolean>): void {
  const requested = FLAG(flags.target, "claude")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const invalid = requested.filter((t) => !isInstallTarget(t));
  if (invalid.length > 0) {
    console.error(`Unknown --target: ${invalid.join(", ")}. Valid: ${INSTALL_TARGETS.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const installed = installSkill(requested as InstallTarget[]);
  console.log("Installed the TrackProof skill:");
  for (const path of installed) console.log(`  ${path}`);
  console.log("(MCP server registration ships with the MCP package — coming soon.)");
}

async function cmdAnchor(): Promise<void> {
  const store = openStore(HOME);
  const chain = readChain(store);
  if (chain.length === 0) {
    console.log("No capsules to anchor — run `trackproof emit` first.");
    return;
  }
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set DEPLOYER_PRIVATE_KEY (a funded Base Sepolia key) to anchor.");
    process.exitCode = 1;
    return;
  }
  const anchorStore = new BaseAnchorStore({ anchorAddress: ANCHOR_ADDRESS, privateKey });
  console.log(`Anchoring ${chain.length} capsules to Base (${ANCHOR_ADDRESS})…`);
  const { record, proofs } = await anchorCapsules(anchorStore, chain);
  saveAnchor(store, { root: record.root, proofs: Object.fromEntries(proofs) });
  console.log(`Anchored root ${record.root.slice(0, 16)}… at Base block ${record.block} (ts ${record.timestamp}).`);
  console.log(`Saved ${proofs.size} inclusion proofs to ${HOME}/anchor.json.`);
}

async function cmdDemo(flags: Record<string, string | boolean>): Promise<void> {
  const source = new BitgetMarketData();
  const num = (v: string | boolean | undefined): number | undefined =>
    typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  const lookbackHours = num(flags["lookback-hours"]);
  const maxPerAgent = num(flags["max-per-agent"]);
  const step = num(flags.step);

  console.log("Running the demo agents over live Bitget history (simulation / paper only)…");
  const runs = await runAgents({
    baseDir: DEMO_HOME,
    source,
    ...(lookbackHours !== undefined ? { lookbackMs: lookbackHours * 60 * 60 * 1000 } : {}),
    ...(maxPerAgent !== undefined ? { maxPerAgent } : {}),
    ...(step !== undefined ? { step } : {}),
  });
  let total = 0;
  for (const r of runs) {
    total += r.emitted;
    console.log(`  ${r.name.padEnd(16)} ${String(r.emitted).padStart(5)} capsules  [${r.tier}]`);
  }
  console.log(`Emitted ${total} capsules across ${runs.length} agents into ${DEMO_HOME}/.`);

  if (flags["no-anchor"]) {
    console.log("Skipped anchoring (--no-anchor). Omit the flag to anchor each chain on Base.");
    return;
  }
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("Set DEPLOYER_PRIVATE_KEY (a funded Base Sepolia key) to anchor, or pass --no-anchor.");
    process.exitCode = 1;
    return;
  }
  const anchorStore = new BaseAnchorStore({ anchorAddress: ANCHOR_ADDRESS, privateKey });
  console.log(`Anchoring each agent's chain on Base (${ANCHOR_ADDRESS})…`);
  for (const a of await anchorRun(anchorStore, { baseDir: DEMO_HOME })) {
    console.log(`  ${a.key.padEnd(12)} root ${a.root.slice(0, 16)}… block ${a.block} (${a.capsules} capsules, ${a.proofs} proofs)`);
  }
  console.log("Done. Run `trackproof evidence` to print the verifiable usage evidence.");
}

async function cmdEvidence(): Promise<void> {
  const source = new BitgetMarketData();
  const anchorStore = new BaseAnchorStore({ anchorAddress: ANCHOR_ADDRESS });
  const report = await gatherEvidence({ baseDir: DEMO_HOME, source, anchorStore });
  console.log(formatEvidenceReport(report));
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
    case "anchor":
      return cmdAnchor();
    case "demo":
      return cmdDemo(flags);
    case "evidence":
      return cmdEvidence();
    case "install":
      return cmdInstall(flags);
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
