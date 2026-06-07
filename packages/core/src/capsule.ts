import type { KeyObject } from "node:crypto";
import { canonicalize, type CanonicalValue } from "./canonical.js";
import { canonicalHash } from "./hash.js";
import { signBytes, verifyBytes } from "./keys.js";

export type CapsuleKind = "trade_decision" | "memory_purchase";

export interface TradeDecisionBody {
  market_ref: {
    venue: "bitget";
    instrument: string;
    /** ms; the sampling instant — must align to closed candles. */
    decision_time: number;
    candles: { granularity: string; window: [number, number] };
    funding?: { window: [number, number] };
    fills?: { window: [number, number] };
  };
  /** sha256 hex over the canonical replayable inputs the agent acted on (G1). */
  inputs_digest: string;
  action: {
    side: "long" | "short";
    /** string-encoded decimal. */
    size: string;
    type: "market" | "limit";
    /** string-encoded decimal; required for limit orders. */
    intended_price?: string;
    reduce_only?: boolean;
  };
  /** Tier-2 only: lets a deterministic strategy re-derive `action` from the inputs. */
  repro?: { strategy_hash: string; seed: string };
  /** Recorded context — never used as proof. */
  attested?: {
    ticker?: CanonicalValue;
    orderbook?: CanonicalValue;
    skill_outputs?: CanonicalValue;
    reasoning_trace?: string;
  };
}

export interface MemoryPurchaseBody {
  slice_id: string;
  seller_agent_id: string;
  /** string-encoded decimal. */
  price: string;
  /** x402 settlement reference or local-stub receipt id. */
  payment_ref: string;
  /** sha256 hex of the unsealed slice body the buyer received. */
  body_hash: string;
}

export type CapsuleBody = TradeDecisionBody | MemoryPurchaseBody;

export interface CapsuleEnvelope {
  /** Raw Ed25519 public key (hex). */
  agent_id: string;
  /** Monotonic from the enrollment genesis (0). */
  seq: number;
  /** Leaf hash of the previous capsule; the genesis uses GENESIS_PREV_HASH. */
  prev_hash: string;
  /** ms; self-asserted until anchored on-chain (G2). */
  committed_at: number;
  kind: CapsuleKind;
  body: CapsuleBody;
}

export interface SignedCapsule extends CapsuleEnvelope {
  /** Ed25519 signature (hex) over the canonical envelope. */
  signature: string;
}

/** Verifier-derived fields — computed during replay, never signed by the agent. */
export interface CapsuleVerification {
  verdict?: "PASSED" | "FAILED_DATA" | "FAILED_PAYMENT" | "PENDING";
  pnl?: string;
  reproducible?: boolean;
}

/** A capsule as stored/displayed: the signed envelope plus optional verifier output. */
export type Capsule = SignedCapsule & CapsuleVerification;

export const GENESIS_PREV_HASH = "0".repeat(64);

/** The exact value the agent signs: the canonical envelope, without signature or verifier fields. */
export function capsuleSigningPayload(env: CapsuleEnvelope): CanonicalValue {
  return {
    agent_id: env.agent_id,
    seq: env.seq,
    prev_hash: env.prev_hash,
    committed_at: env.committed_at,
    kind: env.kind,
    body: env.body as unknown as CanonicalValue,
  };
}

export function signCapsule(env: CapsuleEnvelope, privateKey: KeyObject): SignedCapsule {
  const bytes = new TextEncoder().encode(canonicalize(capsuleSigningPayload(env)));
  return { ...env, signature: signBytes(privateKey, bytes) };
}

export function verifyCapsuleSignature(capsule: SignedCapsule): boolean {
  const bytes = new TextEncoder().encode(canonicalize(capsuleSigningPayload(capsule)));
  return verifyBytes(capsule.agent_id, bytes, capsule.signature);
}

/**
 * The capsule leaf — chained via `prev_hash` and anchored in Merkle batches.
 * Covers the signed envelope INCLUDING the signature, excluding verifier-derived fields.
 */
export function capsuleLeaf(capsule: SignedCapsule): string {
  return canonicalHash({
    agent_id: capsule.agent_id,
    seq: capsule.seq,
    prev_hash: capsule.prev_hash,
    committed_at: capsule.committed_at,
    kind: capsule.kind,
    body: capsule.body as unknown as CanonicalValue,
    signature: capsule.signature,
  });
}
