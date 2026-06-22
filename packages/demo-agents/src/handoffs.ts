import { join } from "node:path";
import { capsuleLeaf } from "@trackproof/core";
import { openStore, readChain } from "@trackproof/sdk";
import { MemoryMarket, purchaseSlice, StubFacilitator } from "@trackproof/memory";
import { DEMO_AGENTS, type DemoAgent } from "./agents.js";

export interface HandoffResult {
  buyer: string;
  seller: string;
  slice_id: string;
  payment_ref: string;
}

/**
 * Run MemorySlice handoffs across the demo agents: each agent publishes one sealed slice derived
 * from its chain, then every agent buys every other agent's slice over the x402 stub — appending a
 * verifiable `memory_purchase` capsule to each buyer's chain (R9.1/R9.2). Simulation / paper only.
 */
export async function runHandoffs(config: { baseDir: string; agents?: DemoAgent[] }): Promise<HandoffResult[]> {
  const agents = config.agents ?? DEMO_AGENTS;
  const market = new MemoryMarket();
  const facilitator = new StubFacilitator();
  const stores = new Map(agents.map((a) => [a.key, openStore(join(config.baseDir, a.key))]));

  const sliceOf = new Map<string, string>();
  for (const a of agents) {
    const store = stores.get(a.key)!;
    const first = readChain(store)[0];
    const ref = first ? capsuleLeaf(first) : "genesis";
    const slice = market.publish(store.keyPair.publicKeyHex, {
      name: `${a.name} — ${a.strategy.id} edge`,
      scope: a.instrument,
      price: "5",
      capsule_refs: [ref],
      body: `${a.name}: ${a.strategy.id} signal, pinned to capsule ${ref.slice(0, 12)}`,
    });
    sliceOf.set(a.key, slice.slice_id);
  }

  const results: HandoffResult[] = [];
  for (const buyer of agents) {
    for (const seller of agents) {
      if (buyer.key === seller.key) continue;
      const sliceId = sliceOf.get(seller.key)!;
      const r = await purchaseSlice(market, facilitator, stores.get(buyer.key)!, sliceId);
      results.push({ buyer: buyer.key, seller: seller.key, slice_id: sliceId, payment_ref: r.payment_ref });
    }
  }
  return results;
}
