import { BaseAnchorStore } from "@trackproof/base";
import {
  capsuleLeaf,
  verifyCapsule,
  verifyChain,
  verifyCommitment,
  type MarketDataSource,
  type TradeDecisionBody,
} from "@trackproof/core";
import { loadAnchor, openStore, readChain, TrackProof } from "@trackproof/sdk";

const DECISION_WINDOW_MS = 30 * 60_000;

export interface EmitArgs {
  instrument: string;
  side: "long" | "short";
  size: string;
  granularity?: string;
  reasoning?: string;
}

export interface EmitResult {
  agent_id: string;
  seq: number;
  instrument: string;
  granularity: string;
  inputs: number;
  inputs_digest: string;
  action: TradeDecisionBody["action"];
}

/** Emit one signed, hash-chained trade-decision capsule over real market history. Paper only. */
export async function emitCapsule(home: string, source: MarketDataSource, args: EmitArgs): Promise<EmitResult> {
  const granularity = args.granularity ?? "1min";
  const end = Date.now();
  const candles = await source.getCandles({ instrument: args.instrument, granularity, startTime: end - DECISION_WINDOW_MS, endTime: end });
  if (candles.length < 2) {
    throw new Error(`not enough candles for ${args.instrument} (${candles.length}) — try a more liquid symbol or a wider window`);
  }
  // Drop the last candle: it is likely still open. Capsules pin closed candles only.
  const closed = candles.slice(0, -1);
  const capsule = new TrackProof({ home }).emit({
    instrument: args.instrument,
    granularity,
    candles: closed,
    action: { side: args.side, size: args.size, type: "market" },
    ...(args.reasoning !== undefined ? { reasoning: args.reasoning } : {}),
  });
  const body = capsule.body as TradeDecisionBody;
  return {
    agent_id: capsule.agent_id,
    seq: capsule.seq,
    instrument: args.instrument,
    granularity,
    inputs: closed.length,
    inputs_digest: body.inputs_digest,
    action: body.action,
  };
}

export interface VerifyResult {
  seq: number;
  chainLength: number;
  g1: string;
  g1Reason?: string;
  outcome?: string;
  pnl?: string;
  g3: string;
  g2?: string;
}

/** Re-fetch + replay (G1), walk the chain (G3), and optionally check the on-chain commitment (G2). */
export async function verifyLast(
  home: string,
  source: MarketDataSource,
  opts: { withAnchor?: boolean; anchorAddress?: `0x${string}` } = {},
): Promise<VerifyResult> {
  const store = openStore(home);
  const chain = readChain(store);
  if (chain.length === 0) throw new Error("no capsules yet — emit one first");
  const target = chain[chain.length - 1]!;
  const g1 = await verifyCapsule(target, source);
  const g3 = verifyChain(chain);

  const result: VerifyResult = {
    seq: target.seq,
    chainLength: chain.length,
    g1: g1.verdict,
    g3: g3.ok ? "complete" : `broken at seq ${g3.firstBadSeq}`,
  };
  if (g1.verdict !== "PASSED" && g1.reason) result.g1Reason = g1.reason;
  if (g1.kind === "trade_decision") {
    if (g1.outcome) result.outcome = g1.outcome;
    if (g1.pnl !== undefined) result.pnl = g1.pnl;
  }

  if (opts.withAnchor && opts.anchorAddress) {
    const anchor = loadAnchor(store);
    if (!anchor) {
      result.g2 = "no local anchor — run `trackproof anchor`";
    } else {
      const proof = anchor.proofs[capsuleLeaf(target)];
      if (!proof) {
        result.g2 = "this capsule is not in the latest anchor";
      } else {
        const record = await new BaseAnchorStore({ anchorAddress: opts.anchorAddress }).getByRoot(anchor.root);
        if (!record) {
          result.g2 = "anchored root not found on-chain yet";
        } else {
          const outcomeStart = g1.kind === "trade_decision" ? g1.outcomeStart : undefined;
          const c = verifyCommitment(target, proof, record, outcomeStart);
          result.g2 = `included=${c.included} certifiable=${c.certifiable} (Base block ${record.block})`;
        }
      }
    }
  }
  return result;
}
