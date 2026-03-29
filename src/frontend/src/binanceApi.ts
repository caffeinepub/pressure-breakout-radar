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

export async function fetchAggTrades(
  symbol: string,
  limit = 500,
): Promise<BinanceAggTrade[] | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/fapi/v1/aggTrades?symbol=${symbol}&limit=${limit}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
