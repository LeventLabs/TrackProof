import { buildMerkle, verifyMerkleProof } from "./merkle.js";
import { capsuleLeaf, type SignedCapsule } from "./capsule.js";

/** A root anchored on-chain: the root plus the block/time that commits it (G2). */
export interface AnchorRecord {
  root: string;
  /** Monotonic block/sequence number of the anchoring transaction. */
  block: number;
  /** ms; the on-chain block timestamp — the G2 commitment instant. */
  timestamp: number;
}

/**
 * The commitment substrate the G2 layer inverts on. The on-chain (Base) implementation
 * replaces the in-memory one in production; the off-chain Merkle/inclusion logic is identical.
 */
export interface AnchorStore {
  submitRoot(root: string): Promise<AnchorRecord>;
  getByRoot(root: string): Promise<AnchorRecord | null>;
  getByBlock(block: number): Promise<AnchorRecord | null>;
}

/** In-memory AnchorStore for local/dev/testing. Append-only: a root anchors exactly once. */
export class MemoryAnchorStore implements AnchorStore {
  private readonly byRoot = new Map<string, AnchorRecord>();
  private readonly byBlock = new Map<number, AnchorRecord>();
  private block = 0;

  /** `now` is injectable so tests get deterministic timestamps. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  async submitRoot(root: string): Promise<AnchorRecord> {
    const existing = this.byRoot.get(root);
    if (existing) return existing;
    const record: AnchorRecord = { root, block: ++this.block, timestamp: this.now() };
    this.byRoot.set(root, record);
    this.byBlock.set(record.block, record);
    return record;
  }

  async getByRoot(root: string): Promise<AnchorRecord | null> {
    return this.byRoot.get(root) ?? null;
  }

  async getByBlock(block: number): Promise<AnchorRecord | null> {
    return this.byBlock.get(block) ?? null;
  }
}

/** Merkle-root a batch of capsules, submit the root, and return the record + per-leaf proofs. */
export async function anchorCapsules(
  store: AnchorStore,
  capsules: SignedCapsule[],
): Promise<{ record: AnchorRecord; proofs: Map<string, string[]> }> {
  const leaves = capsules.map(capsuleLeaf);
  const { root, proofs } = buildMerkle(leaves);
  const record = await store.submitRoot(root);
  const map = new Map<string, string[]>();
  leaves.forEach((leaf, i) => map.set(leaf, proofs[i]!));
  return { record, proofs: map };
}

/** G2 inclusion: the capsule's leaf is provably in the anchored root. */
export function verifyInclusion(capsule: SignedCapsule, proof: string[], record: AnchorRecord): boolean {
  return verifyMerkleProof(capsuleLeaf(capsule), proof, record.root);
}

/**
 * R4.4 certifiability: the commitment must precede the outcome. A trade is certifiable only if
 * the anchor's block timestamp is strictly before the outcome evaluation start (the fill time).
 */
export function isCertifiable(record: AnchorRecord, outcomeStart: number): boolean {
  return record.timestamp < outcomeStart;
}

export interface CommitmentVerification {
  /** Merkle inclusion in the anchored root holds. */
  included: boolean;
  /** Anchored strictly before the outcome started (R4.4). */
  certifiable: boolean;
  /** The anchor's commitment timestamp. */
  committedAt: number;
  reason?: string;
}

/** Compose G2: inclusion proof + the certifiability rule against the outcome start. */
export function verifyCommitment(
  capsule: SignedCapsule,
  proof: string[],
  record: AnchorRecord,
  outcomeStart: number | undefined,
): CommitmentVerification {
  const included = verifyInclusion(capsule, proof, record);
  const certifiable = included && outcomeStart !== undefined && isCertifiable(record, outcomeStart);
  let reason: string | undefined;
  if (!included) reason = "capsule not included in the anchored root";
  else if (outcomeStart === undefined) reason = "no outcome start to certify against";
  else if (!certifiable) reason = "anchored at or after the outcome start";
  return { included, certifiable, committedAt: record.timestamp, reason };
}
