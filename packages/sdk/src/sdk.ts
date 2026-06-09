import {
  appendCapsule,
  computeInputsDigest,
  type Candle,
  type SignedCapsule,
  type TradeDecisionBody,
} from "@trackproof/core";
import { appendCapsuleToStore, lastCapsule, openStore, type AgentStore } from "./store.js";

export interface TrackProofOptions {
  /** Store directory; defaults to TRACKPROOF_HOME or ".trackproof". */
  home?: string;
}

export interface EmitTrade {
  instrument: string;
  granularity: string;
  /** The closed-candle history the agent acted on. */
  candles: Candle[];
  action: TradeDecisionBody["action"];
  /** ms; defaults to the last input candle's time. */
  decisionTime?: number;
  /** Recorded as attested context — never used as proof. */
  reasoning?: string;
}

/**
 * Wrap an agent: emit signed, hash-chained DecisionCapsules to a local store.
 * Simulation/paper only — this never places an order anywhere.
 */
export class TrackProof {
  private readonly store: AgentStore;

  constructor(options: TrackProofOptions = {}) {
    this.store = openStore(options.home ?? process.env.TRACKPROOF_HOME ?? ".trackproof");
  }

  get agentId(): string {
    return this.store.keyPair.publicKeyHex;
  }

  emit(trade: EmitTrade): SignedCapsule {
    if (trade.candles.length === 0) {
      throw new Error("emit requires at least one input candle");
    }
    const candles = [...trade.candles].sort((a, b) => a.time - b.time);
    const windowStart = candles[0]!.time;
    const windowEnd = candles[candles.length - 1]!.time;
    const decisionTime = trade.decisionTime ?? windowEnd;

    const body: TradeDecisionBody = {
      market_ref: {
        venue: "bitget",
        instrument: trade.instrument,
        decision_time: decisionTime,
        candles: { granularity: trade.granularity, window: [windowStart, windowEnd] },
      },
      inputs_digest: computeInputsDigest({ candles }),
      action: trade.action,
      ...(trade.reasoning ? { attested: { reasoning_trace: trade.reasoning } } : {}),
    };

    const capsule = appendCapsule(
      lastCapsule(this.store),
      { kind: "trade_decision", body, committed_at: decisionTime },
      this.agentId,
      this.store.keyPair.privateKey,
    );
    appendCapsuleToStore(this.store, capsule);
    return capsule;
  }
}
