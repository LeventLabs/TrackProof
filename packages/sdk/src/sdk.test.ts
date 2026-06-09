import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCapsule, verifyChain, type Candle, type CandleQuery, type MarketDataSource } from "@trackproof/core";
import { TrackProof } from "./sdk.js";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function candle(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: String(o), high: String(h), low: String(l), close: String(c), baseVolume: "1", quoteVolume: "1" };
}

const INPUT: Candle[] = [
  candle(T0 + 0 * MINUTE, 100, 101, 99, 100),
  candle(T0 + 1 * MINUTE, 100, 102, 99, 101),
  candle(T0 + 2 * MINUTE, 101, 103, 100, 102),
];
const OUTCOME: Candle[] = [
  candle(T0 + 3 * MINUTE, 102, 105, 101, 104),
  candle(T0 + 4 * MINUTE, 104, 106, 103, 105),
];

class MockSource implements MarketDataSource {
  constructor(private readonly series: Candle[]) {}
  async getCandles(query: CandleQuery): Promise<Candle[]> {
    return this.series.filter((c) => c.time >= query.startTime && c.time <= query.endTime);
  }
}

function withHome(fn: (home: string) => void | Promise<void>): Promise<void> | void {
  const home = mkdtempSync(join(tmpdir(), "trackproof-"));
  const cleanup = () => rmSync(home, { recursive: true, force: true });
  try {
    const result = fn(home);
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
  } catch (err) {
    cleanup();
    throw err;
  }
}

test("emit builds a verifiable chain, and the capsule replays PASSED", async () => {
  await withHome(async (home) => {
    const tp = new TrackProof({ home });
    const c1 = tp.emit({ instrument: "BTCUSDT", granularity: "1m", candles: INPUT, action: { side: "long", size: "1", type: "market" } });
    const c2 = tp.emit({
      instrument: "BTCUSDT",
      granularity: "1m",
      candles: INPUT,
      action: { side: "short", size: "1", type: "market" },
      decisionTime: T0 + 2 * MINUTE,
    });
    assert.equal(c1.seq, 0);
    assert.equal(c2.seq, 1);
    assert.equal(c2.prev_hash.length, 64);

    const chain = verifyChain([c1, c2]);
    assert.ok(chain.ok, chain.reason);

    const source = new MockSource([...INPUT, ...OUTCOME]);
    const verification = await verifyCapsule(c1, source);
    assert.equal(verification.verdict, "PASSED");
    if (verification.kind === "trade_decision") {
      assert.equal(verification.fill?.fillPrice, "102");
      assert.equal(verification.pnl, "3");
    }
  });
});

test("reopening the same home reuses the agent key", () => {
  withHome((home) => {
    const id1 = new TrackProof({ home }).agentId;
    const id2 = new TrackProof({ home }).agentId;
    assert.equal(id1, id2);
    assert.match(id1, /^[0-9a-f]{64}$/);
  });
});
