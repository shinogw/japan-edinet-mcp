/**
 * 株価データ取得モジュール
 * Yahoo Finance APIを使用して株価・時価総額等を取得
 */

import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  eps: number | null;
  sharesOutstanding: number | null;
}

function toYahooSymbol(secCode: string): string {
  const code = secCode.replace(/0$/, "");
  return `${code}.T`;
}

export async function getStockQuote(secCode: string): Promise<StockQuote | null> {
  try {
    const symbol = toYahooSymbol(secCode);
    const quote = await yahooFinance.quote(symbol) as any;
    if (!quote) return null;

    return {
      symbol,
      name: quote.shortName || quote.longName || "",
      price: quote.regularMarketPrice || 0,
      previousClose: quote.regularMarketPreviousClose || null,
      change: quote.regularMarketChange || null,
      changePercent: quote.regularMarketChangePercent || null,
      marketCap: quote.marketCap || null,
      volume: quote.regularMarketVolume || null,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow || null,
      per: quote.trailingPE || null,
      pbr: quote.priceToBook || null,
      dividendYield: quote.trailingAnnualDividendYield ? quote.trailingAnnualDividendYield * 100 : (quote.dividendYield || null),
      eps: quote.epsTrailingTwelveMonths || null,
      sharesOutstanding: quote.sharesOutstanding || null,
    };
  } catch (error) {
    console.error(`Failed to get stock quote for ${secCode}:`, error);
    return null;
  }
}

export function formatStockQuote(quote: StockQuote): object {
  const toOku = (val: number | null): string | null => {
    if (val === null) return null;
    return `${(val / 100000000).toFixed(0)}億円`;
  };

  return {
    symbol: quote.symbol,
    name: quote.name,
    price: `¥${quote.price.toLocaleString()}`,
    change: quote.change ? `${quote.change > 0 ? "+" : ""}${quote.change.toFixed(0)}` : null,
    changePercent: quote.changePercent ? `${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : null,
    marketCap: toOku(quote.marketCap),
    volume: quote.volume ? `${(quote.volume / 1000).toFixed(0)}千株` : null,
    range52w: quote.fiftyTwoWeekLow && quote.fiftyTwoWeekHigh
      ? `¥${quote.fiftyTwoWeekLow.toLocaleString()} - ¥${quote.fiftyTwoWeekHigh.toLocaleString()}`
      : null,
    per: quote.per ? `${quote.per.toFixed(1)}倍` : null,
    pbr: quote.pbr ? `${quote.pbr.toFixed(2)}倍` : null,
    dividendYield: quote.dividendYield ? `${quote.dividendYield.toFixed(2)}%` : null,
    eps: quote.eps ? `¥${quote.eps.toFixed(1)}` : null,
  };
}
