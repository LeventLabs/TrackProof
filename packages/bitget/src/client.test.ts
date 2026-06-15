import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@trackproof/core";
import { granularityMs, parseCandles, paginateCandles, type CandlePageFetcher } from "./client.js";

test("granularityMs maps Bitget granularities (default 1min)", () => {
  assert.equal(granularityMs("1min"), 60_000);
  assert.equal(granularityMs("1h"), 3_600_000);
  assert.equal(granularityMs("1day"), 86_400_000);
  assert.equal(granularityMs("unknown"), 60_000);
});

test("parseCandles maps rows and sorts ascending by time", () => {
  const rows = [
    ["1700000060000", "101", "102", "100", "101.5", "10", "1000"],
    ["1700000000000", "100", "101", "99", "100.5", "12", "1200"],
  ];
  const candles = parseCandles(rows);
  assert.equal(candles.length, 2);
  assert.equal(candles[0]!.time, 1_700_000_000_000);
  assert.equal(candles[0]!.open, "100");
  assert.equal(candles[1]!.high, "102");
  assert.equal(candles[1]!.quoteVolume, "1000");
});

test("parseCandles tolerates short/empty rows", () => {
  assert.deepEqual(parseCandles([]), []);
  const candles = parseCandles([["1700000000000", "100"]]);
  assert.equal(candles[0]!.open, "100");
  assert.equal(candles[0]!.high, "0");
});

const STEP = 60_000;
const T0 = 1_700_000_000_000;

function candleAt(time: number): Candle {
  return { time, open: "1", high: "1", low: "1", close: "1", baseVolume: "1", quoteVolume: "1" };
}

/** Mimics history-candles: the most-recent `limit` candles with time <= endTime, ascending. */
function pageFetcher(series: Candle[]): CandlePageFetcher {
  return async (endTime, limit) =>
    series
      .filter((c) => c.time <= endTime)
      .sort((a, b) => a.time - b.time)
      .slice(-limit);
}

test("paginateCandles returns just the requested window from a single page", async () => {
  const series = Array.from({ length: 50 }, (_, i) => candleAt(T0 + i * STEP));
  const got = await paginateCandles(pageFetcher(series), { startTime: T0 + 10 * STEP, endTime: T0 + 15 * STEP }, 200);
  assert.equal(got.length, 6);
  assert.equal(got[0]!.time, T0 + 10 * STEP);
  assert.equal(got[5]!.time, T0 + 15 * STEP);
});

test("paginateCandles walks backward across pages to cover an old window", async () => {
  const series = Array.from({ length: 50 }, (_, i) => candleAt(T0 + i * STEP));
  const got = await paginateCandles(pageFetcher(series), { startTime: T0, endTime: T0 + 49 * STEP }, 10, 50);
  assert.equal(got.length, 50);
  assert.equal(got[0]!.time, T0);
  assert.equal(got[49]!.time, T0 + 49 * STEP);
});

test("paginateCandles stops cleanly on empty data", async () => {
  const got = await paginateCandles(async () => [], { startTime: 1, endTime: 100 });
  assert.equal(got.length, 0);
});
