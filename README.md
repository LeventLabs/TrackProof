# TrackProof

**Verifiable track records for AI trading agents.** Prove real alpha, catch fake ROI, and let agents trade on proven reputation.

TrackProof is a **track-record notary** for AI trading agents. Every simulated decision an agent makes becomes a signed, hash-chained **Capsule** that can be independently replayed against real market data, committed on-chain *before* its outcome is known, and proven to belong to a complete, gap-free history. Honest agents can prove their performance; a fabricated "+412%" record fails verification and is caught.

> **Status:** runnable from a clean clone — `npm install && npm test` (89 tests; +7 Solidity via `npm run test:contracts`). The on-chain layer is **live on Base Sepolia** (addresses below). **Simulation / paper trading only — no real capital, no real-account orders.** Built for the Bitget AI Base Camp Hackathon S1 (Track 2 · Trading Infra).

---

## Why

AI trading agents are everywhere, but their track records are unverifiable:

- Anyone can claim a return with a screenshot. Nobody can independently confirm the trades happened, at prices that really printed, decided before the outcome was known.
- Reputation isn't portable — performance is locked inside one platform's walled garden.
- Agents have no machine-native way to monetize an edge they actually learned.

TrackProof closes the first two gaps and opens the third.

## What it proves — and what it doesn't

TrackProof certifies the **integrity of an agent's ledger**, not the **soundness of its reasoning**. That line is the whole point: an LLM agent's reasoning can't be replayed, but its *track record* can be made tamper-evident. Three independent guarantees:

- **G1 — Authentic data.** Every decision references real, re-fetchable market history. Verification re-fetches it from Bitget and confirms the agent acted on prices that actually printed. Fabricated inputs fail (`FAILED_DATA`).
- **G2 — Decision before outcome.** Each capsule is committed to an on-chain Merkle anchor on Base. A trade is only *certifiable* if it was anchored **before** its outcome window began (`anchor_block_time < outcome_start`). Backdating fails.
- **G3 — Complete history.** Capsules form a per-agent hash chain from an on-chain enrollment genesis. Quietly deleting a losing trade breaks the chain and is detected.

**Honest boundary.** TrackProof proves: *"for any agent enrolled since block T₀, here is its complete, tamper-evident, decision-time-committed ledger, every trade settled against real market data."* It does **not** prove an agent's reasoning is correct, and it cannot prove an operator didn't also run other agents they never enrolled. Reputation therefore weighs **anchored-history age and length** — a long anchored record can't be fabricated after the fact, and a freshly enrolled agent is inherently low-trust. P&L is **descriptive, not execution-realistic** (no slippage modeling — the order book is not historically replayable).

**Positioning.** TrackProof is verification *infrastructure* (Track 2 · Trading Infra), agent-agnostic — it proves ledgers, it doesn't trade. Any agent plugs in via the SDK or the MCP server (an LLM agent, a Skill-Hub bot, or a deterministic strategy); the notary treats them all the same. The three demo agents are intentionally seeded-**deterministic** so a judge can reproduce the evidence byte-for-byte — they're demo *data*, not the product.

Two verification tiers:

- **Notarized** (every agent) — committed actions + real outcomes + complete chain.
- **Strategy-reproducible** (deterministic agents) — additionally, the strategy re-derives the action from the pinned inputs.

## How it works

```
  agent decision ──► Capsule (signed, hash-chained)
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                 ▼
      G1 replay       G2 anchor         G3 chain
   (refetch + digest) (Merkle root      (seq + prev_hash
                       on Base)          from genesis)
          └───────────────┼────────────────┘
                          ▼
              verdict (green / red) + derived P&L
                          │
                          ▼
            reputation · leaderboard · evidence page
```

The unit of evidence is a **Capsule** — a signed, canonical-JSON envelope with a discriminated `kind`:

```jsonc
Capsule {
  agent_id, seq, prev_hash, committed_at,        // envelope (signed, hash-chained)
  kind: "trade_decision" | "memory_purchase",
  body, signature
}

// kind = "trade_decision"  → the headline DecisionCapsule
{ market_ref, inputs_digest, action, repro?, attested? }

// kind = "memory_purchase" → provenance receipt for a bought edge (MemorySlice market; x402 stub today)
{ slice_id, seller_agent_id, price, payment_ref, body_hash }
```

Verification re-fetches the pinned history, recomputes the input digest (G1), walks the hash chain (G3), checks the on-chain inclusion proof (G2), and derives P&L under a fixed, public fill model (market → next open; limit → cross-at-limit). Only re-fetchable history (candles and funding-rate history; public fills are planned) is part of a proof; the order book, ticker snapshots, and any model reasoning are recorded as *attested* context and never used as evidence.

## Quickstart (≈5 minutes)

No API keys: market history comes from Bitget's **public** endpoints, and on-chain **reads are keyless**. Only *writing* a new anchor needs a funded Base Sepolia key.

```bash
git clone <repo-url> trackproof && cd trackproof
npm install && npm test          # builds + runs the suite (89 tests; +7 Solidity via npm run test:contracts)

# 1. Emit a capsule over real BTCUSDT history, then verify it locally (G1 + G3)
npm run trackproof -- emit   --instrument BTCUSDT --demo
npm run trackproof -- replay --last              # re-fetches history (G1) + walks the chain (G3)

# 2. Add the on-chain commitment (G2). Reads are keyless against the live Anchor;
#    writing the anchor needs a funded Base Sepolia key.
export DEPLOYER_PRIVATE_KEY=0x...               # a funded Base Sepolia test key
npm run trackproof -- anchor                     # Merkle-roots the chain, submits the root on Base
npm run trackproof -- verify --last --with-anchor   # G1 + G3 + G2 (on-chain inclusion + certifiability)

# 3. The full demo: 3 seeded agents over real history → anchored → verifiable evidence page
npm run trackproof -- demo                       # add --no-anchor to skip the on-chain write
npm run trackproof -- evidence --html evidence.html   # open it in a browser (also: --json)

# 4. Install the agent skill into your coding agent
npm run trackproof -- install --target claude    # also: --target codex | openclaw
```

`trackproof evidence` prints (and `--html` renders) the verifiable-usage report: a reputation leaderboard, per-agent profiles with green/red P&L sparklines and on-chain links, and the caught fakes. The page is a single self-contained HTML file — no server, no scripts, no external resources.

## Wrap your agent (~12 lines)

```ts
import { TrackProof } from "@trackproof/sdk";

const tp = new TrackProof();                      // file-backed store + a generated test signing key

// Call this wherever your agent makes a (simulated) decision:
const capsule = tp.emit({
  instrument:  "BTCUSDT",
  granularity: "1min",
  candles,                                         // the closed-candle history you acted on
  action:      { side: "short", size: "1", type: "market" },
  reasoning:   "funding flip + lower high",        // attested context — recorded, never used as proof
});
// → a signed, hash-chained DecisionCapsule, persisted immediately.
// Replayable for G1/G3 right away; fully verifiable (incl. the G2 commitment) once anchored on Base.
```

## MCP server

Any MCP client (Claude Code, Cursor, …) can drive TrackProof over stdio:

```bash
# from a clean clone (after npm run build):
claude mcp add -s user trackproof -- node packages/mcp-server/dist/index.js
#   (once published, the shortcut is: npx -y @trackproof/mcp-server)
```

Tools: **`capsule_emit`** (record a paper trade decision over real Bitget history) and **`capsule_verify`** (G1 replay + G3 chain + optional on-chain G2). `memory.*` tools land with the MemorySlice market (roadmap).

## Live deployment (Base Sepolia · chainId 84532)

| Contract | Address |
|---|---|
| `Anchor` (Merkle-root registry) | [`0x290825Ee1124617649c527A2230881e63173519D`](https://sepolia.basescan.org/address/0x290825Ee1124617649c527A2230881e63173519D) |
| `IdentityRegistry` (ERC-8004-compatible) | [`0xc785F1124d7C8e77aFF446B377C013fE4A2857F9`](https://sepolia.basescan.org/address/0xc785F1124d7C8e77aFF446B377C013fE4A2857F9) |

A live evidence run notarized **over 1,900 capsules across 3 agents** (3 Merkle roots on Base, one inclusion proof per agent), with **60/60 sampled decisions re-verified (G1)**, **2 seeded fakes caught** across 5 capsule-level checks (fabricated prices → G1 ×4; a deleted losing trade → G3), and **6 agent-to-agent MemorySlice handoffs** over the x402 stub — each a verifiable `memory_purchase` capsule.

Those capsules are **inclusion-proven** (each sits in an on-chain anchored Merkle root) over *backfilled* history — so by the certifiability rule (anchored **before** the outcome, R4.4) they are inclusion-proven, **not** certifiable. Certifiability is enforced by the mechanism + unit tests and **demonstrated live** in [`scripts/certifiable-demo.mjs`](scripts/certifiable-demo.mjs): a fresh decision anchored on Base Sepolia **58 s before** its outcome window opened → `certifiable=true` (block `43190895`). In real-time operation that is the normal path; the bulk run backfills history (whose outcomes already printed) to show G1/G3/inclusion at scale.

## Architecture

A TypeScript monorepo (npm workspaces, native-first — `node:crypto` for signing, `fetch` for data; the only third-party runtime deps are `viem` (Base) and the MCP SDK + `zod` (the MCP server)):

| Package | Responsibility |
|---|---|
| `core` | Capsule schema, canonical JSON, Ed25519 signing, hash chain, replay/G1, Merkle anchor + inclusion + certifiability |
| `bitget` | Read-only **public** market-data adapter (`history-candles`, paginated, keyless) |
| `base` | On-chain `AnchorStore` over the deployed `Anchor` contract (`viem`; keyless reads) |
| `sdk` | File-backed agent store + the ~12-line wrapper above |
| `cli` | `trackproof` — `emit` · `anchor` · `replay` · `verify` · `demo` · `evidence` · `install` |
| `demo-agents` | 3 seeded-deterministic agents, the evidence pipeline, and the self-contained HTML evidence page |
| `memory` | MemorySlice market + x402 **stub** — AES-256-GCM-sealed know-how, verifiable `memory_purchase` capsules |
| `mcp-server` | stdio MCP server (`capsule_emit` / `capsule_verify`) |
| `skill` | Installable agent skill (`trackproof install`) |
| `contracts/` | Solidity — `Anchor` + ERC-8004-compatible `IdentityRegistry` (Foundry-tested) |

The capsule / replay / anchor core is exchange-agnostic; Bitget is a thin read-only adapter, Base carries the identity registry and Merkle anchor.

## Safety

- **Simulation / paper trading only.** Market data comes from Bitget's public read-only endpoints; **no code path places a real-account order**, and no API keys are used.
- On-chain components run on **Base Sepolia** (testnet) and hold no funds.
- **Unaudited.** Not custody, trading, or investment advice. ERC-8004-*compatible* (not yet conformant).

## Trust model & limitations

What the on-chain layer does and doesn't bind, for a sharp reviewer:

- **The contract is a timestamped Merkle-root store, not an "on-chain verifier."** Inclusion is recomputed *off-chain* against a root the client reads from the chain; `Anchor` only records `root → (block, timestamp)`. `submitRoot` is permissionless (correct for a public notary), and G2's "before the outcome" rests on `block.timestamp`, which on an L2 is sequencer-set.
- **Bulk evidence is inclusion-proven backfill, not certifiable.** The showcased run anchors historical decisions whose outcomes already printed; certifiability (anchored *before* the outcome, R4.4) is the real-time path, demonstrated live in `scripts/certifiable-demo.mjs`. Reputation age uses the **on-chain anchor time** (unfakeable), not the agent's local `committed_at`.
- **On-chain identity is deployed but not yet wired.** `IdentityRegistry` is live + tested but not called in the agent lifecycle, and `enroll` is currently unauthenticated (anyone could enroll any agent id). The "enrollment genesis" is a local chain seq 0. *Roadmap:* authenticate `enroll` (bind to `msg.sender` / a signature) and wire it so age is genuinely on-chain.
- **Tail-truncation is not yet prevented.** The anchor stores roots, not a per-agent *head*, so an operator could withhold recent (losing) capsules and present an older anchored prefix. G3 detects deletions *within* a presented chain, not withheld tails. *Roadmap:* commit a per-agent monotonic head on-chain.
- **The MemorySlice market is a key-release gate, not an on-chain escrow.** It trusts the facilitator receipt and the in-repo flow uses an x402 **stub**; a real on-chain USDC settlement is demonstrated in `examples/x402-live`.
- **Cross-language canonical JSON is constrained.** Keys sort by JS UTF-16 code units and numbers format per ECMAScript; a reimplementation must match these (mitigated because market values are string-encoded, with a golden-vector test).
- **Keys + persistence are demo-grade.** Agent signing keys are plaintext PEM (`0600`, no passphrase/rotation/KMS); state is append-only JSONL with no locking. Fine for a Base Sepolia testnet demo, not production.

The fixture G1 unit tests prove internal *consistency*; **authenticity** is proven by the live Bitget run.

## Roadmap

- **Live x402 settlement** — the MemorySlice market ships a local x402 **stub** for the reproducible demo; a faithful **live** x402 settlement (real test USDC on Base Sepolia) is demonstrated in [`examples/x402-live`](examples/x402-live) behind the same `settle` envelope.
- Public **fills** folded into the proof (funding-rate history already is); memory **royalties** (sellers paid when buyers profit from a cited slice).
- Full **ERC-8004** — Reputation and Validation registries (the MVP ships an ERC-8004-*compatible* Identity registry).
- **Challenge bonds** — stake against a claimed record; replay settles the bond. Additional venues and chains.

## License

MIT.
