import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BitgetMarketData } from "@trackproof/bitget";
import { z } from "zod";
import { emitCapsule, verifyLast } from "./tools.js";

const HOME = process.env.TRACKPROOF_HOME ?? ".trackproof";
const ANCHOR_ADDRESS = (process.env.TRACKPROOF_ANCHOR_ADDRESS ??
  "0x290825Ee1124617649c527A2230881e63173519D") as `0x${string}`;

/** Build the TrackProof MCP server (tools only; the caller attaches a transport). */
export function createServer(): McpServer {
  const server = new McpServer({ name: "trackproof", version: "0.0.0" });
  const source = new BitgetMarketData();

  server.registerTool(
    "capsule_emit",
    {
      title: "Emit a DecisionCapsule",
      description:
        "Record a simulated/paper trade decision as a signed, hash-chained DecisionCapsule over real " +
        "Bitget market history. Simulation / paper only — it never places a real order.",
      inputSchema: {
        instrument: z.string().describe("Bitget symbol, e.g. BTCUSDT"),
        side: z.enum(["long", "short"]).describe("trade direction"),
        size: z.string().describe('position size as a decimal string, e.g. "1"'),
        granularity: z.string().optional().describe("candle granularity (default 1min)"),
        reasoning: z.string().optional().describe("optional rationale, recorded as attested context (never used as proof)"),
      },
    },
    async (args) => {
      const r = await emitCapsule(HOME, source, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "capsule_verify",
    {
      title: "Verify the latest DecisionCapsule",
      description:
        "Re-fetch the pinned market data and replay the last capsule (G1), walk the hash-chain (G3), and " +
        "optionally check the on-chain Merkle inclusion + certifiability (G2). Returns the verdict.",
      inputSchema: {
        withAnchor: z.boolean().optional().describe("also check the on-chain commitment (G2) against Base"),
      },
    },
    async (args) => {
      const r = await verifyLast(HOME, source, { withAnchor: args.withAnchor ?? false, anchorAddress: ANCHOR_ADDRESS });
      return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
    },
  );

  return server;
}
