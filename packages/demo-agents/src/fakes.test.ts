import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCapsule, verifyChain } from "@trackproof/core";
import { FixtureMarketData } from "./fixtures.js";
import { deletedLoserFake, fabricatedPriceFake, seededFakes } from "./fakes.js";

test("fabricated-price fake is structurally valid (G3 ok) but every capsule fails G1", async () => {
  const fake = fabricatedPriceFake(4);
  const source = new FixtureMarketData();

  // The chain itself is well-formed — the tamper is the data, not the structure.
  assert.ok(verifyChain(fake.capsules).ok, "fabricated chain should pass G3");

  let caught = 0;
  for (const cap of fake.capsules) {
    const result = await verifyCapsule(cap, source);
    assert.equal(result.verdict, "FAILED_DATA", `seq ${cap.seq} should fail G1`);
    caught++;
  }
  assert.equal(caught, 4);
  assert.equal(fake.failureClass, "G1");
});

test("deleted-loser fake breaks the hash-chain (G3) at the gap", () => {
  const fake = deletedLoserFake(5, 2);
  assert.equal(fake.capsules.length, 4, "one capsule was deleted");
  const check = verifyChain(fake.capsules);
  assert.equal(check.ok, false);
  assert.equal(check.firstBadSeq, 3, "chain breaks at the capsule after the deleted seq");
  assert.equal(fake.failureClass, "G3");
});

test("fake identities are deterministic across builds (stable artifacts)", () => {
  assert.equal(fabricatedPriceFake().agentId, fabricatedPriceFake().agentId);
  assert.equal(deletedLoserFake().agentId, deletedLoserFake().agentId);
  assert.notEqual(fabricatedPriceFake().agentId, deletedLoserFake().agentId);
});

test("seededFakes yields >= 3 total catches across both failure classes", async () => {
  const fakes = seededFakes();
  assert.equal(fakes.length, 2);
  const source = new FixtureMarketData();

  let catches = 0;
  for (const fake of fakes) {
    if (fake.failureClass === "G3") {
      if (!verifyChain(fake.capsules).ok) catches++;
    } else {
      for (const cap of fake.capsules) {
        if ((await verifyCapsule(cap, source)).verdict !== "PASSED") catches++;
      }
    }
  }
  assert.ok(catches >= 3, `expected >= 3 catches, got ${catches}`);
});
