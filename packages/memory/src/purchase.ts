import { appendCapsule, sha256Hex, type MemoryPurchaseBody, type SignedCapsule } from "@trackproof/core";
import { appendCapsuleToStore, lastCapsule, type AgentStore } from "@trackproof/sdk";
import type { PaymentFacilitator } from "./facilitator.js";
import type { MemoryMarket } from "./market.js";
import { unsealBody } from "./seal.js";

export interface PurchaseResult {
  capsule: SignedCapsule;
  body: string;
  payment_ref: string;
}

/**
 * Buy a MemorySlice (R9.2): settle payment via the facilitator (stub x402), get the released key,
 * unseal the body, verify it against the committed `body_hash`, and append a signed
 * `memory_purchase` capsule to the buyer's chain. Simulation / paper only.
 */
export async function purchaseSlice(
  market: MemoryMarket,
  facilitator: PaymentFacilitator,
  buyer: AgentStore,
  sliceId: string,
): Promise<PurchaseResult> {
  const slice = market.get(sliceId);
  if (!slice) throw new Error(`unknown slice ${sliceId}`);
  const buyerId = buyer.keyPair.publicKeyHex;
  if (buyerId === slice.seller_agent_id) throw new Error("an agent cannot buy its own slice");

  const receipt = await facilitator.settle({ payer: buyerId, payee: slice.seller_agent_id, amount: slice.price });
  const key = market.releaseKey(sliceId, receipt);
  const body = unsealBody(slice.sealed_body, key);
  if (sha256Hex(body) !== slice.body_hash) throw new Error("unsealed body does not match the committed body_hash");

  const purchaseBody: MemoryPurchaseBody = {
    slice_id: slice.slice_id,
    seller_agent_id: slice.seller_agent_id,
    price: slice.price,
    payment_ref: receipt.payment_ref,
    body_hash: slice.body_hash,
  };
  const capsule = appendCapsule(
    lastCapsule(buyer),
    { kind: "memory_purchase", body: purchaseBody, committed_at: receipt.settled_at },
    buyerId,
    buyer.keyPair.privateKey,
  );
  appendCapsuleToStore(buyer, capsule);
  return { capsule, body, payment_ref: receipt.payment_ref };
}
