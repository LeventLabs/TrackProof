import type { KeyObject } from "node:crypto";
import {
  signCapsule,
  capsuleLeaf,
  verifyCapsuleSignature,
  GENESIS_PREV_HASH,
  type CapsuleBody,
  type CapsuleEnvelope,
  type CapsuleKind,
  type SignedCapsule,
} from "./capsule.js";

export interface AppendInput {
  kind: CapsuleKind;
  body: CapsuleBody;
  committed_at: number;
}

/** Append a new signed capsule after `prev` (or as the genesis when `prev` is null). */
export function appendCapsule(
  prev: SignedCapsule | null,
  input: AppendInput,
  agentPublicKeyHex: string,
  privateKey: KeyObject,
): SignedCapsule {
  const env: CapsuleEnvelope = {
    agent_id: agentPublicKeyHex,
    seq: prev ? prev.seq + 1 : 0,
    prev_hash: prev ? capsuleLeaf(prev) : GENESIS_PREV_HASH,
    committed_at: input.committed_at,
    kind: input.kind,
    body: input.body,
  };
  return signCapsule(env, privateKey);
}

export interface ChainCheck {
  ok: boolean;
  length: number;
  /** The seq at which verification first failed, if any. */
  firstBadSeq?: number;
  reason?: string;
}

/**
 * Verify a single agent's capsule chain: seq monotonic from 0, prev_hash links,
 * one agent_id throughout, and every signature valid. Any gap, reorder, tamper,
 * or splice is detected and the first failing seq is reported (G3).
 */
export function verifyChain(capsules: SignedCapsule[]): ChainCheck {
  let prev: SignedCapsule | null = null;

  for (const capsule of capsules) {
    const expectedSeq = prev ? prev.seq + 1 : 0;
    if (capsule.seq !== expectedSeq) {
      return fail(capsules.length, capsule.seq, `expected seq ${expectedSeq}, got ${capsule.seq}`);
    }

    const expectedPrev = prev ? capsuleLeaf(prev) : GENESIS_PREV_HASH;
    if (capsule.prev_hash !== expectedPrev) {
      return fail(capsules.length, capsule.seq, `prev_hash mismatch at seq ${capsule.seq}`);
    }

    if (prev && capsule.agent_id !== prev.agent_id) {
      return fail(capsules.length, capsule.seq, `agent_id changed at seq ${capsule.seq}`);
    }

    if (!verifyCapsuleSignature(capsule)) {
      return fail(capsules.length, capsule.seq, `invalid signature at seq ${capsule.seq}`);
    }

    prev = capsule;
  }

  return { ok: true, length: capsules.length };
}

function fail(length: number, firstBadSeq: number, reason: string): ChainCheck {
  return { ok: false, length, firstBadSeq, reason };
}

/** An agent's latest on-chain committed head (from the HeadRegistry). */
export interface ChainHead {
  seq: number;
  /** Leaf of the agent's latest committed capsule. */
  headLeaf: string;
}

export interface HeadCheck {
  /** The presented chain's head matches the on-chain committed head. */
  ok: boolean;
  /** The presented chain is missing capsules after the committed head (a withheld tail). */
  truncated: boolean;
  reason?: string;
}

/**
 * Check a presented chain's head against the on-chain committed head — the **tail-truncation**
 * defense (G3). `verifyChain` proves a presented chain is internally complete; this proves nothing
 * newer was withheld. `committed` is null when the agent never committed a head on-chain.
 */
export function verifyHead(chain: SignedCapsule[], committed: ChainHead | null): HeadCheck {
  if (committed === null) return { ok: false, truncated: false, reason: "no on-chain head committed" };
  const last = chain[chain.length - 1];
  const lastSeq = last ? last.seq : -1;
  if (lastSeq < committed.seq) {
    return {
      ok: false,
      truncated: true,
      reason: `chain head seq ${lastSeq} is behind the committed seq ${committed.seq} (withheld tail)`,
    };
  }
  if (lastSeq > committed.seq) {
    return {
      ok: false,
      truncated: false,
      reason: `chain head seq ${lastSeq} is ahead of the committed seq ${committed.seq} (commit a newer head)`,
    };
  }
  if (!last || capsuleLeaf(last) !== committed.headLeaf) {
    return { ok: false, truncated: false, reason: "chain head leaf does not match the committed head" };
  }
  return { ok: true, truncated: false };
}
