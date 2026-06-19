import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "@trackproof/core";
import {
  STRATEGIES,
  breakout,
  meanReversion,
  momentum,
  seededUnit,
  strategyHash,
  type Strategy,
} from "./strategies.js";

/** Build a candle with explicit close and (optional) high/low; time is irrelevant to strategies. */
function c(close: number, high = close * 1.0005, low = close * 0.9995): Candle {
  return {
    time: 0,
    open: String(close),
    high: String(high),
    low: String(low),
    close: String(close),
    baseVolume: "1",
    quoteVolume: "1",
  };
}

const SEED = "demo-seed";

test("momentum: long above the mean, short below, flat -> no trade", () => {
  const rising = [100, 100, 100, 100, 100, 112].map((p) => c(p));
  const falling = [100, 100, 100, 100, 100, 88].map((p) => c(p));
  const flat = [100, 100, 100, 100, 100, 100].map((p) => c(p));
  assert.equal(momentum(rising, SEED)?.side, "long");
  assert.equal(momentum(falling, SEED)?.side, "short");
  assert.equal(momentum(flat, SEED), null);
});

test("mean reversion: fade a spike down (long) / up (short), flat -> no trade", () => {
  const dipLow = [...Array(8).fill(100), 90].map((p) => c(p));
  const spikeUp = [...Array(8).fill(100), 110].map((p) => c(p));
  const flat = Array(9).fill(100).map((p) => c(p));
  assert.equal(meanReversion(dipLow, SEED)?.side, "long");
  assert.equal(meanReversion(spikeUp, SEED)?.side, "short");
  assert.equal(meanReversion(flat, SEED), null); // sd === 0
});

test("breakout: long above the prior high, short below the prior low, inside range -> no trade", () => {
  const prior = [c(100, 101, 99), c(100, 102, 98), c(100, 101, 99)];
  const long = [...prior, c(105)];
  const short = [...prior, c(95)];
  const inside = [...prior, c(100)];
  assert.equal(breakout(long, SEED)?.side, "long");
  assert.equal(breakout(short, SEED)?.side, "short");
  assert.equal(breakout(inside, SEED), null);
});

test("every strategy is deterministic (same inputs + seed -> same action)", () => {
  const window = [100, 101, 99, 103, 98, 105, 97, 108, 96, 110].map((p) => c(p));
  const strategies: Strategy[] = [momentum, meanReversion, breakout];
  for (const fn of strategies) {
    assert.deepEqual(fn(window, SEED), fn(window, SEED));
  }
});

test("the seed changes thresholds, so it is genuinely part of the computation", () => {
  // Borderline window: the long/no-trade boundary sits at ~u=0.5 of the seed-set band, so a fixed
  // sweep of seeds deterministically lands on both sides — proving the seed feeds the decision
  // (so Tier-2 re-derivation must pin the seed, not just the strategy).
  const borderline = [100, 100, 100, 100, 100, 100.15].map((p) => c(p));
  const seeds = Array.from({ length: 60 }, (_, i) => `s${i}`);
  const sides = new Set(seeds.map((s) => String(momentum(borderline, s)?.side ?? "none")));
  assert.ok(sides.size >= 2, `expected seed to swing a borderline decision, got ${[...sides].join(",")}`);
});

test("seededUnit is deterministic and in [0, 1)", () => {
  assert.equal(seededUnit("x"), seededUnit("x"));
  for (const s of ["", "a", "demo-seed", "breakout-7"]) {
    const u = seededUnit(s);
    assert.ok(u >= 0 && u < 1, `${s} -> ${u}`);
  }
});

test("strategy_hash is stable and unique per strategy", () => {
  const hashes = Object.values(STRATEGIES).map((s) => strategyHash(s));
  assert.equal(new Set(hashes).size, hashes.length, "strategy hashes must be unique");
  // stable across calls
  const first = strategyHash(STRATEGIES.breakout);
  assert.equal(first, strategyHash(STRATEGIES.breakout));
  assert.match(first, /^[0-9a-f]{64}$/);
});
