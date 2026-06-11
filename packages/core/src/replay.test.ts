import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAgentKeyPair } from "./keys.js";
import { appendCapsule } from "./chain.js";
import {
  computeInputsDigest,
  simulateFill,
  verifyCapsule,
  type Candle,
  type CandleQuery,
  type MarketDataSource,
} from "./replay.js";
import type { MemoryPurchaseBody, TradeDecisionBody } from "./capsule.js";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function candle(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: String(o), high: String(h), low: String(l), close: String(c), baseVolume: "1", quoteVolume: "1" };
}

// Input window = first 3 candles; decision at T0+2m; outcome = the two later candles.
const SERIES: Candle[] = [
  candle(T0 + 0 * MINUTE, 100, 101, 99, 100),
  candle(T0 + 1 * MINUTE, 100, 102, 99, 101),
  candle(T0 + 2 * MINUTE, 101, 103, 100, 102),
  candle(T0 + 3 * MINUTE, 102, 105, 101, 104),
  candle(T0 + 4 * MINUTE, 104, 106, 103, 105),
];
const DECISION_TIME = T0 + 2 * MINUTE;
const INPUT_WINDOW: [number, number] = [T0, DECISION_TIME];

class MockSource implements MarketDataSource {
  constructor(private readonly series: Candle[]) {}
  async getCandles(query: CandleQuery): Promise<Candle[]> {
    return this.series.filter((c) => c.time >= query.startTime && c.time <= query.endTime);
  }
}

function inputCandles(series: Candle[] = SERIES): Candle[] {
  return series.filter((c) => c.time >= INPUT_WINDOW[0] && c.time <= INPUT_WINDOW[1]);
}

function tradeCapsule(action: TradeDecisionBody["action"], digestSeries: Candle[] = SERIES) {
  const kp = generateAgentKeyPair();
  const body: TradeDecisionBody = {
    market_ref: {
      venue: "bitget",
      instrument: "BTCUSDT",
      decision_time: DECISION_TIME,
      candles: { granularity: "1m", window: INPUT_WINDOW },
    },
    inputs_digest: computeInputsDigest({ candles: inputCandles(digestSeries) }),
    action,
  };
  return appendCapsule(null, { kind: "trade_decision", body, committed_at: DECISION_TIME }, kp.publicKeyHex, kp.privateKey);
}

test("genuine trade_decision passes G1 and yields a market fill + P&L", async () => {
  const capsule = tradeCapsule({ side: "long", size: "1", type: "market" });
  const result = await verifyCapsule(capsule, new MockSource(SERIES), { outcomeHorizonMs: 2 * MINUTE });
  assert.equal(result.kind, "trade_decision");
  assert.equal(result.verdict, "PASSED");
  if (result.kind === "trade_decision") {
    assert.equal(result.outcome, "settled");
    assert.equal(result.fill?.filled, true);
    assert.equal(result.fill?.fillPrice, "102"); // open of the first outcome candle
    assert.equal(result.outcomeStart, T0 + 3 * MINUTE);
    assert.equal(result.pnl, "3"); // (105 close - 102 fill) * 1 * long
  }
});

test("a short position prices P&L with the opposite sign", async () => {
  const capsule = tradeCapsule({ side: "short", size: "2", type: "market" });
  const result = await verifyCapsule(capsule, new MockSource(SERIES), { outcomeHorizonMs: 2 * MINUTE });
  assert.equal(result.verdict, "PASSED");
  if (result.kind === "trade_decision") {
    assert.equal(result.outcome, "settled");
    assert.equal(result.pnl, "-6"); // (105 - 102) * 2 * short
  }
});

test("fabricated input data fails G1 (FAILED_DATA)", async () => {
  // The agent's digest is over the real series, but the source serves a tampered input candle.
  const capsule = tradeCapsule({ side: "long", size: "1", type: "market" });
  const tampered = SERIES.map((c) => (c.time === T0 + 1 * MINUTE ? candle(c.time, 100, 999, 99, 101) : c));
  const result = await verifyCapsule(capsule, new MockSource(tampered));
  assert.equal(result.verdict, "FAILED_DATA");
});

test("a claimed digest that does not match real history fails G1", async () => {
  const kp = generateAgentKeyPair();
  const body: TradeDecisionBody = {
    market_ref: {
      venue: "bitget",
      instrument: "BTCUSDT",
      decision_time: DECISION_TIME,
      candles: { granularity: "1m", window: INPUT_WINDOW },
    },
    inputs_digest: "00".repeat(32), // a fabricated digest
    action: { side: "long", size: "1", type: "market" },
  };
  const capsule = appendCapsule(null, { kind: "trade_decision", body, committed_at: DECISION_TIME }, kp.publicKeyHex, kp.privateKey);
  const result = await verifyCapsule(capsule, new MockSource(SERIES));
  assert.equal(result.verdict, "FAILED_DATA");
});

test("the sim-fill model is deterministic", () => {
  const outcome = SERIES.filter((c) => c.time > DECISION_TIME);
  const a = simulateFill({ side: "long", size: "1", type: "market" }, outcome);
  const b = simulateFill({ side: "long", size: "1", type: "market" }, outcome);
  assert.deepEqual(a, b);
});

test("a limit order fills only when a candle crosses the limit", () => {
  const outcome = SERIES.filter((c) => c.time > DECISION_TIME); // ranges [101,105] then [103,106]
  const hit = simulateFill({ side: "long", size: "1", type: "limit", intended_price: "104" }, outcome);
  assert.equal(hit.filled, true);
  assert.equal(hit.fillPrice, "104");
  const miss = simulateFill({ side: "long", size: "1", type: "limit", intended_price: "1" }, outcome);
  assert.equal(miss.filled, false);
});

test("memory_purchase verifies, and a missing receipt fails", async () => {
  const kp = generateAgentKeyPair();
  const ok: MemoryPurchaseBody = { slice_id: "s1", seller_agent_id: "ab", price: "12", payment_ref: "x402:0x1", body_hash: "beef" };
  const okCapsule = appendCapsule(null, { kind: "memory_purchase", body: ok, committed_at: 1 }, kp.publicKeyHex, kp.privateKey);
  assert.equal((await verifyCapsule(okCapsule, new MockSource(SERIES))).verdict, "PASSED");

  const bad: MemoryPurchaseBody = { slice_id: "s1", seller_agent_id: "ab", price: "12", payment_ref: "", body_hash: "" };
  const badCapsule = appendCapsule(null, { kind: "memory_purchase", body: bad, committed_at: 2 }, kp.publicKeyHex, kp.privateKey);
  assert.equal((await verifyCapsule(badCapsule, new MockSource(SERIES))).verdict, "FAILED_PAYMENT");
});

test("the input window stays inclusive when the source treats startTime as exclusive (Bitget boundary)", async () => {
  // Mirrors Bitget /candles: the candle whose open time == startTime is excluded.
  class ExclusiveStartSource implements MarketDataSource {
    constructor(private readonly series: Candle[]) {}
    async getCandles(query: CandleQuery): Promise<Candle[]> {
      return this.series.filter((c) => c.time > query.startTime && c.time <= query.endTime);
    }
  }
  const capsule = tradeCapsule({ side: "long", size: "1", type: "market" });
  const result = await verifyCapsule(capsule, new ExclusiveStartSource(SERIES));
  assert.equal(result.verdict, "PASSED");
});

test("an immature outcome window returns incomplete and credits no P&L", async () => {
  // Default 30-min horizon; the mock series ends at T0+4m, far short of the window end.
  const capsule = tradeCapsule({ side: "long", size: "1", type: "market" });
  const result = await verifyCapsule(capsule, new MockSource(SERIES));
  assert.equal(result.verdict, "PASSED");
  if (result.kind === "trade_decision") {
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.pnl, undefined);
  }
});

test("a tampered capsule fails the signature check before any data work", async () => {
  const capsule = tradeCapsule({ side: "long", size: "1", type: "market" });
  const tampered = structuredClone(capsule);
  (tampered.body as TradeDecisionBody).action.size = "999";
  const result = await verifyCapsule(tampered, new MockSource(SERIES));
  assert.equal(result.verdict, "FAILED_SIGNATURE");
});
