import type { BinanceSymbolInfo } from "./binanceApi";

export function validateSymbols(symbols: BinanceSymbolInfo[]): string[] {
  return symbols
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.contractType === "PERPETUAL" &&
        s.quoteAsset === "USDT",
    )
    .map((s) => s.symbol);
}
