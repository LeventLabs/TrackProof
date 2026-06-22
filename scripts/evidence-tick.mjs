#!/usr/bin/env node
// One evidence "tick" for a PERSISTENT host: append new (paper) decisions to the demo agents'
// chains, re-anchor each chain on Base, and regenerate site/evidence.html. Schedule it with cron
// (see scripts/CRON.md). Reads are keyless; anchoring needs DEPLOYER_PRIVATE_KEY.
// Simulation / paper only — no real capital, no real-account orders.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseAnchorStore, BaseHeadRegistry } from "@trackproof/base";
import { BitgetMarketData } from "@trackproof/bitget";
import { anchorRun, commitHeads, formatEvidenceHtml, gatherEvidence, runAgents } from "@trackproof/demo-agents";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = process.env.TRACKPROOF_DEMO_HOME ?? join(repo, ".trackproof-demo");
const ANCHOR = process.env.TRACKPROOF_ANCHOR_ADDRESS ?? "0x290825Ee1124617649c527A2230881e63173519D";
const HEADREG = process.env.TRACKPROOF_HEAD_REGISTRY_ADDRESS ?? "0xf62aF702b7Ad52bD99de336f129736dEFa7b776e";
const pk = process.env.DEPLOYER_PRIVATE_KEY;
const source = new BitgetMarketData();

console.log(`[tick] ${new Date().toISOString()} — appending new decisions…`);
const runs = await runAgents({ baseDir: DEMO, source, fresh: false, lookbackMs: 3 * 3600_000 });
console.log(`[tick] emitted ${runs.map((r) => `${r.key}+${r.emitted}`).join(" ")}`);

if (pk) {
  const writer = new BaseAnchorStore({ anchorAddress: ANCHOR, privateKey: pk });
  for (const a of await anchorRun(writer, { baseDir: DEMO })) {
    console.log(`[tick] anchored ${a.key} block ${a.block} (${a.capsules} capsules)`);
  }
  const headWriter = new BaseHeadRegistry({ registryAddress: HEADREG, privateKey: pk });
  for (const h of await commitHeads(headWriter, { baseDir: DEMO })) {
    if (h.committed) console.log(`[tick] head ${h.key} → seq ${h.seq} committed on-chain`);
  }
} else {
  console.log("[tick] DEPLOYER_PRIVATE_KEY not set — skipped on-chain anchoring.");
}

const report = await gatherEvidence({
  baseDir: DEMO,
  source,
  anchorStore: new BaseAnchorStore({ anchorAddress: ANCHOR }),
  headRegistry: new BaseHeadRegistry({ registryAddress: HEADREG }),
});
writeFileSync(join(repo, "site", "evidence.html"), formatEvidenceHtml(report, { anchorContract: ANCHOR }));
console.log(
  `[tick] ${report.totals.capsules} capsules, ${report.totals.handoffs} handoffs, ` +
    `baseline ${report.baseline.allMet ? "ALL MET" : "incomplete"} — wrote site/evidence.html`,
);
