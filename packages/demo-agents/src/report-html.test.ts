import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEvidenceHtml } from "./report-html.js";
import type { EvidenceReport } from "./evidence.js";

function fakeReport(): EvidenceReport {
  return {
    generatedAt: Date.UTC(2026, 5, 21),
    agents: [
      { key: "breakout", name: "Breakout Bo", tier: "reproducible", agentId: "ab".repeat(32), capsules: 327, chainOk: true, enrolledAt: Date.UTC(2026, 5, 1), anchored: true, anchorRoot: "cd".repeat(32), anchorBlock: 43063818, inclusionVerified: true, tier2Badge: true, pnlSeries: [1, 2, 1.5, 3, 4], handoffs: 3 },
      { key: "momentum", name: "Momentum Mara", tier: "notarized", agentId: "ef".repeat(32), capsules: 750, chainOk: true, enrolledAt: Date.UTC(2026, 5, 2), anchored: true, anchorRoot: "12".repeat(32), anchorBlock: 43063816, inclusionVerified: true, tier2Badge: false, pnlSeries: [-1, -2, -1, -3], handoffs: 3 },
    ],
    fakes: [
      { key: "fab", claim: "+412% ROI (fabricated prices)", failureClass: "G1", caught: 4, detail: "4/4 capsules failed G1" },
      { key: "del", claim: "100% win rate <deleted loser>", failureClass: "G3", caught: 1, detail: "chain breaks after seq 2" },
    ],
    totals: { agents: 2, capsules: 1077, sampled: 40, verifiedPassed: 40, settled: 40, anchoredAgents: 2, inclusionAgents: 2, tier2Agents: 1, fakeCatches: 5, handoffs: 6 },
    baseline: { capsules: true, verifications: false, fakeCatches: true, inclusionPerAgent: true, handoffs: true, allMet: false },
  };
}

test("formatEvidenceHtml renders a self-contained page", () => {
  const html = formatEvidenceHtml(fakeReport(), { anchorContract: "0xAnChOr" });
  assert.match(html, /^<!doctype html>/);
  // no scripts or external resources — must open from file:// offline
  assert.equal(/<script\b/i.test(html), false);
  assert.equal(/\ssrc=|@import|https?:\/\/\S+\.(?:css|js)\b/i.test(html), false);
});

test("formatEvidenceHtml ranks by capsules, escapes data, and links on-chain", () => {
  const html = formatEvidenceHtml(fakeReport(), { anchorContract: "0xAnChOr" });
  // ranked desc → Momentum (750) appears before Breakout (327)
  assert.ok(html.indexOf("Momentum Mara") < html.indexOf("Breakout Bo"));
  // HTML-escapes a hostile claim
  assert.match(html, /100% win rate &lt;deleted loser&gt;/);
  // on-chain links + disclaimers + badges
  assert.match(html, /address\/0xAnChOr/);
  assert.match(html, /block\/43063816/);
  assert.match(html, /not investment advice/i);
  assert.match(html, /Tier-2 reproducible ✓/);
});

test("formatEvidenceHtml draws P&L sparklines (green up / red down), still no script", () => {
  const html = formatEvidenceHtml(fakeReport());
  assert.match(html, /<polyline points=/);
  assert.match(html, /<svg class="spark ok"/); // Breakout ends positive
  assert.match(html, /<svg class="spark bad"/); // Momentum ends negative
  assert.equal(/<script\b/i.test(html), false);
});
