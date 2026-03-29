const BASE_URL = "https://fapi.binance.com";

export interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  contractType: string;
  quoteAsset: string;
}

export interface BinanceTicker {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

export interface BinanceAggTrade {
  T: number;
  p: string;
  q: string;
  m: boolean;
}

export async function fetchExchangeInfo(): Promise<BinanceSymbolInfo[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/fapi/v1/exchangeInfo`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.symbols as BinanceSymbolInfo[];
  } catch {
    return null;
  }
}

export async function fetchAllTickers(): Promise<BinanceTicker[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data)
      ? (data as BinanceTicker[])
      : [data as BinanceTicker];
  } catch {
    return null;
  }
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<string[][] | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function parseKlines(raw: string[][]): Array<{
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: Number.parseFloat(k[1]),
    high: Number.parseFloat(k[2]),
    low: Number.parseFloat(k[3]),
    close: Number.parseFloat(k[4]),
    volume: Number.parseFloat(k[5]),
  }));
}

export async function fetchKlinesBatch(
  symbols: string[],
  interval: string,
  limit: number,
  batchSize = 20,
): Promise<Map<string, ReturnType<typeof parseKlines>>> {
  const results = new Map<string, ReturnType<typeof parseKlines>>();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const fetches = batch.map(async (sym) => {
      const raw = await fetchKlines(sym, interval, limit);
      if (raw) results.set(sym, parseKlines(raw));
    });
    await Promise.all(fetches);
  }

  return results;
}

// ─── AGG TRADE FETCH WITH FULL DIAGNOSTICS ──────────────────────────────────

export type AggFetchStatus =
  | "ok"
  | "empty"
  | "abort_error"
  | "network_error"
  | "http_error"
  | "parse_error";

export interface AggTradeResult {
  trades: BinanceAggTrade[];
  status: AggFetchStatus;
  /** Number of raw records received before validation filtering */
  rawCount: number;
  /** HTTP response status code (only present for http_error) */
  httpStatus?: number;
  /** The request URL that was called */
  requestUrl: string;
  /** Error constructor name (e.g. "AbortError", "TypeError") */
  errorName?: string;
  /** Error message string */
  errorMessage?: string;
}

export async function fetchAggTrades(
  symbol: string,
  limit = 500,
): Promise<AggTradeResult> {
  const url = `${BASE_URL}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        trades: [],
        status: "http_error",
        rawCount: 0,
        requestUrl: url,
        httpStatus: res.status,
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (parseErr) {
      return {
        trades: [],
        status: "parse_error",
        rawCount: 0,
        requestUrl: url,
        errorName: parseErr instanceof Error ? parseErr.name : "ParseError",
        errorMessage:
          parseErr instanceof Error ? parseErr.message : String(parseErr),
      };
    }
    if (!Array.isArray(data)) {
      return {
        trades: [],
        status: "parse_error",
        rawCount: 0,
        requestUrl: url,
        errorMessage: `Expected array, got ${typeof data}`,
      };
    }
    if (data.length === 0) {
      return { trades: [], status: "empty", rawCount: 0, requestUrl: url };
    }
    // Field validation — count valid records
    const valid = (data as BinanceAggTrade[]).filter(
      (t) =>
        t &&
        typeof t.T === "number" &&
        typeof t.q === "string" &&
        typeof t.p === "string",
    );
    if (valid.length === 0) {
      return {
        trades: [],
        status: "parse_error",
        rawCount: data.length,
        requestUrl: url,
        errorMessage: `Got ${data.length} records but 0 passed field validation`,
      };
    }
    return {
      trades: valid,
      status: "ok",
      rawCount: data.length,
      requestUrl: url,
    };
  } catch (err) {
    // Distinguish AbortError from generic network errors
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "CancelledError");
    return {
      trades: [],
      status: isAbort ? "abort_error" : "network_error",
      rawCount: 0,
      requestUrl: url,
      errorName: err instanceof Error ? err.name : "UnknownError",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
