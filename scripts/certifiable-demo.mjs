#!/usr/bin/env node
// Demonstrate a genuinely CERTIFIABLE capsule (the real-time G2 path): emit a decision now, anchor it
// on Base BEFORE its outcome window opens (anchor.timestamp < decision_time + one candle), and verify
// `certifiable = true`. This is what real-time operation produces; the bulk evidence run backfills
// historical decisions and is inclusion-proven only (their outcomes already printed). Paper only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseAnchorStore } from "@trackproof/base";
import { BitgetMarketData, granularityMs } from "@trackproof/bitget";
import { anchorCapsules, capsuleLeaf, verifyCommitment } from "@trackproof/core";
import { TrackProof } from "@trackproof/sdk";

const ANCHOR = process.env.TRACKPROOF_ANCHOR_ADDRESS ?? "0x290825Ee1124617649c527A2230881e63173519D";
const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) throw new Error("set DEPLOYER_PRIVATE_KEY (a funded Base Sepolia key) to anchor");

const useColor = (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR)) && !process.env.NO_COLOR;
const bool = (b) => (useColor ? `\x1b[1;${b ? "32" : "31"}m${b}\x1b[0m` : String(b));

const instrument = "BTCUSDT";
const granularity = "1min";
const source = new BitgetMarketData();
const end = Date.now();
const candles = await source.getCandles({ instrument, granularity, startTime: end - 30 * 60_000, endTime: end });
const closed = candles.slice(0, -1);

// Decide *now*: the outcome window opens one candle in the future, so anchoring now is provably before it.
const decisionTime = Date.now();
const outcomeStart = decisionTime + granularityMs(granularity);

const home = mkdtempSync(join(tmpdir(), "cert-"));
try {
  const capsule = new TrackProof({ home }).emit({
    instrument,
    granularity,
    candles: closed,
    decisionTime,
    action: { side: "long", size: "1", type: "market" },
  });

  // Anchor immediately (before outcome_start).
  const store = new BaseAnchorStore({ anchorAddress: ANCHOR, privateKey: pk });
  const { record, proofs } = await anchorCapsules(store, [capsule]);

  const marginS = (outcomeStart - record.timestamp) / 1000;
  console.log(`decision_time : ${new Date(decisionTime).toISOString()}`);
  console.log(`outcome_start : ${new Date(outcomeStart).toISOString()}  (decision + one ${granularity} candle)`);
  console.log(`anchored at   : ${new Date(record.timestamp).toISOString()}  (Base block ${record.block})`);
  console.log(`anchored BEFORE outcome_start? ${bool(record.timestamp < outcomeStart)}  (margin ${marginS.toFixed(0)}s)`);

  const proof = proofs.get(capsuleLeaf(capsule)) ?? [];
  const c = verifyCommitment(capsule, proof, record, outcomeStart);
  console.log(`G2 commitment : included=${bool(c.included)} certifiable=${bool(c.certifiable)}${c.reason ? ` (${c.reason})` : ""}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
