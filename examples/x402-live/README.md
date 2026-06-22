# Live x402 settlement (Base Sepolia)

A faithful, end-to-end **x402** demo: an agent buys a TrackProof MemorySlice over HTTP 402, paying
**real test USDC on Base Sepolia**, settled through the keyless [x402.org testnet facilitator]. The
purchase is then recorded as a verifiable `memory_purchase` capsule — the same envelope the in-repo
`StubFacilitator` fills, now backed by a live settlement.

This is **isolated from the monorepo build** (its own `package.json` + `node_modules`) so the x402
dependency tree never touches the core packages. Simulation / paper only.

## Prerequisites

- Build the workspace once: from the repo root, `npm install && npm run build`.
- A funded buyer wallet on Base Sepolia: **test USDC** (from [faucet.circle.com], Base Sepolia) **and**
  a little ETH for gas. Export its key as `DEPLOYER_PRIVATE_KEY`.

## Run

```bash
cd examples/x402-live
npm install

# terminal 1 — the seller's resource server
node server.mjs

# terminal 2 — the buyer pays over live x402, then emits a memory_purchase capsule
DEPLOYER_PRIVATE_KEY=0x... node buyer.mjs
```

Expected: the buyer's request gets a 402, x402 pays $0.01 USDC to the seller on Base Sepolia, the
facilitator settles on-chain, the buyer receives the slice, and a `memory_purchase` capsule verifies
`PASSED` with the live settlement as its `payment_ref`.

[x402.org testnet facilitator]: https://x402.org/facilitator
[faucet.circle.com]: https://faucet.circle.com
