import type { Candle, CandleQuery, MarketDataSource } from "@trackproof/core";

const DEFAULT_BASE_URL = "https://api.bitget.com";

export interface BitgetMarketDataOptions {
  /** Defaults to BITGET_API_BASE_URL or https://api.bitget.com. */
  baseUrl?: string;
  /** "spot" (default) or "futures". */
  product?: "spot" | "futures";
  /** Futures only, e.g. "usdt-futures". */
  productType?: string;
}

interface BitgetCandlesResponse {
  code: string;
  msg: string;
  data?: string[][];
}

/**
 * Map Bitget's raw candle rows [ts, open, high, low, close, baseVol, quoteVol] to
 * normalized Candles, sorted ascending by time (so the G1 digest is order-stable
 * regardless of the API's return order).
 */
export function parseCandles(rows: string[][]): Candle[] {
  return rows
    .map((row) => ({
      time: Number(row[0] ?? 0),
      open: row[1] ?? "0",
      high: row[2] ?? "0",
      low: row[3] ?? "0",
      close: row[4] ?? "0",
      baseVolume: row[5] ?? "0",
      quoteVolume: row[6] ?? "0",
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Read-only adapter over Bitget's PUBLIC candle endpoints — no API key required for
 * market history, so replay/verification works key-free. The adapter never trades.
 */
export class BitgetMarketData implements MarketDataSource {
  private readonly baseUrl: string;
  private readonly product: "spot" | "futures";
  private readonly productType: string;

  constructor(options: BitgetMarketDataOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BITGET_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.product = options.product ?? "spot";
    this.productType = options.productType ?? "usdt-futures";
  }

  async getCandles(query: CandleQuery): Promise<Candle[]> {
    const path = this.product === "spot" ? "/api/v2/spot/market/candles" : "/api/v2/mix/market/candles";
    const url = new URL(path, this.baseUrl);
    url.searchParams.set("symbol", query.instrument);
    url.searchParams.set("granularity", query.granularity);
    url.searchParams.set("startTime", String(query.startTime));
    url.searchParams.set("endTime", String(query.endTime));
    url.searchParams.set("limit", "1000");
    if (this.product === "futures") url.searchParams.set("productType", this.productType);

    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Bitget candles HTTP ${response.status} for ${query.instrument}`);
    }
    const json = (await response.json()) as BitgetCandlesResponse;
    if (json.code !== "00000") {
      throw new Error(`Bitget error ${json.code}: ${json.msg}`);
    }
    return parseCandles(json.data ?? []);
  }
}
