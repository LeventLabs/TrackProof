import type { CanonicalValue } from "./canonical.js";
import { canonicalHash } from "./hash.js";
import { verifyCapsuleSignature, type MemoryPurchaseBody, type SignedCapsule, type TradeDecisionBody } from "./capsule.js";

/** Normalized OHLCV candle. Prices/volumes are string-encoded decimals. */
export interface Candle {
  /** candle open time, ms */
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  baseVolume: string;
  quoteVolume: string;
}

export interface CandleQuery {
  instrument: string;
  granularity: string;
  startTime: number;
  endTime: number;
}

/**
 * The market-data dependency the replay engine inverts on. The core stays
 * exchange-agnostic; an adapter (e.g. `@trackproof/bitget`) implements this.
 */
/** A funding-rate observation: the rate that settled at `time` (ms). Futures only. */
export interface FundingRate {
  time: number;
  fundingRate: string;
}

export interface MarketDataSource {
  getCandles(query: CandleQuery): Promise<Candle[]>;
  /** Optional funding-rate history (futures only); needed only to verify a capsule that pins
   *  `market_ref.funding` (R1.3). */
  getFundingRate?(query: CandleQuery): Promise<FundingRate[]>;
}

/** The replayable inputs an agent claims to have acted on (the G1 evidence). */
export interface ReplayInputs {
  candles: Candle[];
  funding?: CanonicalValue;
  fills?: CanonicalValue;
}

/**
 * The digest the agent commits in a trade_decision's `inputs_digest`, and that
 * the verifier recomputes from independently re-fetched history (G1).
 */
export function computeInputsDigest(inputs: ReplayInputs): string {
  const value: CanonicalValue = {
    candles: inputs.candles as unknown as CanonicalValue,
    funding: inputs.funding,
    fills: inputs.fills,
  };
  return canonicalHash(value);
}

export interface Fill {
  filled: boolean;
  fillPrice?: string;
  /** = outcome_evaluation_start; the instant the G2 certifiability rule (R4.4) compares against. */
  fillTime?: number;
  reason?: string;
}

/**
 * Deterministic, public simulated-fill model (R3.2):
 *  - market → fill at the open of the first candle after the decision;
 *  - limit  → fill at the limit price on the first candle whose [low, high] crosses it.
 * `outcomeCandles` must be the candles strictly after the decision instant, ascending.
 * This is NOT execution-realistic: there is no slippage or market impact (the order book
 * is not historically replayable by design).
 */
export function simulateFill(action: TradeDecisionBody["action"], outcomeCandles: Candle[]): Fill {
  if (outcomeCandles.length === 0) return { filled: false, reason: "no outcome candles" };

  if (action.type === "market") {
    const first = outcomeCandles[0]!;
    return { filled: true, fillPrice: first.open, fillTime: first.time };
  }

  // limit
  if (action.intended_price === undefined) {
    return { filled: false, reason: "limit order without intended_price" };
  }
  const limit = Number(action.intended_price);
  for (const candle of outcomeCandles) {
    if (limit >= Number(candle.low) && limit <= Number(candle.high)) {
      return { filled: true, fillPrice: action.intended_price, fillTime: candle.time };
    }
  }
  return { filled: false, reason: "limit not reached in the outcome window" };
}

/**
 * Mark-to-market P&L from the fill to the last candle's close. Descriptive only —
 * not execution-realistic (see `simulateFill`).
 */
export function computePnl(
  action: TradeDecisionBody["action"],
  fill: Fill,
  outcomeCandles: Candle[],
): string {
  if (!fill.filled || fill.fillPrice === undefined || outcomeCandles.length === 0) return "0";
  const exit = outcomeCandles[outcomeCandles.length - 1]!;
  const direction = action.side === "long" ? 1 : -1;
  const pnl = (Number(exit.close) - Number(fill.fillPrice)) * Number(action.size) * direction;
  return formatDecimal(pnl);
}

function formatDecimal(n: number): string {
  return (Math.round(n * 1e8) / 1e8).toString();
}

export type Verdict = "PASSED" | "FAILED_DATA" | "FAILED_PAYMENT" | "FAILED_SIGNATURE" | "PENDING";

export interface TradeVerification {
  kind: "trade_decision";
  /** Authenticity: PASSED once the signature + G1 hold; FAILED_* otherwise. */
  verdict: Extract<Verdict, "PASSED" | "FAILED_DATA" | "FAILED_SIGNATURE">;
  reason?: string;
  fill?: Fill;
  /** "settled" once the full outcome window has elapsed in the data; "incomplete" otherwise. */
  outcome?: "settled" | "incomplete";
  /** Descriptive, not execution-realistic. Present only when `outcome === "settled"`. */
  pnl?: string;
  /** outcome_evaluation_start (fill time) for the G2 certifiability rule (R4.4). */
  outcomeStart?: number;
}

export interface MemoryVerification {
  kind: "memory_purchase";
  verdict: Extract<Verdict, "PASSED" | "FAILED_PAYMENT" | "FAILED_SIGNATURE">;
  reason?: string;
}

export type CapsuleVerificationResult = TradeVerification | MemoryVerification;

export interface ReplayOptions {
  /** Length of the outcome window after the decision instant, ms (default 30 min). */
  outcomeHorizonMs?: number;
}

const DEFAULT_OUTCOME_HORIZON_MS = 30 * 60 * 1000;

/**
 * Fetch all candles whose open time is in [start, end] inclusive. Bitget treats
 * `startTime` as exclusive, so widen the lower bound and filter — making the input
 * window deterministic between emit and replay regardless of the boundary convention.
 */
async function fetchWindow(
  source: MarketDataSource,
  instrument: string,
  granularity: string,
  start: number,
  end: number,
): Promise<Candle[]> {
  const candles = await source.getCandles({ instrument, granularity, startTime: start - 1, endTime: end });
  return candles.filter((c) => c.time >= start && c.time <= end).sort((a, b) => a.time - b.time);
}

/** Re-fetch + canonicalize the pinned funding window (ascending), so emit and replay agree. */
async function fetchFundingWindow(
  source: MarketDataSource,
  instrument: string,
  start: number,
  end: number,
): Promise<FundingRate[]> {
  const funding = await source.getFundingRate!({ instrument, granularity: "", startTime: start, endTime: end });
  return funding.filter((f) => f.time >= start && f.time <= end).sort((a, b) => a.time - b.time);
}

/** Authenticity (signature + G1) + sim-fill + outcome maturity for a trade_decision capsule. */
export async function verifyTradeDecision(
  capsule: SignedCapsule,
  source: MarketDataSource,
  options: ReplayOptions = {},
): Promise<TradeVerification> {
  if (!verifyCapsuleSignature(capsule)) {
    return { kind: "trade_decision", verdict: "FAILED_SIGNATURE", reason: "invalid signature" };
  }

  const body = capsule.body as TradeDecisionBody;
  const { market_ref } = body;

  // G1: re-fetch the pinned input window and recompute the digest.
  const inputCandles = await fetchWindow(
    source,
    market_ref.instrument,
    market_ref.candles.granularity,
    market_ref.candles.window[0],
    market_ref.candles.window[1],
  );
  const inputs: ReplayInputs = { candles: inputCandles };
  if (market_ref.funding) {
    if (!source.getFundingRate) {
      return {
        kind: "trade_decision",
        verdict: "FAILED_DATA",
        reason: "capsule pins funding but the data source cannot re-fetch it (G1)",
      };
    }
    const funding = await fetchFundingWindow(
      source,
      market_ref.instrument,
      market_ref.funding.window[0],
      market_ref.funding.window[1],
    );
    inputs.funding = funding as unknown as CanonicalValue;
  }
  if (computeInputsDigest(inputs) !== body.inputs_digest) {
    return { kind: "trade_decision", verdict: "FAILED_DATA", reason: "inputs_digest mismatch (G1)" };
  }

  // Outcome: candles strictly after the decision instant, for sim-fill + P&L.
  const horizon = options.outcomeHorizonMs ?? DEFAULT_OUTCOME_HORIZON_MS;
  const intervalMs =
    inputCandles.length >= 2
      ? inputCandles[inputCandles.length - 1]!.time - inputCandles[inputCandles.length - 2]!.time
      : 0;
  const outcome = (
    await source.getCandles({
      instrument: market_ref.instrument,
      granularity: market_ref.candles.granularity,
      startTime: market_ref.decision_time + 1,
      endTime: market_ref.decision_time + horizon,
    })
  )
    .filter((candle) => candle.time > market_ref.decision_time)
    .sort((a, b) => a.time - b.time);

  const fill = simulateFill(body.action, outcome);

  // The outcome is "settled" only once the data covers the full horizon. Replaying before then
  // would credit a partial, non-reproducible P&L — so leave it incomplete and credit nothing.
  const last = outcome[outcome.length - 1];
  const settled = last !== undefined && last.time + intervalMs >= market_ref.decision_time + horizon;
  if (!settled) {
    return {
      kind: "trade_decision",
      verdict: "PASSED",
      outcome: "incomplete",
      fill,
      outcomeStart: fill.fillTime,
      reason: "outcome window not yet complete",
    };
  }

  return {
    kind: "trade_decision",
    verdict: "PASSED",
    outcome: "settled",
    fill,
    pnl: computePnl(body.action, fill, outcome),
    outcomeStart: fill.fillTime,
  };
}

/**
 * memory_purchase verification. Full x402 settlement verification arrives with the
 * payments layer (WS3); here the receipt is checked for being well-formed and present.
 */
export function verifyMemoryPurchase(capsule: SignedCapsule): MemoryVerification {
  if (!verifyCapsuleSignature(capsule)) {
    return { kind: "memory_purchase", verdict: "FAILED_SIGNATURE", reason: "invalid signature" };
  }
  const body = capsule.body as MemoryPurchaseBody;
  if (!body.payment_ref || !body.body_hash) {
    return { kind: "memory_purchase", verdict: "FAILED_PAYMENT", reason: "missing payment_ref or body_hash" };
  }
  return { kind: "memory_purchase", verdict: "PASSED" };
}

/** Verify a capsule, branching on `kind` (R3.6). */
export async function verifyCapsule(
  capsule: SignedCapsule,
  source: MarketDataSource,
  options?: ReplayOptions,
): Promise<CapsuleVerificationResult> {
  if (capsule.kind === "trade_decision") return verifyTradeDecision(capsule, source, options);
  return verifyMemoryPurchase(capsule);
}
