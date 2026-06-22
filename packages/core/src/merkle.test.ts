import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMerkle, merkleRoot, verifyMerkleProof, ZERO_ROOT } from "./merkle.js";
import { sha256Hex } from "./hash.js";

const leaf = (s: string): string => sha256Hex(s);

test("an empty tree is the zero root", () => {
  assert.equal(merkleRoot([]), ZERO_ROOT);
});

test("a single leaf: the root is the domain-separated leaf hash, and an empty proof verifies", () => {
  const l = leaf("a");
  const { root, proofs } = buildMerkle([l]);
  assert.notEqual(root, l); // domain-separated: the tree leaf is distinct from the raw leaf
  assert.ok(verifyMerkleProof(l, proofs[0]!, root));
});

test("domain separation: an internal node can never verify as a leaf", () => {
  const { root } = buildMerkle([leaf("a"), leaf("b")]); // root is an internal node
  assert.equal(verifyMerkleProof(root, [], root), false); // re-presenting a node hash as a leaf fails
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
