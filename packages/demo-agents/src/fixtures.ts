import { granularityMs } from "@trackproof/bitget";
import type { Candle, CandleQuery, MarketDataSource } from "@trackproof/core";

function basePrice(instrument: string): number {
  if (instrument === "ETHUSDT") return 3000;
  if (instrument === "BTCUSDT") return 60000;
  return 100;
}

/**
 * Deterministic multi-scale price as a pure function of (instrument, time): a slow trend plus
 * medium swings, ripple, and micro-noise — enough structure that momentum, mean-reversion, and
 * breakout all fire over a window. Because it is a pure function of time, a window emitted from a
 * wide fetch re-fetches byte-identically during replay, so the G1 digest matches.
 */
export function fixtureClose(instrument: string, time: number): number {
  const m = time / 60_000;
  const base = basePrice(instrument);
  const f =
    1 +
    Math.sin(m / 911) * 0.03 +
    Math.sin(m / 53) * 0.01 +
    Math.sin(m / 11) * 0.004 +
    Math.sin(m / 3) * 0.0015;
  return base * f;
}

function fixtureCandle(instrument: string, time: number, interval: number): Candle {
  const close = fixtureClose(instrument, time);
  const open = fixtureClose(instrument, time - interval);
  const wick = close * 0.0008;
  return {
    time,
    open: String(open),
    high: String(Math.max(open, close) + wick),
    low: String(Math.min(open, close) - wick),
    close: String(close),
    baseVolume: "10",
    quoteVolume: "10",
  };
}

/**
 * A deterministic, offline MarketDataSource. Returns the same prices on every call (a pure
 * function of time over the candle grid), so emit and replay agree on the digest without any
 * network access — ideal for tests and a no-network demo of the full pipeline.
 */
export class FixtureMarketData implements MarketDataSource {
  // Mirrors BitgetMarketData's contract: candles with open time in [startTime, endTime] inclusive.
  async getCandles(query: CandleQuery): Promise<Candle[]> {
    const interval = granularityMs(query.granularity);
    const first = Math.ceil(query.startTime / interval) * interval;
    const candles: Candle[] = [];
    for (let t = first; t <= query.endTime; t += interval) {
      candles.push(fixtureCandle(query.instrument, t, interval));
    }
    return candles;
  }
}
