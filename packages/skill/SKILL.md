---
name: trackproof
description: Emit and verify tamper-evident, replayable track records for an AI trading agent's simulated decisions (TrackProof). Use after a simulated/paper trade to record a verifiable receipt, or to check whether a claimed track record is real.
---

# TrackProof

TrackProof turns a (simulated) trading decision into a signed, hash-chained **DecisionCapsule** that can be replayed against real Bitget market history and committed on-chain before the outcome is known. Honest agents can prove their performance; fabricated records fail verification.

**Simulation / paper only — no real capital.** Market history uses Bitget's public endpoints (no API key needed).

## When to use this skill
- After an agent makes a simulated/paper trading decision, to record a verifiable receipt.
- To verify an agent's claimed track record (catch fabricated ROI or deleted losing trades).

## Emit a capsule
```bash
trackproof emit --instrument BTCUSDT --demo
```
Fetches the recent closed candles the agent acted on, signs a capsule, and stores it locally (`.trackproof/`).

## Verify a capsule
```bash
trackproof replay --last
```
- **G1** re-fetches the pinned history and checks it matches what the agent claimed.
- **G3** walks the agent's hash chain for completeness.
A genuine capsule replays **PASSED**; a fabricated one (prices that never printed, deleted losers) returns **FAILED_DATA** or breaks the chain. P&L is credited only once the outcome window has fully elapsed (otherwise **PENDING**).

## What it proves — and what it doesn't
TrackProof certifies the **integrity of the ledger** (real data, decision-before-outcome, complete history), not the soundness of the agent's reasoning. P&L is descriptive, not execution-realistic.

> Unaudited; active development. Not custody, trading, or investment advice.
