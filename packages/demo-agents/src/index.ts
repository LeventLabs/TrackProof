/**
 * TrackProof demo agents + verifiable-evidence runner.
 *
 * Three seeded-deterministic agents emit signed, hash-chained DecisionCapsules over real
 * Bitget market history; the chains are Merkle-anchored on Base (G2). Everything here is
 * simulation / paper only — no real capital and no real-account orders are ever placed.
 *
 * Modules are exported as they land (strategies, agents, runner, fakes, tier2, evidence).
 */

/** Outcome horizon shared by the demo agents — matches the core replay default (30 min). */
export const DEMO_OUTCOME_HORIZON_MS = 30 * 60 * 1000;

export * from "./strategies.js";
export * from "./agents.js";
export * from "./fixtures.js";
export * from "./runner.js";
export * from "./fakes.js";
export * from "./tier2.js";
export * from "./evidence.js";
export * from "./report-html.js";
