import { randomBytes } from "node:crypto";
import { canonicalBytes, sha256Hex } from "@trackproof/core";
import { sealBody, type Sealed } from "./seal.js";

/** A published, sealed unit of agent know-how (R9.1). The body is encrypted at rest. */
export interface MemorySlice {
  slice_id: string;
  seller_agent_id: string;
  name: string;
  scope: string;
  /** string-encoded decimal price. */
  price: string;
  /** leaf hashes of the seller capsules this edge derives from. */
  capsule_refs: string[];
  /** sha256 of the unsealed body — the provenance a buyer's capsule commits to. */
  body_hash: string;
  sealed_body: Sealed;
  pubkey: string;
}

export interface PublishParams {
  name: string;
  scope: string;
  price: string;
  capsule_refs: string[];
  body: string;
}

/**
 * An in-process MemorySlice market. It holds published slices and releases each slice's symmetric key
 * against a **facilitator payment receipt** for the slice price (see `purchaseSlice`). The receipt is
 * trusted from the facilitator: the local stub mints `stub:` receipts without a real settlement — a
 * real on-chain settlement is shown in `examples/x402-live`. This is a key-release gate, not an
 * on-chain escrow.
 */
export class MemoryMarket {
  private readonly entries = new Map<string, { slice: MemorySlice; key: Buffer }>();

  publish(sellerAgentId: string, params: PublishParams): MemorySlice {
    const key = randomBytes(32);
    const body_hash = sha256Hex(params.body);
    const slice_id = sha256Hex(canonicalBytes({ seller: sellerAgentId, name: params.name, body_hash }));
    const slice: MemorySlice = {
      slice_id,
      seller_agent_id: sellerAgentId,
      name: params.name,
      scope: params.scope,
      price: params.price,
      capsule_refs: params.capsule_refs,
      body_hash,
      sealed_body: sealBody(params.body, key),
      pubkey: sellerAgentId,
    };
    this.entries.set(slice_id, { slice, key });
    return slice;
  }

  /** Public listing — never exposes the slice's key. */
  list(): MemorySlice[] {
    return [...this.entries.values()].map((e) => e.slice);
  }

  get(sliceId: string): MemorySlice | undefined {
    return this.entries.get(sliceId)?.slice;
  }

  /**
   * Release the slice key against a facilitator receipt that paid the slice price to the seller. The
   * receipt is trusted from the facilitator (the stub mints it without a real settlement); this checks
   * the receipt is well-formed and matches the slice, not that funds actually moved on-chain.
   */
  releaseKey(sliceId: string, receipt: { payee: string; amount: string; payment_ref: string }): Buffer {
    const entry = this.entries.get(sliceId);
    if (!entry) throw new Error(`unknown slice ${sliceId}`);
    if (!receipt.payment_ref) throw new Error("missing payment reference");
    if (receipt.payee !== entry.slice.seller_agent_id) {
      throw new Error("receipt payee is not the slice seller");
    }
    if (Number(receipt.amount) < Number(entry.slice.price)) {
      throw new Error("receipt amount is below the slice price");
    }
    return entry.key;
  }
}
