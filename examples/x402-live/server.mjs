// x402 resource server: sells a TrackProof MemorySlice for $0.01 test USDC on Base Sepolia,
// settled through the keyless x402.org testnet facilitator. Simulation / paper only.
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const SELLER = process.env.SELLER_ADDRESS ?? "0xc2e9c2B5673Bd4E0E07e9220607247Fa80a4c214";
const PORT = Number(process.env.PORT ?? 4021);
const SLICE = {
  slice_id: "demo-funding-edge",
  seller: SELLER,
  body: "short BTC when funding flips negative and the prior high holds",
};

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /slice": {
        accepts: [{ scheme: "exact", price: "$0.01", network: "eip155:84532", payTo: SELLER }],
        description: "TrackProof MemorySlice — a funding-edge note",
        mimeType: "application/json",
      },
    },
    server,
  ),
);
app.get("/slice", (_req, res) => res.json(SLICE));

app.listen(PORT, () =>
  console.error(`x402 MemorySlice server: http://localhost:${PORT}/slice (payTo ${SELLER}, $0.01 USDC on Base Sepolia)`),
);
