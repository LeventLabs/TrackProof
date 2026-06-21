import { join } from "node:path";
import {
  capsuleLeaf,
  verifyCapsule,
  verifyChain,
  verifyInclusion,
  type AnchorStore,
  type MarketDataSource,
  type SignedCapsule,
} from "@trackproof/core";
import { loadAnchor, openStore, readChain } from "@trackproof/sdk";
import { DEMO_AGENTS, type DemoAgent, type Tier } from "./agents.js";
import { seededFakes, type FailureClass, type FakeRecord } from "./fakes.js";
import { rederiveChain } from "./tier2.js";

export interface EvidenceConfig {
  /** Parent dir of the per-agent stores (where the runner wrote chains + anchors). */
  baseDir: string;
  /** Live BitgetMarketData or the offline FixtureMarketData. */
  source: MarketDataSource;
  agents?: DemoAgent[];
  /** If given, on-chain inclusion is checked against it (live BaseAnchorStore). */
  anchorStore?: AnchorStore;
  /** Total G1 re-verification sample across agents (default 60 — keeps live API calls bounded). */
  verifySample?: number;
  /** Per-agent Tier-2 re-derivation sample (default 20). */
  tier2Sample?: number;
  /** Defaults to the seeded fakes. */
  fakes?: FakeRecord[];
}

export interface AgentEvidence {
  key: string;
  name: string;
  tier: Tier;
  agentId: string;
  capsules: number;
  chainOk: boolean;
  firstBadSeq?: number;
  enrolledAt?: number;
  anchored: boolean;
  anchorRoot?: string;
  anchorBlock?: number;
  inclusionVerified: boolean;
  tier2Badge: boolean;
  /** Cumulative mark-to-market P&L over the sampled settled trades, in chain order (descriptive). */
  pnlSeries: number[];
}

export interface FakeEvidence {
  key: string;
  claim: string;
  failureClass: FailureClass;
  caught: number;
  detail: string;
}

export interface EvidenceReport {
  generatedAt: number;
  agents: AgentEvidence[];
  fakes: FakeEvidence[];
  totals: {
    agents: number;
    capsules: number;
    sampled: number;
    verifiedPassed: number;
    settled: number;
    anchoredAgents: number;
    inclusionAgents: number;
    tier2Agents: number;
    fakeCatches: number;
  };
  baseline: {
    capsules: boolean;
    verifications: boolean;
    fakeCatches: boolean;
    inclusionPerAgent: boolean;
    allMet: boolean;
  };
}

/** Up to `n` evenly-spaced elements (deterministic), so a sample spans the whole chain. */
function sample<T>(arr: T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= arr.length) return arr;
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]!);
  return out;
}

/**
 * Aggregate the verifiable-usage evidence (R11.2) across the demo agents + seeded fakes:
 * capsule counts, a sampled G1 re-verification, on-chain inclusion, the Tier-2 badge, and
 * fake catches — then check the result against the baseline. Simulation / paper only.
 */
export async function gatherEvidence(config: EvidenceConfig): Promise<EvidenceReport> {
  const agents = config.agents ?? DEMO_AGENTS;
  const verifySample = config.verifySample ?? 60;
  const tier2Sample = config.tier2Sample ?? 20;
  const fakes = config.fakes ?? seededFakes();
  const perAgentVerify = Math.ceil(verifySample / Math.max(1, agents.length));

  const agentReports: AgentEvidence[] = [];
  let totalCapsules = 0;
  let sampled = 0;
  let verifiedPassed = 0;
  let settled = 0;

  for (const agent of agents) {
    const store = openStore(join(config.baseDir, agent.key));
    const chain = readChain(store);
    totalCapsules += chain.length;
    const chk = verifyChain(chain);

    const pnlSeries: number[] = [];
    let cumulativePnl = 0;
    for (const cap of sample(chain, perAgentVerify)) {
      const result = await verifyCapsule(cap, config.source);
      sampled++;
      if (result.verdict === "PASSED") verifiedPassed++;
      if (result.kind === "trade_decision" && result.outcome === "settled") {
        settled++;
        if (result.pnl !== undefined) {
          cumulativePnl += Number(result.pnl);
          pnlSeries.push(Number(cumulativePnl.toFixed(6)));
        }
      }
    }

    let anchored = false;
    let inclusionVerified = false;
    let anchorRoot: string | undefined;
    let anchorBlock: number | undefined;
    const anchorFile = loadAnchor(store);
    if (anchorFile) {
      anchorRoot = anchorFile.root;
      if (config.anchorStore) {
        const record = await config.anchorStore.getByRoot(anchorFile.root);
        if (record) {
          anchored = true;
          anchorBlock = record.block;
          const target = chain.find((c) => anchorFile.proofs[capsuleLeaf(c)] !== undefined);
          if (target) {
            inclusionVerified = verifyInclusion(target, anchorFile.proofs[capsuleLeaf(target)]!, record);
          }
        }
      }
    }

    const t2 = await rederiveChain(sample(chain, tier2Sample), config.source);

    agentReports.push({
      key: agent.key,
      name: agent.name,
      tier: agent.tier,
      agentId: store.keyPair.publicKeyHex,
      capsules: chain.length,
      chainOk: chk.ok,
      firstBadSeq: chk.firstBadSeq,
      enrolledAt: chain[0]?.committed_at,
      anchored,
      anchorRoot,
      anchorBlock,
      inclusionVerified,
      tier2Badge: t2.badge,
      pnlSeries,
    });
  }

  const fakeReports: FakeEvidence[] = [];
  let fakeCatches = 0;
  for (const fake of fakes) {
    if (fake.failureClass === "G3") {
      const broken = !verifyChain(fake.capsules).ok;
      const caught = broken ? 1 : 0;
      fakeCatches += caught;
      fakeReports.push({
        key: fake.key,
        claim: fake.claim,
        failureClass: "G3",
        caught,
        detail: broken ? `chain breaks after the deleted seq ${fake.removedSeq}` : "chain intact (unexpected)",
      });
    } else {
      let caught = 0;
      for (const cap of fake.capsules) {
        if ((await verifyCapsule(cap, config.source)).verdict !== "PASSED") caught++;
      }
      fakeCatches += caught;
      fakeReports.push({
        key: fake.key,
        claim: fake.claim,
        failureClass: "G1",
        caught,
        detail: `${caught}/${fake.capsules.length} capsules failed G1 (FAILED_DATA)`,
      });
    }
  }

  const inclusionAgents = agentReports.filter((a) => a.inclusionVerified).length;
  const baseline = {
    capsules: totalCapsules >= 1000 && agents.length >= 3,
    verifications: verifiedPassed >= 50,
    fakeCatches: fakeCatches >= 3,
    inclusionPerAgent: agentReports.length > 0 && inclusionAgents === agentReports.length,
  };

  return {
    generatedAt: Date.now(),
    agents: agentReports,
    fakes: fakeReports,
    totals: {
      agents: agents.length,
      capsules: totalCapsules,
      sampled,
      verifiedPassed,
      settled,
      anchoredAgents: agentReports.filter((a) => a.anchored).length,
      inclusionAgents,
      tier2Agents: agentReports.filter((a) => a.tier2Badge).length,
      fakeCatches,
    },
    baseline: { ...baseline, allMet: Object.values(baseline).every(Boolean) },
  };
}

function yn(ok: boolean): string {
  return ok ? "PASS" : "FAIL";
}

/** Render an EvidenceReport as a terminal-friendly block a judge can read in seconds. */
export function formatEvidenceReport(r: EvidenceReport): string {
  const L: string[] = [];
  L.push("TrackProof — verifiable usage evidence (simulation / paper only)");
  L.push(`generated ${new Date(r.generatedAt).toISOString()}`);
  L.push("");
  L.push(`Agents (${r.totals.agents}) — ${r.totals.capsules} capsules total:`);
  for (const a of r.agents) {
    const bits = [
      `${a.capsules} capsules`,
      a.chainOk ? "chain OK (G3)" : `chain BROKEN at seq ${a.firstBadSeq}`,
      a.anchored ? `anchored (block ${a.anchorBlock}) inclusion ${a.inclusionVerified ? "✓" : "✗"}` : "not anchored",
      a.tier === "reproducible" ? `Tier-2 ${a.tier2Badge ? "✓" : "✗"}` : "Tier-1",
    ];
    L.push(`  ${a.name.padEnd(16)} ${bits.join(" · ")}`);
  }
  L.push("");
  L.push(
    `Verification sample: ${r.totals.verifiedPassed}/${r.totals.sampled} PASSED (G1), ${r.totals.settled} settled`,
  );
  L.push(`On-chain anchors: ${r.totals.anchoredAgents}/${r.totals.agents} agents · inclusion verified ${r.totals.inclusionAgents}/${r.totals.agents}`);
  L.push(`Tier-2 reproducible: ${r.totals.tier2Agents} agent(s)`);
  L.push("");
  L.push(`Fake records caught (${r.totals.fakeCatches} total):`);
  for (const f of r.fakes) {
    L.push(`  [${f.failureClass}] ${f.claim} — ${f.detail} ${f.caught > 0 ? "✓ caught" : "✗ MISSED"}`);
  }
  L.push("");
  L.push("Baseline (R11.2):");
  L.push(`  >=1,000 capsules / >=3 agents : ${yn(r.baseline.capsules)} (${r.totals.capsules} / ${r.totals.agents})`);
  L.push(`  >=50 verifications            : ${yn(r.baseline.verifications)} (${r.totals.verifiedPassed})`);
  L.push(`  >=3 fake catches              : ${yn(r.baseline.fakeCatches)} (${r.totals.fakeCatches})`);
  L.push(`  >=1 inclusion proof / agent   : ${yn(r.baseline.inclusionPerAgent)} (${r.totals.inclusionAgents}/${r.totals.agents})`);
  L.push(`  ALL MET                       : ${r.baseline.allMet ? "YES ✓" : "NO"}`);
  L.push("");
  L.push("P&L is descriptive, not execution-realistic. Not investment advice.");
  return L.join("\n");
}
