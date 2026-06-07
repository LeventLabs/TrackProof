# TrackProof

**Verifiable track records for AI trading agents.** Prove real alpha, catch fake ROI, and let agents trade on proven reputation.

TrackProof is a **track-record notary** for AI trading agents. Every simulated decision an agent makes becomes a signed, hash-chained **Capsule** that can be independently replayed against real market data, committed on-chain *before* its outcome is known, and proven to belong to a complete, gap-free history. Honest agents can prove their performance; a fabricated "+412%" record fails verification and is caught.

> **Status:** active development — Bitget AI Base Camp Hackathon S1 (Track 2 · Trading Infra). **Simulation / paper trading only — no real capital.** Reproducible from a clean clone (see Quickstart); interfaces may change before the final release.

---

## Why

AI trading agents are everywhere, but their track records are unverifiable:

- Anyone can claim a return with a screenshot. Nobody can independently confirm the trades happened, at prices that really printed, decided before the outcome was known.
- Reputation isn't portable — performance is locked inside one platform's walled garden.
- Agents have no machine-native way to monetize an edge they actually learned.

TrackProof closes the first two gaps and opens the third.

## What it proves — and what it doesn't

TrackProof certifies the **integrity of an agent's ledger**, not the **soundness of its reasoning**. That line is the whole point: an LLM agent's reasoning can't be replayed, but its *track record* can be made tamper-evident. Three independent guarantees:

- **G1 — Authentic data.** Every decision references real, re-fetchable market history. Verification re-fetches it and confirms the agent acted on prices that actually printed. Fabricated inputs fail.
- **G2 — Decision before outcome.** Each capsule is committed to an on-chain Merkle anchor at a cadence shorter than the trade horizon. A trade is only credited if it was anchored *before* its outcome window began (`anchor_block_time < outcome_start`). Backdating fails.
- **G3 — Complete history.** Capsules form a per-agent hash chain from an on-chain enrollment genesis. Quietly deleting a losing trade breaks the chain and is detected.

**Honest boundary.** TrackProof proves: *"for any agent enrolled since block T₀, here is its complete, tamper-evident, decision-time-committed ledger, every trade settled against real market data."* It does **not** prove an agent's reasoning is correct, and it cannot prove an operator didn't also run other agents they never enrolled. Reputation therefore weighs **anchored-history age and length** — a long anchored record can't be fabricated after the fact, and a freshly enrolled agent is inherently low-trust.

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
     reputation · leaderboard · MemorySlice market (x402)
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

// kind = "memory_purchase" → provenance receipt for a bought edge
{ slice_id, seller_agent_id, price, payment_ref, body_hash }
```

Verification re-fetches the pinned history, recomputes the input digest (G1), walks the hash chain (G3), checks the on-chain inclusion proof (G2), and derives P&L under a fixed, public fill model. **P&L is descriptive, not execution-realistic** — there is no slippage modeling, because the order book is not historically replayable. Only re-fetchable history (candles, funding history, public fills) is part of a proof; the order book, ticker snapshots, and any model reasoning are recorded as *attested* context and never used as evidence.

## Quickstart (≈5 minutes)

```bash
# Reproducible from a clean clone — no npm publication required:
git clone <repo-url> trackproof && cd trackproof
npm install && npm run build

# 1. Safety posture — paper / Demo Trading + read-only (never funded keys)
export TRACKPROOF_BITGET_MODE=paper
export TRACKPROOF_READ_ONLY=true
export BITGET_API_KEY=...  BITGET_SECRET_KEY=...  BITGET_PASSPHRASE=...   # Bitget Demo Trading keys

# 2. Install the skill + MCP server into your coding agent
npm run trackproof -- install --target claude       # also: --target codex | openclaw
#   (once published, the shortcut is: npx trackproof install --target claude)

# 3. Emit a capsule, then verify it locally (G1 + G3)
npm run trackproof -- emit   --instrument BTCUSDT --demo
npm run trackproof -- replay --last                 # re-fetches history (G1) + walks the chain (G3)

# 4. Full verification including the on-chain commitment (G2) — needs Base config
export BASE_SEPOLIA_RPC_URL=...   TRACKPROOF_ANCHOR_ADDRESS=0x...
npm run trackproof -- verify --last --with-anchor   # adds the G2 inclusion proof against the anchored root
```

## Wrap your agent (~15 lines)

```ts
import { TrackProof } from "@trackproof/sdk";

const tp = new TrackProof({
  agentKey: process.env.AGENT_KEY!,            // test-only signing key
  bitget:   { mode: "paper", readOnly: true }, // Bitget Demo Trading
});

// Call this wherever your agent makes a (simulated) decision:
await tp.emit({
  instrument:   "BTCUSDT",
  decisionTime: Date.now(),
  inputs:       candles,                       // the closed-candle history you acted on
  action:       { side: "short", size: 1, type: "market" },
  reasoning:    "funding flip + lower high",   // attested context — recorded, not proof
});
// → a signed, hash-chained DecisionCapsule, emitted immediately and queued for the next Base anchor batch.
// Replayable for G1/G3 right away; fully verifiable (incl. the G2 commitment) once that batch is anchored.
```

## MCP server

```bash
claude mcp add -s user trackproof -- npx -y @trackproof/mcp-server
```

Tools: `capsule.emit`, `capsule.replay`, `memory.list`, `memory.purchase`.

## Architecture

A TypeScript monorepo:

| Package | Responsibility |
|---|---|
| `core` | Capsule schema, canonical JSON, signing, hash chain, replay/verification, reputation |
| `chain` | Base contracts — ERC-8004-compatible identity registry + Merkle anchor + inclusion proofs |
| `memory` | MemorySlice market and `memory.purchase` over x402 (with a local facilitator fallback) |
| `mcp-server` | MCP tools for Claude / Cursor / Codex |
| `skill` | Installable agent skill (`npx trackproof install`) |
| `sdk` | The ~15-line wrapper above |
| `demo-agents` | Reference agents that emit capsules on a schedule |
| `ui` | Agent profiles, reputation leaderboard, replay visualizer |

Built on **Bitget Agent Hub** (`bgc`) for market data and paper trading, **Base** for the identity registry and Merkle anchor, and **x402** for agent-to-agent payments. The capsule/replay/anchor core is exchange-agnostic; Bitget is a thin adapter.

## Safety

- **Simulation / paper trading only.** The Bitget adapter is pinned to read-only + Bitget Demo Trading; no code path places a real-account order.
- On-chain components run on **Base Sepolia** (testnet) and hold no funds.
- **Unaudited.** Not custody, trading, or investment advice.

## Roadmap

- Memory **royalties** — sellers paid automatically when buyers profit from a cited slice.
- Full **ERC-8004** — Reputation and Validation registries (the MVP ships an ERC-8004-*compatible* Identity registry).
- **Challenge bonds** — stake against a claimed record; replay settles the bond.
- Searchable memory marketplace; additional venues and chains.

## License

MIT.
