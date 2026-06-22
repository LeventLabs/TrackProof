import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCapsule, type Candle, type CandleQuery, type FundingRate, type MarketDataSource } from "@trackproof/core";
import { TrackProof } from "./sdk.js";

const T = 1_700_000_000_000;
const CANDLES: Candle[] = Array.from({ length: 5 }, (_, i) => {
  const p = (100 + i).toString();
  return { time: T + i * 60_000, open: p, high: p, low: p, close: p, baseVolume: "1", quoteVolume: "100" };
});
const FUNDING: FundingRate[] = [
  { time: T - 100_000, fundingRate: "0.00003" },
  { time: T - 40_000, fundingRate: "-0.00001" },
];

/** A source that serves the fixed candles and (optionally) funding for the requested window. */
class FixtureSource implements MarketDataSource {
  constructor(
    private readonly candles: Candle[],
    private readonly funding: FundingRate[],
  ) {}
  async getCandles(q: CandleQuery): Promise<Candle[]> {
    return this.candles.filter((c) => c.time >= q.startTime && c.time <= q.endTime);
  }
  async getFundingRate(q: CandleQuery): Promise<FundingRate[]> {
    return this.funding.filter((f) => f.time >= q.startTime && f.time <= q.endTime);
  }
}

function emitWith(funding?: FundingRate[]): ReturnType<TrackProof["emit"]> {
  const home = mkdtempSync(join(tmpdir(), "tp-fund-"));
  try {
    return new TrackProof({ home }).emit({
      instrument: "BTCUSDT",
      granularity: "1min",
      candles: CANDLES,
      action: { side: "long", size: "1", type: "market" },
      ...(funding ? { funding } : {}),
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("a funding-pinned capsule re-verifies when the source re-fetches matching funding (G1)", async () => {
  const capsule = emitWith(FUNDING);
  assert.equal((capsule.body as { market_ref: { funding?: unknown } }).market_ref.funding !== undefined, true);
  const r = await verifyCapsule(capsule, new FixtureSource(CANDLES, FUNDING));
  assert.equal(r.verdict, "PASSED");
});

test("tampering the re-fetched funding fails G1 (FAILED_DATA)", async () => {
  const capsule = emitWith(FUNDING);
  const tampered = [FUNDING[0]!, { time: FUNDING[1]!.time, fundingRate: "0.999" }];
  const r = await verifyCapsule(capsule, new FixtureSource(CANDLES, tampered));
  assert.equal(r.verdict, "FAILED_DATA");
});

test("a funding-pinned capsule fails when the source cannot re-fetch funding", async () => {
  const capsule = emitWith(FUNDING);
  const noFunding: MarketDataSource = {
    async getCandles(q) {
      return CANDLES.filter((c) => c.time >= q.startTime && c.time <= q.endTime);
    },
  };
  const r = await verifyCapsule(capsule, noFunding);
  assert.equal(r.verdict, "FAILED_DATA");
});

test("a capsule emitted without funding stays candles-only and verifies (backward-compatible)", async () => {
  const capsule = emitWith();
  assert.equal((capsule.body as { market_ref: { funding?: unknown } }).market_ref.funding, undefined);
  const r = await verifyCapsule(capsule, new FixtureSource(CANDLES, FUNDING));
  assert.equal(r.verdict, "PASSED");
});
