import type { Candle, CandleQuery, FundingRate, MarketDataSource } from "@trackproof/core";

const DEFAULT_BASE_URL = "https://api.bitget.com";
const PAGE_LIMIT = 200;
const MAX_PAGES = 50;

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

interface BitgetFundingResponse {
  code: string;
  msg: string;
  data?: { symbol: string; fundingRate: string; fundingTime: string }[];
}

/**
 * Map Bitget's raw candle rows [ts, open, high, low, close, baseVol, quoteVol] to normalized
 * Candles, sorted ascending by time (so the G1 digest is order-stable regardless of API order).
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

/** Fetch one page: up to `limit` candles with open time `<= endTime`, ascending. */
export type CandlePageFetcher = (endTime: number, limit: number) => Promise<Candle[]>;

/**
 * Walk `history-candles` backward from `query.endTime` until the [startTime, endTime] window is
 * covered, deduping by time. `history-candles` has far deeper retention than the recent `/candles`
 * endpoint (which empties after ~30–90 days at 1m), so old honest capsules still replay instead of
 * failing G1 with a spurious FAILED_DATA.
 */
export async function paginateCandles(
  fetchPage: CandlePageFetcher,
  query: Pick<CandleQuery, "startTime" | "endTime">,
  pageLimit = PAGE_LIMIT,
  maxPages = MAX_PAGES,
): Promise<Candle[]> {
  const byTime = new Map<number, Candle>();
  let cursor = query.endTime;
  for (let page = 0; page < maxPages; page++) {
    const candles = await fetchPage(cursor, pageLimit);
    if (candles.length === 0) break;
    let earliest = Infinity;
    for (const candle of candles) {
      byTime.set(candle.time, candle);
      if (candle.time < earliest) earliest = candle.time;
    }
    if (earliest <= query.startTime || earliest >= cursor) break; // covered, or no progress
    cursor = earliest;
  }
  return [...byTime.values()]
    .filter((candle) => candle.time >= query.startTime && candle.time <= query.endTime)
    .sort((a, b) => a.time - b.time);
}

const GRANULARITY_MS: Record<string, number> = {
  "1min": 60_000,
  "3min": 180_000,
  "5min": 300_000,
  "15min": 900_000,
  "30min": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1day": 86_400_000,
  "3day": 259_200_000,
  "1week": 604_800_000,
};

/** Milliseconds per Bitget granularity; defaults to 1 minute for unknown strings. */
export function granularityMs(granularity: string): number {
  return GRANULARITY_MS[granularity] ?? 60_000;
}

/**
 * Read-only adapter over Bitget's PUBLIC `history-candles` endpoint — no API key required, deep
 * retention, paginated. The adapter never trades.
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
    return paginateCandles((endTime, limit) => this.fetchPage(query, endTime, limit), query);
  }

  /** Funding-rate history over Bitget's PUBLIC mix `history-fund-rate` (futures only, keyless). */
  async getFundingRate(query: CandleQuery): Promise<FundingRate[]> {
    const out: FundingRate[] = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const url = new URL("/api/v2/mix/market/history-fund-rate", this.baseUrl);
      url.searchParams.set("symbol", query.instrument);
      url.searchParams.set("productType", this.productType);
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("pageNo", String(pageNo));

      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Bitget history-fund-rate HTTP ${response.status} for ${query.instrument}`);
      }
      const json = (await response.json()) as BitgetFundingResponse;
      if (json.code !== "00000") {
        throw new Error(`Bitget error ${json.code}: ${json.msg}`);
      }
      const rows = json.data ?? [];
      if (rows.length === 0) break;
      for (const r of rows) out.push({ time: Number(r.fundingTime), fundingRate: r.fundingRate });
      // Rows are newest-first; stop once a page reaches before the requested window.
      if (Number(rows[rows.length - 1]!.fundingTime) <= query.startTime) break;
    }
    return out.filter((f) => f.time >= query.startTime && f.time <= query.endTime).sort((a, b) => a.time - b.time);
  }

  private async fetchPage(query: CandleQuery, endTime: number, limit: number): Promise<Candle[]> {
    const path =
      this.product === "spot" ? "/api/v2/spot/market/history-candles" : "/api/v2/mix/market/history-candles";
    const url = new URL(path, this.baseUrl);
    url.searchParams.set("symbol", query.instrument);
    url.searchParams.set("granularity", query.granularity);
    // Bitget compares `endTime` against a candle's CLOSE. To honor this fetcher's contract (inclusive
    // of the candle whose OPEN time == endTime), extend the bound by one interval.
    const apiEndTime = Math.min(endTime, Date.now()) + granularityMs(query.granularity);
    url.searchParams.set("endTime", String(apiEndTime));
    url.searchParams.set("limit", String(limit));
    if (this.product === "futures") url.searchParams.set("productType", this.productType);

    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Bitget history-candles HTTP ${response.status} for ${query.instrument}`);
    }
    const json = (await response.json()) as BitgetCandlesResponse;
    if (json.code !== "00000") {
      throw new Error(`Bitget error ${json.code}: ${json.msg}`);
    }
    return parseCandles(json.data ?? []);
  }
}
