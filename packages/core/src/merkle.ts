import { sha256Hex } from "./hash.js";

/** Root of an empty tree. */
export const ZERO_ROOT = "0".repeat(64);

/** Commutative (sorted-pair) sha256 hash of two 32-byte hex nodes. */
function hashPair(a: string, b: string): string {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return sha256Hex(Buffer.concat([Buffer.from(lo, "hex"), Buffer.from(hi, "hex")]));
}

export interface MerkleResult {
  root: string;
  /** proofs[i] = the sibling hashes for leaf i, leaf-to-root. */
  proofs: string[][];
}

/**
 * Build a sorted-pair sha256 Merkle tree over 32-byte hex leaves. Odd nodes are duplicated.
 * Pairing is commutative, so proofs are plain sibling lists (no left/right flags) and
 * verification re-sorts each pair. Inclusion is verified off-chain against an anchored root.
 */
export function buildMerkle(leaves: string[]): MerkleResult {
  if (leaves.length === 0) return { root: ZERO_ROOT, proofs: [] };

  const proofs: string[][] = leaves.map(() => []);
  let layer = leaves.slice();
  let groups: number[][] = leaves.map((_, i) => [i]);

  while (layer.length > 1) {
    const nextLayer: string[] = [];
    const nextGroups: number[][] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const leftGroup = groups[i]!;
      if (i + 1 < layer.length) {
        const right = layer[i + 1]!;
        const rightGroup = groups[i + 1]!;
        for (const li of leftGroup) proofs[li]!.push(right);
        for (const ri of rightGroup) proofs[ri]!.push(left);
        nextLayer.push(hashPair(left, right));
        nextGroups.push([...leftGroup, ...rightGroup]);
      } else {
        // Odd node out: duplicate it as its own sibling.
        for (const li of leftGroup) proofs[li]!.push(left);
        nextLayer.push(hashPair(left, left));
        nextGroups.push([...leftGroup]);
      }
    }
    layer = nextLayer;
    groups = nextGroups;
  }

  return { root: layer[0]!, proofs };
}

export function merkleRoot(leaves: string[]): string {
  return buildMerkle(leaves).root;
}

export function verifyMerkleProof(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed === root;
}
