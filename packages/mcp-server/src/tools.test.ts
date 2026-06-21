import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candle, CandleQuery, MarketDataSource } from "@trackproof/core";
import { emitCapsule, verifyLast } from "./tools.js";

/** Deterministic offline source (mirrors BitgetMarketData's contract) so emit and replay agree. */
class FixtureSource implements MarketDataSource {
  async getCandles(q: CandleQuery): Promise<Candle[]> {
    const interval = 60_000;
    const first = Math.ceil(q.startTime / interval) * interval;
    const out: Candle[] = [];
    for (let t = first, i = 0; t <= q.endTime; t += interval, i++) {
      const p = (100 + (i % 7)).toString();
      out.push({ time: t, open: p, high: p, low: p, close: p, baseVolume: "1", quoteVolume: "100" });
    }
    return out;
  }
}

test("emitCapsule then verifyLast round-trips (G1 PASSED, G3 complete)", async () => {
  const home = mkdtempSync(join(tmpdir(), "tp-mcp-"));
  const source = new FixtureSource();
  try {
    const emitted = await emitCapsule(home, source, { instrument: "BTCUSDT", side: "long", size: "1" });
    assert.equal(emitted.seq, 0);
    assert.equal(emitted.action.side, "long");
    assert.match(emitted.inputs_digest, /^[0-9a-f]{64}$/);

    const v = await verifyLast(home, source, {});
    assert.equal(v.g1, "PASSED");
    assert.equal(v.g3, "complete");
    assert.equal(v.chainLength, 1);
    assert.equal(v.seq, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("verifyLast throws on an empty chain", async () => {
  const home = mkdtempSync(join(tmpdir(), "tp-mcp-"));
  try {
    await assert.rejects(() => verifyLast(home, new FixtureSource(), {}), /no capsules/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
