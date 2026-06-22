import { STRATEGIES, type StrategySpec } from "./strategies.js";

/** Tier-1 = notarized (every agent). Tier-2 = strategy-reproducible (exactly one agent). */
export type Tier = "notarized" | "reproducible";

export interface DemoAgent {
  /** Stable key; also the agent's store sub-directory name. */
  key: string;
  /** Human display name for the leaderboard. */
  name: string;
  /** "notarized" (Tier-1) for all; exactly ONE agent is "reproducible" (Tier-2), never generalized. */
  tier: Tier;
  /** The pinned deterministic strategy this agent runs. */
  strategy: StrategySpec;
  /** The agent's fixed seed — part of the Tier-2 `repro` contract for the reproducible agent. */
  seed: string;
  instrument: string;
  granularity: string;
  /** Decision window length, in candles. */
  windowSize: number;
}

/**
 * The three demo agents. Momentum + Breakout trade BTCUSDT (so they share one history fetch);
 * Reversion trades ETHUSDT. Only Breakout is Tier-2 (reproducible) — the others are notarized
 * Tier-1, which is the honest default for non-deterministic / LLM-style agents.
 */
export const DEMO_AGENTS: DemoAgent[] = [
  {
    key: "momentum",
    name: "Momentum Mara",
    tier: "notarized",
    strategy: STRATEGIES.momentum,
    seed: "momentum-v1",
    instrument: "BTCUSDT",
    granularity: "1min",
    windowSize: 30,
  },
  {
    key: "reversion",
    name: "Reversion Rey",
    tier: "notarized",
    strategy: STRATEGIES["mean-reversion"],
    seed: "mean-reversion-v1",
    instrument: "ETHUSDT",
    granularity: "1min",
    windowSize: 30,
  },
  {
    key: "breakout",
    name: "Breakout Bo",
    tier: "reproducible",
    strategy: STRATEGIES.breakout,
    seed: "breakout-v1",
    instrument: "BTCUSDT",
    granularity: "1min",
    windowSize: 30,
  },
];

/** The single Tier-2 (strategy-reproducible) agent key; the badge is never generalized. */
export const TIER2_AGENT_KEY = "breakout";

/** Look up a demo agent by key. */
export function demoAgent(key: string): DemoAgent | undefined {
  return DEMO_AGENTS.find((a) => a.key === key);
}
