import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  anchorCapsules,
  appendCapsule,
  capsuleLeaf,
  computeInputsDigest,
  type AnchorStore,
  type Candle,
  type MarketDataSource,
  type SignedCapsule,
  type TradeDecisionBody,
} from "@trackproof/core";
import { granularityMs } from "@trackproof/bitget";
import {
  appendCapsuleToStore,
  lastCapsule,
  openStore,
  readChain,
  saveAnchor,
  type AgentStore,
} from "@trackproof/sdk";
import { DEMO_AGENTS, type DemoAgent, type Tier } from "./agents.js";
import { strategyHash, type Action } from "./strategies.js";

const HOUR_MS = 60 * 60 * 1000;

export interface RunnerConfig {
  /** Parent directory; each agent gets its own store at `<baseDir>/<key>/`. */
  baseDir: string;
  /** Live = BitgetMarketData (real public history). Offline/tests = FixtureMarketData. */
  source: MarketDataSource;
  /** Defaults to DEMO_AGENTS. */
  agents?: DemoAgent[];
  /** How far back to pull history (default ~26h ≈ 1,560 1-min candles). */
  lookbackMs?: number;
  /**
   * The newest decision must be at least this old so its outcome window has elapsed by the time
   * the evidence command verifies it (default 60 min > the 30-min replay horizon).
   */
  settleGuardMs?: number;
  /** Window slide step in candles (default 1 → maximum capsules from one fetch). */
  step?: number;
  /** Optional cap on capsules per agent (default: every qualifying window). */
  maxPerAgent?: number;
  /** Clear each agent's chain (but keep its persistent key) before emitting (default true). */
  fresh?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface AgentRunResult {
  key: string;
  name: string;
  tier: Tier;
  agentId: string;
  emitted: number;
  home: string;
}

/** Build, sign, hash-chain, and persist one trade_decision capsule. Simulation / paper only. */
function emitDecision(
  store: AgentStore,
  agent: DemoAgent,
  window: Candle[],
  action: Action,
  decisionTime: number,
): SignedCapsule {
  const windowStart = window[0]!.time;
  const windowEnd = window[window.length - 1]!.time;
  const body: TradeDecisionBody = {
    market_ref: {
      venue: "bitget",
      instrument: agent.instrument,
      decision_time: decisionTime,
      candles: { granularity: agent.granularity, window: [windowStart, windowEnd] },
    },
    inputs_digest: computeInputsDigest({ candles: window }),
    action,
    // Tier-2 only: pin the strategy + seed so a verifier can re-derive the action (R7.2).
    ...(agent.tier === "reproducible"
      ? { repro: { strategy_hash: strategyHash(agent.strategy), seed: agent.seed } }
      : {}),
    // Recorded as context — NEVER part of any proof (the notary boundary).
    attested: {
      reasoning_trace:
        `${agent.name} · ${agent.strategy.id}: ${action.side} ${action.size} ${agent.instrument} ` +
        `@ ${agent.granularity} (simulation / paper only)`,
    },
  };
  const capsule = appendCapsule(
    lastCapsule(store),
    { kind: "trade_decision", body, committed_at: decisionTime },
    store.keyPair.publicKeyHex,
    store.keyPair.privateKey,
  );
  appendCapsuleToStore(store, capsule);
  return capsule;
}

function resetChain(home: string): void {
  rmSync(join(home, "chain.jsonl"), { force: true });
  rmSync(join(home, "anchor.json"), { force: true });
}

/**
 * Emit decision capsules for each agent over real (or fixture) Bitget history. History is fetched
 * once per (instrument, granularity) and sliced into many decision windows, so >=1,000 capsules
 * cost only a handful of API calls. On-chain anchoring is a separate step (see `anchorRun`).
 */
export async function runAgents(config: RunnerConfig): Promise<AgentRunResult[]> {
  const now = config.now ?? (() => Date.now());
  const agents = config.agents ?? DEMO_AGENTS;
  const lookbackMs = config.lookbackMs ?? 26 * HOUR_MS;
  const settleGuardMs = config.settleGuardMs ?? HOUR_MS;
  const step = config.step ?? 1;
  const fresh = config.fresh ?? true;

  const historyCache = new Map<string, Candle[]>();
  const results: AgentRunResult[] = [];

  for (const agent of agents) {
    const cacheKey = `${agent.instrument}:${agent.granularity}`;
    let history = historyCache.get(cacheKey);
    if (!history) {
      const end = now();
      const fetched = await config.source.getCandles({
        instrument: agent.instrument,
        granularity: agent.granularity,
        startTime: end - lookbackMs,
        endTime: end,
      });
      history = [...fetched].sort((a, b) => a.time - b.time);
      historyCache.set(cacheKey, history);
    }

    const store = openStore(join(config.baseDir, agent.key));
    if (fresh) resetChain(store.home);

    // Append-only continuation: when not starting fresh, skip windows already covered by the
    // agent's existing chain, so a recurring tick adds only genuinely new decisions (no duplicates).
    const coveredUntil = fresh
      ? -Infinity
      : readChain(store).reduce((max, c) => {
          if (c.kind !== "trade_decision") return max;
          const t = (c.body as TradeDecisionBody).market_ref.decision_time;
          return t > max ? t : max;
        }, -Infinity);

    const interval = granularityMs(agent.granularity);
    const latestDecisionTime = now() - settleGuardMs;
    let emitted = 0;
    for (let i = 0; i + agent.windowSize <= history.length; i += step) {
      if (config.maxPerAgent !== undefined && emitted >= config.maxPerAgent) break;
      const window = history.slice(i, i + agent.windowSize);
      const decisionTime = window[window.length - 1]!.time + interval;
      if (decisionTime > latestDecisionTime) break; // too recent — its outcome wouldn't settle yet
      if (decisionTime <= coveredUntil) continue; // already covered by the existing chain (no dup)
      const action = agent.strategy.fn(window, agent.seed);
      if (!action) continue;
      emitDecision(store, agent, window, action, decisionTime);
      emitted++;
    }

    results.push({
      key: agent.key,
      name: agent.name,
      tier: agent.tier,
      agentId: store.keyPair.publicKeyHex,
      emitted,
      home: store.home,
    });
  }

  return results;
}

export interface AnchorRunConfig {
  baseDir: string;
  agents?: DemoAgent[];
}

export interface AgentAnchorResult {
  key: string;
  agentId: string;
  /** The anchored Merkle root (hex). */
  root: string;
  /** On-chain block/sequence of the anchoring tx. */
  block: number;
  /** ms; the on-chain commitment timestamp (G2). */
  timestamp: number;
  capsules: number;
  proofs: number;
}

/**
 * Merkle-root each agent's full chain and anchor the root via `anchorStore` (live `BaseAnchorStore`
 * in production, `MemoryAnchorStore` in tests), saving per-leaf inclusion proofs to the agent's
 * store. One root per agent yields >=1 verified inclusion proof per agent (R11.2).
 *
 * Note (honest G2 boundary): capsules emitted over *historical* windows are anchored after their
 * outcomes already printed, so they are correctly **not certifiable** (R4.4: anchor_time <
 * outcome_start fails). They still prove G1 (authentic data), G3 (complete chain), and G2 inclusion.
 * Genuine "committed before outcome" certifiability is a real-time property (the anchoring cron).
 */
export async function anchorRun(
  anchorStore: AnchorStore,
  config: AnchorRunConfig,
): Promise<AgentAnchorResult[]> {
  const agents = config.agents ?? DEMO_AGENTS;
  const results: AgentAnchorResult[] = [];
  for (const agent of agents) {
    const store = openStore(join(config.baseDir, agent.key));
    const chain = readChain(store);
    if (chain.length === 0) continue;
    const { record, proofs } = await anchorCapsules(anchorStore, chain);
    saveAnchor(store, { root: record.root, proofs: Object.fromEntries(proofs) });
    results.push({
      key: agent.key,
      agentId: store.keyPair.publicKeyHex,
      root: record.root,
      block: record.block,
      timestamp: record.timestamp,
      capsules: chain.length,
      proofs: proofs.size,
    });
  }
  return results;
}

export interface HeadRegistryLike {
  getHead(agentId: string): Promise<{ seq: number; headLeaf: string } | null>;
  commitHead(agentId: string, seq: number, headLeaf: string): Promise<void>;
}

export interface HeadCommitResult {
  key: string;
  agentId: string;
  seq: number;
  committed: boolean;
}

/**
 * Commit each agent's latest chain head (seq + leaf) to the on-chain `HeadRegistry`, so a verifier can
 * reject a withheld tail (tail-truncation). Skips an agent whose on-chain head is already current.
 */
export async function commitHeads(registry: HeadRegistryLike, config: AnchorRunConfig): Promise<HeadCommitResult[]> {
  const agents = config.agents ?? DEMO_AGENTS;
  const results: HeadCommitResult[] = [];
  for (const agent of agents) {
    const store = openStore(join(config.baseDir, agent.key));
    const chain = readChain(store);
    const last = chain[chain.length - 1];
    const agentId = store.keyPair.publicKeyHex;
    if (!last) {
      results.push({ key: agent.key, agentId, seq: 0, committed: false });
      continue;
    }
    const current = await registry.getHead(agentId);
    if (current && current.seq >= last.seq) {
      results.push({ key: agent.key, agentId, seq: last.seq, committed: false }); // already current
      continue;
    }
    await registry.commitHead(agentId, last.seq, capsuleLeaf(last));
    results.push({ key: agent.key, agentId, seq: last.seq, committed: true });
  }
  return results;
}
