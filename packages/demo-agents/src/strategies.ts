import { canonicalHash, type Candle, type TradeDecisionBody } from "@trackproof/core";

/** A simulated order (never executed). */
export type Action = TradeDecisionBody["action"];

/**
 * A demo agent strategy: a PURE, deterministic function of the input candles + a seed.
 * Purity is what makes the evidence judge-reproducible (R11.2) and the Tier-2 badge
 * re-derivable (R7.2): the same inputs + seed always yield the same action.
 */
export type Strategy = (candles: Candle[], seed: string) => Action | null;

export interface StrategySpec {
  /** Stable strategy id (part of the Tier-2 strategy_hash). */
  id: string;
  /** Strategy version (part of the strategy_hash); bump on any logic change. */
  version: string;
  fn: Strategy;
}

/** The Tier-2 commitment to *which* deterministic strategy produced an action (repro.strategy_hash). */
export function strategyHash(spec: { id: string; version: string }): string {
  return canonicalHash({ strategy: spec.id, version: spec.version });
}

// ---------------------------------------------------------------------------
// Pure numeric helpers (no deps; cheap enough to call per decision window).
// ---------------------------------------------------------------------------

function closes(candles: Candle[]): number[] {
  return candles.map((c) => Number(c.close));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function maxOf(xs: number[]): number {
  return xs.reduce((a, b) => (b > a ? b : a), -Infinity);
}

function minOf(xs: number[]): number {
  return xs.reduce((a, b) => (b < a ? b : a), Infinity);
}

/**
 * Deterministic unit value in [0, 1) from a seed string (FNV-1a). Lets each agent's seed pin
 * its own thresholds while keeping every strategy a pure, exactly re-derivable function.
 */
export function seededUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/** Map a signal strength to a small integer size string (1..3) — varied leaderboard magnitudes. */
function sizeFor(strength: number): string {
  if (!Number.isFinite(strength)) return "1";
  return String(Math.min(3, 1 + Math.floor(Math.abs(strength))));
}

// ---------------------------------------------------------------------------
// The three strategies. All emit market orders so the bulk evidence settles cleanly
// (a market order always fills at the next candle open). Each produces a mix of
// long / short / no-trade over real tape.
// ---------------------------------------------------------------------------

/** Momentum (Tier-1): trade in the direction of price vs its mean, outside a seed-set band. */
export const momentum: Strategy = (candles, seed) => {
  if (candles.length < 5) return null;
  const cs = closes(candles);
  const m = mean(cs);
  const last = cs[cs.length - 1]!;
  const band = m * (0.0005 + seededUnit(seed) * 0.0015); // ~0.05% .. 0.20% of price
  if (band <= 0) return null;
  if (last > m + band) return { side: "long", size: sizeFor((last - m) / band), type: "market" };
  if (last < m - band) return { side: "short", size: sizeFor((m - last) / band), type: "market" };
  return null;
};

/** Mean reversion (Tier-1): fade extreme deviations beyond a seed-set z-threshold. */
export const meanReversion: Strategy = (candles, seed) => {
  if (candles.length < 8) return null;
  const cs = closes(candles);
  const m = mean(cs);
  const sd = stddev(cs);
  if (sd === 0) return null;
  const z = (cs[cs.length - 1]! - m) / sd;
  const k = 1.0 + seededUnit(seed) * 0.8; // z-threshold 1.0 .. 1.8
  if (z <= -k) return { side: "long", size: sizeFor(-z), type: "market" };
  if (z >= k) return { side: "short", size: sizeFor(z), type: "market" };
  return null;
};

/**
 * Breakout (Tier-2, reproducible): long when the last close breaks the prior window high,
 * short when it breaks the prior low. Fully deterministic and trivial to re-derive — this is
 * the ONE agent that carries a Tier-2 `repro` badge; the badge is never generalized.
 */
export const breakout: Strategy = (candles, seed) => {
  if (candles.length < 4) return null;
  const prior = candles.slice(0, -1);
  const last = Number(candles[candles.length - 1]!.close);
  const priorHigh = maxOf(prior.map((c) => Number(c.high)));
  const priorLow = minOf(prior.map((c) => Number(c.low)));
  if (!Number.isFinite(priorHigh) || !Number.isFinite(priorLow) || priorHigh <= 0 || priorLow <= 0) return null;
  // The seed nudges the breakout margin, so the seed is genuinely part of the re-derivation.
  const margin = 1 + seededUnit(seed) * 0.0005;
  if (last > priorHigh * margin) return { side: "long", size: sizeFor((last / priorHigh - 1) * 1000), type: "market" };
  if (last < priorLow / margin) return { side: "short", size: sizeFor((1 - last / priorLow) * 1000), type: "market" };
  return null;
};

/** Strategy registry, keyed by a short name; values carry the id/version used for strategy_hash. */
export const STRATEGIES = {
  momentum: { id: "momentum", version: "1", fn: momentum } satisfies StrategySpec,
  "mean-reversion": { id: "mean-reversion", version: "1", fn: meanReversion } satisfies StrategySpec,
  breakout: { id: "breakout", version: "1", fn: breakout } satisfies StrategySpec,
} as const;
