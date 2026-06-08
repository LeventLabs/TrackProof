import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCandles } from "./client.js";

test("parseCandles maps rows and sorts ascending by time", () => {
  const rows = [
    ["1700000060000", "101", "102", "100", "101.5", "10", "1000"],
    ["1700000000000", "100", "101", "99", "100.5", "12", "1200"],
  ];
  const candles = parseCandles(rows);
  assert.equal(candles.length, 2);
  assert.equal(candles[0]!.time, 1_700_000_000_000); // sorted ascending
  assert.equal(candles[0]!.open, "100");
  assert.equal(candles[0]!.close, "100.5");
  assert.equal(candles[1]!.high, "102");
  assert.equal(candles[1]!.quoteVolume, "1000");
});

test("parseCandles tolerates short/empty rows", () => {
  assert.deepEqual(parseCandles([]), []);
  const candles = parseCandles([["1700000000000", "100"]]);
  assert.equal(candles[0]!.open, "100");
  assert.equal(candles[0]!.high, "0");
});
