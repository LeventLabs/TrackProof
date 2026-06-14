import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMerkle, merkleRoot, verifyMerkleProof, ZERO_ROOT } from "./merkle.js";
import { sha256Hex } from "./hash.js";

const leaf = (s: string): string => sha256Hex(s);

test("an empty tree is the zero root", () => {
  assert.equal(merkleRoot([]), ZERO_ROOT);
});

test("a single leaf: root equals the leaf and an empty proof verifies", () => {
  const l = leaf("a");
  const { root, proofs } = buildMerkle([l]);
  assert.equal(root, l);
  assert.ok(verifyMerkleProof(l, proofs[0]!, root));
});

test("every leaf's proof verifies (even count)", () => {
  const leaves = ["a", "b", "c", "d"].map(leaf);
  const { root, proofs } = buildMerkle(leaves);
  leaves.forEach((l, i) => assert.ok(verifyMerkleProof(l, proofs[i]!, root), `leaf ${i}`));
});

test("every leaf's proof verifies (odd count)", () => {
  const leaves = ["a", "b", "c", "d", "e"].map(leaf);
  const { root, proofs } = buildMerkle(leaves);
  leaves.forEach((l, i) => assert.ok(verifyMerkleProof(l, proofs[i]!, root), `leaf ${i}`));
});

test("a wrong leaf or a tampered proof fails", () => {
  const leaves = ["a", "b", "c", "d"].map(leaf);
  const { root, proofs } = buildMerkle(leaves);
  assert.equal(verifyMerkleProof(leaf("x"), proofs[0]!, root), false);
  const tampered = [...proofs[0]!];
  tampered[0] = leaf("z");
  assert.equal(verifyMerkleProof(leaves[0]!, tampered, root), false);
});

test("pairing is commutative (sibling order within a pair does not change the root)", () => {
  const a = leaf("a");
  const b = leaf("b");
  assert.equal(merkleRoot([a, b]), merkleRoot([b, a]));
});
