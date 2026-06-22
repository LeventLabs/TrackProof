import { sha256Hex } from "@trackproof/core";

export interface PaymentRequest {
  payer: string;
  payee: string;
  /** string-encoded decimal. */
  amount: string;
}

export interface PaymentReceipt extends PaymentRequest {
  payment_ref: string;
  settled_at: number;
}

/** A settlement backend. A live x402 facilitator and the local stub fill the same envelope (R9.3). */
export interface PaymentFacilitator {
  settle(req: PaymentRequest): Promise<PaymentReceipt>;
}

/**
 * Local x402 **stub** — NOT a real settlement. It mints a deterministic receipt so the demo runs
 * offline; a live x402 facilitator implements the same `settle` envelope. The `stub:` prefix keeps
 * stub receipts honestly distinguishable on screen and inside the resulting capsules.
 */
export class StubFacilitator implements PaymentFacilitator {
  private nonce = 0;

  async settle(req: PaymentRequest): Promise<PaymentReceipt> {
    const settled_at = Date.now();
    const payment_ref = "stub:" + sha256Hex(`${req.payer}|${req.payee}|${req.amount}|${this.nonce++}`);
    return { ...req, payment_ref, settled_at };
  }
}
