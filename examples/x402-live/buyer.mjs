// x402 buyer: pays for the MemorySlice over live x402 (real test-USDC settlement on Base Sepolia),
// then records the purchase as a verifiable `memory_purchase` capsule. Simulation / paper only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { x402Client, x402HTTPClient, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { appendCapsule, sha256Hex, verifyMemoryPurchase } from "../../packages/core/dist/index.js";
import { appendCapsuleToStore, lastCapsule, openStore } from "../../packages/sdk/dist/index.js";

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) throw new Error("set DEPLOYER_PRIVATE_KEY — the buyer wallet, funded with test USDC + Base Sepolia ETH");
const url = process.env.SLICE_URL ?? "http://localhost:4021/slice";

const signer = privateKeyToAccount(pk);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

console.log(`buyer ${signer.address} — buying the MemorySlice over live x402…`);
const response = await fetchWithPayment(url, { method: "GET" });
if (!response.ok) {
  // The exact-scheme USDC requirements arrive in the PAYMENT-REQUIRED header; a 402 here means the
  // payment didn't settle — almost always because the buyer wallet holds no test USDC on Base Sepolia.
  console.error(`request failed: HTTP ${response.status} — fund ${signer.address} with test USDC (faucet.circle.com, Base Sepolia).`);
  process.exit(1);
}
const slice = await response.json();

const httpClient = new x402HTTPClient(client);
const settle = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
console.log("x402 settlement:", JSON.stringify(settle));
const tx = settle?.transaction ?? settle?.txHash ?? "";
const payment_ref = `x402:base-sepolia:${tx || JSON.stringify(settle)}`;

// Record the purchase as a verifiable memory_purchase capsule (the provenance receipt).
const home = mkdtempSync(join(tmpdir(), "x402-buyer-"));
try {
  const store = openStore(home);
  const body = {
    slice_id: slice.slice_id,
    seller_agent_id: slice.seller,
    price: "0.01",
    payment_ref,
    body_hash: sha256Hex(slice.body),
  };
  const cap = appendCapsule(
    lastCapsule(store),
    { kind: "memory_purchase", body, committed_at: Date.now() },
    store.keyPair.publicKeyHex,
    store.keyPair.privateKey,
  );
  appendCapsuleToStore(store, cap);
  console.log(`memory_purchase capsule: payment_ref=${payment_ref}`);
  console.log(`verifyMemoryPurchase: ${verifyMemoryPurchase(cap).verdict}`);
  console.log(`slice body received: ${JSON.stringify(slice.body)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
