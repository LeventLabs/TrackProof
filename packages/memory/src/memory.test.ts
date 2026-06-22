import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex, verifyChain, verifyMemoryPurchase, type MemoryPurchaseBody } from "@trackproof/core";
import { openStore } from "@trackproof/sdk";
import { MemoryMarket, purchaseSlice, sealBody, StubFacilitator, unsealBody } from "./index.js";

test("sealBody/unsealBody round-trips; a wrong key fails", () => {
  const key = randomBytes(32);
  const sealed = sealBody("short when funding flips negative", key);
  assert.equal(unsealBody(sealed, key), "short when funding flips negative");
  assert.throws(() => unsealBody(sealed, randomBytes(32)));
});

test("publish lists the slice without its key; purchase emits a verifiable memory_purchase capsule", async () => {
  const market = new MemoryMarket();
  const facilitator = new StubFacilitator();
  const sellerHome = mkdtempSync(join(tmpdir(), "tp-mem-s-"));
  const buyerHome = mkdtempSync(join(tmpdir(), "tp-mem-b-"));
  try {
    const seller = openStore(sellerHome);
    const buyer = openStore(buyerHome);
    const body = "short BTC when funding flips negative and the prior high holds";
    const slice = market.publish(seller.keyPair.publicKeyHex, {
      name: "BTC funding edge", scope: "BTCUSDT", price: "5", capsule_refs: ["aa", "bb"], body,
    });

    const listed = market.list();
    assert.equal(listed.length, 1);
    assert.equal((listed[0] as unknown as { key?: unknown }).key, undefined); // key never leaks
    assert.equal(listed[0]!.body_hash, sha256Hex(body));

    const result = await purchaseSlice(market, facilitator, buyer, slice.slice_id);
    assert.equal(result.body, body);
    assert.ok(result.payment_ref.startsWith("stub:"));
    assert.equal(result.capsule.kind, "memory_purchase");
    const purchased = result.capsule.body as MemoryPurchaseBody;
    assert.equal(purchased.body_hash, slice.body_hash);
    assert.equal(purchased.seller_agent_id, seller.keyPair.publicKeyHex);
    assert.equal(verifyMemoryPurchase(result.capsule).verdict, "PASSED");
    assert.ok(verifyChain([result.capsule]).ok);
  } finally {
    rmSync(sellerHome, { recursive: true, force: true });
    rmSync(buyerHome, { recursive: true, force: true });
  }
});

test("an agent cannot buy its own slice; an unknown slice throws", async () => {
  const market = new MemoryMarket();
  const facilitator = new StubFacilitator();
  const home = mkdtempSync(join(tmpdir(), "tp-mem-"));
  try {
    const agent = openStore(home);
    const slice = market.publish(agent.keyPair.publicKeyHex, { name: "x", scope: "BTCUSDT", price: "1", capsule_refs: [], body: "b" });
    await assert.rejects(() => purchaseSlice(market, facilitator, agent, slice.slice_id), /cannot buy its own/);
    await assert.rejects(() => purchaseSlice(market, facilitator, agent, "nope"), /unknown slice/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
