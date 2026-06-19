import {
  computeInputsDigest,
  type Candle,
  type MarketDataSource,
  type SignedCapsule,
  type TradeDecisionBody,
} from "@trackproof/core";
import { STRATEGIES, strategyHash, type Action, type StrategySpec } from "./strategies.js";

/**
 * Tier-2 (strategy-reproducible) verification (R7.2). For a capsule that declares
 * `repro {strategy_hash, seed}`, re-fetch its pinned window, re-run the *same* deterministic
 * strategy on those authentic inputs, and confirm the recorded action re-derives.
 *
 * This is an OPTIONAL badge layered on top of Tier-1. Only the one deterministic demo agent
 * (Breakout) emits `repro`, so only it is Tier-2 — the mechanism is never generalized to the
 * notarized (LLM-style) agents (PROJECT_CONTEXT §4.6).
 */

/** Strategy lookup by the committed strategy_hash, so a verifier can find which fn to re-run. */
const BY_HASH = new Map<string, StrategySpec>(
  Object.values(STRATEGIES).map((spec) => [strategyHash(spec), spec]),
);

export function strategyByHash(hash: string): StrategySpec | undefined {
  return BY_HASH.get(hash);
}

export interface Rederivation {
  /** True only if the inputs are authentic (G1) AND the recorded action re-derives. */
  reproducible: boolean;
  reason?: string;
  recordedAction?: Action;
  derivedAction?: Action | null;
}

/** Two actions are equal iff every field matches (treating optional fields as their defaults). */
function sameAction(a: Action, b: Action): boolean {
  return (
    a.side === b.side &&
    a.size === b.size &&
    a.type === b.type &&
    (a.intended_price ?? null) === (b.intended_price ?? null) &&
    (a.reduce_only ?? false) === (b.reduce_only ?? false)
  );
}

/** Re-fetch [w0, w1] inclusive, mirroring the replay engine's window fetch (G1-consistent). */
async function fetchWindow(
  source: MarketDataSource,
  instrument: string,
  granularity: string,
  w0: number,
  w1: number,
): Promise<Candle[]> {
  const candles = await source.getCandles({ instrument, granularity, startTime: w0 - 1, endTime: w1 });
  return candles.filter((c) => c.time >= w0 && c.time <= w1).sort((a, b) => a.time - b.time);
}

/** Attempt to re-derive a capsule's action from its `repro` reference + re-fetched inputs. */
export async function rederive(capsule: SignedCapsule, source: MarketDataSource): Promise<Rederivation> {
  if (capsule.kind !== "trade_decision") {
    return { reproducible: false, reason: "not a trade_decision" };
  }
  const body = capsule.body as TradeDecisionBody;
  if (!body.repro) {
    return { reproducible: false, reason: "no repro (Tier-1 / notarized only)" };
  }
  const spec = strategyByHash(body.repro.strategy_hash);
  if (!spec) {
    return { reproducible: false, reason: "unknown strategy_hash" };
  }

  // Re-derivation must run on authentic inputs — recompute the digest first (the G1 boundary).
  const window = await fetchWindow(
    source,
    body.market_ref.instrument,
    body.market_ref.candles.granularity,
    body.market_ref.candles.window[0],
    body.market_ref.candles.window[1],
  );
  if (computeInputsDigest({ candles: window }) !== body.inputs_digest) {
    return { reproducible: false, reason: "inputs not authentic (G1 mismatch)", recordedAction: body.action };
  }

  const derived = spec.fn(window, body.repro.seed);
  const reproducible = derived !== null && sameAction(derived, body.action);
  return {
    reproducible,
    reason: reproducible ? undefined : "action did not re-derive from the pinned strategy + seed",
    recordedAction: body.action,
    derivedAction: derived,
  };
}

export interface ChainReproSummary {
  /** Capsules that carried a repro reference (Tier-2 candidates). */
  reproCapsules: number;
  /** Of those, how many re-derived successfully. */
  reproduced: number;
  /** The agent earns the Tier-2 "reproducible" badge iff it has repro capsules and all re-derive. */
  badge: boolean;
}

/** Summarize Tier-2 reproducibility over one agent's chain (sampled or full). */
export async function rederiveChain(
  capsules: SignedCapsule[],
  source: MarketDataSource,
): Promise<ChainReproSummary> {
  let reproCapsules = 0;
  let reproduced = 0;
  for (const capsule of capsules) {
    if (capsule.kind !== "trade_decision" || (capsule.body as TradeDecisionBody).repro === undefined) continue;
    reproCapsules++;
    if ((await rederive(capsule, source)).reproducible) reproduced++;
  }
  return { reproCapsules, reproduced, badge: reproCapsules > 0 && reproduced === reproCapsules };
}
