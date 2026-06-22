import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEvidenceHtml } from "./report-html.js";
import type { EvidenceReport } from "./evidence.js";

function fakeReport(): EvidenceReport {
  return {
    generatedAt: Date.UTC(2026, 5, 21),
    agents: [
      { key: "breakout", name: "Breakout Bo", tier: "reproducible", agentId: "ab".repeat(32), capsules: 327, chainOk: true, enrolledAt: Date.UTC(2026, 5, 1), anchored: true, anchorRoot: "cd".repeat(32), anchorBlock: 43063818, inclusionVerified: true, headVerified: true, tier2Badge: true, pnlSeries: [1, 2, 1.5, 3, 4], handoffs: 3, reputation: 5000, anchoredAt: Date.UTC(2026, 5, 22) },
      { key: "momentum", name: "Momentum Mara", tier: "notarized", agentId: "ef".repeat(32), capsules: 750, chainOk: true, enrolledAt: Date.UTC(2026, 5, 2), anchored: true, anchorRoot: "12".repeat(32), anchorBlock: 43063816, inclusionVerified: true, headVerified: true, tier2Badge: false, pnlSeries: [-1, -2, -1, -3], handoffs: 3, reputation: 1000, anchoredAt: Date.UTC(2026, 5, 22) },
    ],
    fakes: [
      { key: "fab", claim: "+412% ROI (fabricated prices)", failureClass: "G1", caught: 4, detail: "4/4 capsules failed G1" },
      { key: "del", claim: "100% win rate <deleted loser>", failureClass: "G3", caught: 1, detail: "chain breaks after seq 2" },
    ],
    handoffs: [
      { buyer: "Breakout Bo", seller: "Momentum Mara", price: "5", payment_ref: "stub:abc123def456abc123def456" },
      { buyer: "Momentum Mara", seller: "Reversion Rey", price: "5", payment_ref: "stub:7890abcdef7890abcdef00" },
    ],
    totals: { agents: 2, capsules: 1077, sampled: 40, verifiedPassed: 40, settled: 40, anchoredAgents: 2, inclusionAgents: 2, headsVerified: 2, tier2Agents: 1, fakeCatches: 5, handoffs: 6 },
    baseline: { capsules: true, verifications: false, fakeCatches: true, inclusionPerAgent: true, heads: true, handoffs: true, allMet: false },
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
  // ranked by reputation (Breakout 5000 > Momentum 1000), NOT by capsule count (Momentum 750 > Breakout 327)
  assert.ok(html.indexOf("Breakout Bo") < html.indexOf("Momentum Mara"));
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

test("formatEvidenceHtml renders the MemorySlice handoffs panel + a challenge section", () => {
  const html = formatEvidenceHtml(fakeReport());
  assert.match(html, /MemorySlice handoffs/);
  assert.match(html, /stub:abc123def456/); // a handoff payment_ref
  assert.match(html, /Challenge any record/);
  assert.match(html, /verify --last --with-anchor/);
  assert.equal(/<script\b/i.test(html), false);
});
