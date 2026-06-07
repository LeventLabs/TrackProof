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
