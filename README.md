# TrackProof

**Verifiable track records for AI trading agents.** Prove real alpha, catch fake ROI, and let agents trade on proven reputation.

TrackProof is a **track-record notary** for AI trading agents. Every simulated decision an agent makes becomes a signed, hash-chained **Capsule** that can be independently replayed against real market data, committed on-chain *before* its outcome is known, and proven to belong to a complete, gap-free history. Honest agents can prove their performance; a fabricated "+412%" record fails verification and is caught.

> **Status:** runnable from a clean clone — `npm install && npm test` (79 tests; +7 Solidity via `npm run test:contracts`). The on-chain layer is **live on Base Sepolia** (addresses below). **Simulation / paper trading only — no real capital, no real-account orders.** Built for the Bitget AI Base Camp Hackathon S1 (Track 2 · Trading Infra).

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

// kind = "memory_purchase" → provenance receipt for a bought edge (MemorySlice market — roadmap)
{ slice_id, seller_agent_id, price, payment_ref, body_hash }
```

Verification re-fetches the pinned history, recomputes the input digest (G1), walks the hash chain (G3), checks the on-chain inclusion proof (G2), and derives P&L under a fixed, public fill model (market → next open; limit → cross-at-limit). Only re-fetchable history (candles; funding history and public fills are planned) is part of a proof; the order book, ticker snapshots, and any model reasoning are recorded as *attested* context and never used as evidence.

## Quickstart (≈5 minutes)

No API keys: market history comes from Bitget's **public** endpoints, and on-chain **reads are keyless**. Only *writing* a new anchor needs a funded Base Sepolia key.

```bash
git clone <repo-url> trackproof && cd trackproof
npm install && npm test          # builds + runs the suite (79 tests; +7 Solidity via npm run test:contracts)

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

A live evidence run notarized **1,903 capsules across 3 agents** (3 Merkle roots on Base, one inclusion proof per agent), with **60/60 sampled decisions re-verified (G1)** and **5/5 seeded fakes caught** (fabricated prices → G1; a deleted losing trade → G3).

## Architecture

A TypeScript monorepo (npm workspaces, native-first — `node:crypto` for signing, `fetch` for data; the only runtime deps are `viem` for Base and the MCP SDK):

| Package | Responsibility |
|---|---|
| `core` | Capsule schema, canonical JSON, Ed25519 signing, hash chain, replay/G1, Merkle anchor + inclusion + certifiability |
| `bitget` | Read-only **public** market-data adapter (`history-candles`, paginated, keyless) |
| `base` | On-chain `AnchorStore` over the deployed `Anchor` contract (`viem`; keyless reads) |
| `sdk` | File-backed agent store + the ~12-line wrapper above |
| `cli` | `trackproof` — `emit` · `anchor` · `replay` · `verify` · `demo` · `evidence` · `install` |
| `demo-agents` | 3 seeded-deterministic agents, the evidence pipeline, and the self-contained HTML evidence page |
| `mcp-server` | stdio MCP server (`capsule_emit` / `capsule_verify`) |
| `skill` | Installable agent skill (`trackproof install`) |
| `contracts/` | Solidity — `Anchor` + ERC-8004-compatible `IdentityRegistry` (Foundry-tested) |

The capsule / replay / anchor core is exchange-agnostic; Bitget is a thin read-only adapter, Base carries the identity registry and Merkle anchor.

## Safety

- **Simulation / paper trading only.** Market data comes from Bitget's public read-only endpoints; **no code path places a real-account order**, and no API keys are used.
- On-chain components run on **Base Sepolia** (testnet) and hold no funds.
- **Unaudited.** Not custody, trading, or investment advice. ERC-8004-*compatible* (not yet conformant).

## Roadmap

- **MemorySlice market** — agents sell a learned edge to other agents over **x402** (Base), with a `memory_purchase` capsule as the provenance receipt.
- Funding/fills folded into the proof; memory **royalties** (sellers paid when buyers profit from a cited slice).
- Full **ERC-8004** — Reputation and Validation registries (the MVP ships an ERC-8004-*compatible* Identity registry).
- **Challenge bonds** — stake against a claimed record; replay settles the bond. Additional venues and chains.

## License

MIT.
