import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import {
  appendCapsule,
  computeInputsDigest,
  rawPublicKeyHex,
  type Candle,
  type SignedCapsule,
  type TradeDecisionBody,
} from "@trackproof/core";

/**
 * Seeded fake track records — the demo's antagonists (R8). These are reusable, deterministic
 * artifacts the evidence command (and a live `verify`) can run to show the verifier turning red:
 *
 *  - `fabricatedPriceFake()`  — a structurally valid, signed chain whose `inputs_digest`es are
 *    computed over prices that never printed (a "+412%" pump). The chain passes G3, but every
 *    capsule fails **G1 (FAILED_DATA)** the moment its window is re-fetched from real history.
 *  - `deletedLoserFake()`     — a real-looking chain with a losing trade quietly deleted, so the
 *    hash-chain breaks: it fails **G3** at the first capsule after the gap.
 */

export type FailureClass = "G1" | "G3";

export interface FakeRecord {
  /** Stable key / display id. */
  key: string;
  agentId: string;
  /** The bogus claim this fake makes (for the demo caption). */
  claim: string;
  /** Which guarantee catches it. */
  failureClass: FailureClass;
  /** The (tampered) chain a verifier is handed. */
  capsules: SignedCapsule[];
  /** For G3: the seq that was deleted (the chain breaks at the next one). */
  removedSeq?: number;
}

// --- deterministic Ed25519 key from a fixed 32-byte seed (stable fake identities) ---

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function keyFromSeed(seedHex: string): { publicKeyHex: string; privateKey: KeyObject } {
  const seed = Buffer.from(seedHex, "hex");
  if (seed.length !== 32) throw new Error("fake key seed must be 32 bytes (64 hex chars)");
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return { publicKeyHex: rawPublicKeyHex(createPublicKey(privateKey)), privateKey };
}

const MINUTE = 60_000;
/** A fixed, safely-historical anchor for the fake windows (so a live re-fetch returns real data). */
const FAKE_WINDOW_END = new Date("2026-06-01T00:00:00Z").getTime();

function candle(time: number, open: number, close: number): Candle {
  const wick = Math.max(open, close) * 0.001;
  return {
    time,
    open: String(open),
    high: String(Math.max(open, close) + wick),
    low: String(Math.min(open, close) - wick),
    close: String(close),
    baseVolume: "1",
    quoteVolume: "1",
  };
}

/** An absurd, never-printed "+412%" pump (100 -> ~512) over `count` 1-min candles. */
function fabricatedPump(count: number, endTime: number): Candle[] {
  const ratio = Math.pow(5.12, 1 / (count - 1));
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = i === 0 ? price : price / ratio;
    candles.push(candle(endTime - (count - 1 - i) * MINUTE, open, price));
    price *= ratio;
  }
  return candles;
}

/**
 * A signed, structurally valid chain whose every capsule pins a digest over fabricated prices.
 * G3 passes (the chain is well-formed); G1 fails (FAILED_DATA) on re-fetch of each window.
 */
export function fabricatedPriceFake(capsuleCount = 4, windowSize = 30): FakeRecord {
  const { publicKeyHex, privateKey } = keyFromSeed("11".repeat(32));
  let prev: SignedCapsule | null = null;
  const capsules: SignedCapsule[] = [];
  for (let i = 0; i < capsuleCount; i++) {
    const windowEnd = FAKE_WINDOW_END - i * windowSize * MINUTE;
    const windowStart = windowEnd - (windowSize - 1) * MINUTE;
    const fabricated = fabricatedPump(windowSize, windowEnd);
    const decisionTime = windowEnd + MINUTE;
    const body: TradeDecisionBody = {
      market_ref: {
        venue: "bitget",
        instrument: "BTCUSDT",
        decision_time: decisionTime,
        candles: { granularity: "1min", window: [windowStart, windowEnd] },
      },
      inputs_digest: computeInputsDigest({ candles: fabricated }),
      action: { side: "long", size: "5", type: "market" },
      attested: { reasoning_trace: "Claimed +412% ROI — references a pump that never printed." },
    };
    const capsule = appendCapsule(
      prev,
      { kind: "trade_decision", body, committed_at: decisionTime },
      publicKeyHex,
      privateKey,
    );
    capsules.push(capsule);
    prev = capsule;
  }
  return {
    key: "fake-fabricated",
    agentId: publicKeyHex,
    claim: "+412% ROI (fabricated prices)",
    failureClass: "G1",
    capsules,
  };
}

/**
 * A real-looking chain with the losing trade (seq 2) deleted, so the hash-chain breaks. G3 fails
 * at the first capsule after the gap; the deletion of a loser is exactly what completeness catches.
 */
export function deletedLoserFake(chainLength = 5, removedSeq = 2): FakeRecord {
  const { publicKeyHex, privateKey } = keyFromSeed("22".repeat(32));
  const full: SignedCapsule[] = [];
  let prev: SignedCapsule | null = null;
  for (let i = 0; i < chainLength; i++) {
    const windowEnd = FAKE_WINDOW_END + i * 31 * MINUTE;
    const windowStart = windowEnd - 29 * MINUTE;
    // Plausible flat-ish candles; the catch is structural (G3), independent of these values.
    const base = 100 + i;
    const candles = Array.from({ length: 30 }, (_, j) => candle(windowStart + j * MINUTE, base, base + (j % 3) - 1));
    const decisionTime = windowEnd + MINUTE;
    const isLoser = i === removedSeq;
    const body: TradeDecisionBody = {
      market_ref: {
        venue: "bitget",
        instrument: "BTCUSDT",
        decision_time: decisionTime,
        candles: { granularity: "1min", window: [windowStart, windowEnd] },
      },
      inputs_digest: computeInputsDigest({ candles }),
      action: { side: i % 2 === 0 ? "long" : "short", size: "1", type: "market" },
      attested: { reasoning_trace: isLoser ? "Losing trade (later deleted to fake the record)." : "Routine trade." },
    };
    const capsule = appendCapsule(
      prev,
      { kind: "trade_decision", body, committed_at: decisionTime },
      publicKeyHex,
      privateKey,
    );
    full.push(capsule);
    prev = capsule;
  }
  // Delete the loser — leaving a seq gap / prev_hash break that G3 detects.
  const capsules = full.filter((c) => c.seq !== removedSeq);
  return {
    key: "fake-deleted-loser",
    agentId: publicKeyHex,
    claim: "100% win rate (deleted its losing trade)",
    failureClass: "G3",
    capsules,
    removedSeq,
  };
}

/** All seeded fakes. Catches total >= 3 (every fabricated capsule fails G1, plus the G3 gap). */
export function seededFakes(): FakeRecord[] {
  return [fabricatedPriceFake(), deletedLoserFake()];
}
