/**
 * 清原式ネットキャッシュ分析（改良版 v0.6）
 * 
 * 改善点:
 * 1. 投資有価証券と投資不動産を分離取得（投資不動産の取りこぼし修正）
 * 2. 清原式（70%割引）と広義（割引なし）の2系統を出力
 * 3. 時価総額の算出方法を明示（自己株式控除ベース）
 * 
 * 清原式: NC = 現金預金 + 有価証券 + 投資有価証券×70% + 投資不動産×50% - 有利子負債
 * 広義:   NC = 現金預金 + 有価証券 + 投資有価証券 + 投資不動産 - 有利子負債
 */

import { FinancialStatements } from "../parsers/xbrl.js";
import { getStockQuote } from "../api/stock-price.js";

export interface NetCashAnalysis {
  company: string;
  secCode: string | null;
  
  components: {
    cashAndDeposits: number | null;
    securities: number | null;
    investmentSecurities: number | null;
    investmentProperty: number | null;
    investmentsOther: number | null;
    shortTermDebt: number | null;
    longTermDebt: number | null;
    totalInterestBearingDebt: number | null;
  };
  
  kiyohara: {
    netCash: number | null;
    netCashRatio: number | null;
    formula: string;
    adjustments: {
      investmentSecuritiesAdj: number | null;
      investmentPropertyAdj: number | null;
    };
    verdict: string;
    explanation: string;
  };
  
  broad: {
    netCash: number | null;
    netCashRatio: number | null;
    formula: string;
    verdict: string;
  };
  
  marketCap: {
    value: number | null;
    source: string;
    note: string;
    sharesOutstanding: number | null;
  };
  
  enterpriseValue: number | null;
  evToEbitda: number | null;
}

const toOku = (val: number | null): string | null => {
  if (val === null) return null;
  return `${(val / 100000000).toFixed(1)}億円`;
};

function getVerdict(ratio: number | null): { verdict: string; explanation: string } {
  if (ratio === null) {
    return { verdict: "データ不足", explanation: "ネットキャッシュ比率を算出できません" };
  }
  if (ratio >= 100) {
    return {
      verdict: "🔥 超割安（ネットキャッシュ > 時価総額）",
      explanation: `NC比率${ratio.toFixed(0)}%。現金同等物だけで時価総額を上回る。事業価値がほぼゼロ評価。`,
    };
  }
  if (ratio >= 50) {
    return {
      verdict: "✅ 割安",
      explanation: `NC比率${ratio.toFixed(0)}%。時価総額の半分以上が現金で裏付けられている。`,
    };
  }
  if (ratio >= 30) {
    return {
      verdict: "🟡 やや割安",
      explanation: `NC比率${ratio.toFixed(0)}%。一定の安全マージンあり。`,
    };
  }
  if (ratio >= 0) {
    return {
      verdict: "⚪ 標準",
      explanation: `NC比率${ratio.toFixed(0)}%。特に割安とは言えない。`,
    };
  }
  return {
    verdict: "🔴 ネットデット（純負債）",
    explanation: `NC比率${ratio.toFixed(0)}%。有利子負債が現金資産を上回っている。`,
  };
}

export async function calculateNetCash(
  fs: FinancialStatements,
  secCode?: string
): Promise<NetCashAnalysis> {
  const cashAndDeposits = fs.balanceSheet.cashAndDeposits;
  const securities = (fs.balanceSheet as any).securities;
  const investmentSecurities = (fs.balanceSheet as any).investmentSecurities;
  const investmentProperty = (fs.balanceSheet as any).investmentProperty;
  const investments = fs.balanceSheet.investments;
  const shortTermDebt = fs.balanceSheet.shortTermDebt;
  const longTermDebt = fs.balanceSheet.longTermDebt;
  
  const totalDebt = (shortTermDebt || 0) + (longTermDebt || 0);
  const totalInterestBearingDebt = totalDebt > 0 ? totalDebt : null;
  
  // 投資有価証券: 個別タグ優先、なければ「投資その他の資産」フォールバック
  const effectiveInvestmentSec = investmentSecurities !== null ? investmentSecurities : investments;
  const usedFallback = investmentSecurities === null && investments !== null;
  
  // 清原式: 投資有価証券×70%、投資不動産×50%（換金性が低い）
  const invSecAdj = effectiveInvestmentSec ? Math.round(effectiveInvestmentSec * 0.7) : null;
  const invPropAdj = investmentProperty ? Math.round(investmentProperty * 0.5) : null;
  
  let kiyoharaNC: number | null = null;
  if (cashAndDeposits !== null) {
    kiyoharaNC = cashAndDeposits 
      + (securities || 0) 
      + (invSecAdj || 0) 
      + (invPropAdj || 0) 
      - (totalInterestBearingDebt || 0);
  }
  
  // 広義（割引なし）
  let broadNC: number | null = null;
  if (cashAndDeposits !== null) {
    broadNC = cashAndDeposits 
      + (securities || 0) 
      + (effectiveInvestmentSec || 0) 
      + (investmentProperty || 0) 
      - (totalInterestBearingDebt || 0);
  }
  
  // 時価総額
  let marketCapValue: number | null = null;
  let sharesOutstanding: number | null = null;
  const code = secCode || fs.secCode;
  if (code) {
    const quote = await getStockQuote(code);
    if (quote) {
      marketCapValue = quote.marketCap;
      sharesOutstanding = quote.sharesOutstanding;
    }
  }
  
  const kiyoharaRatio = (kiyoharaNC !== null && marketCapValue && marketCapValue > 0)
    ? Math.round((kiyoharaNC / marketCapValue) * 10000) / 100 : null;
  const broadRatio = (broadNC !== null && marketCapValue && marketCapValue > 0)
    ? Math.round((broadNC / marketCapValue) * 10000) / 100 : null;
  
  let enterpriseValue: number | null = null;
  if (marketCapValue && kiyoharaNC !== null) {
    enterpriseValue = marketCapValue - kiyoharaNC;
  }
  
  const kiyoharaVerdict = getVerdict(kiyoharaRatio);
  const broadVerdict = getVerdict(broadRatio);
  
  let formulaStr = "現金預金 + 有価証券";
  if (usedFallback) {
    formulaStr += " + 投資その他の資産×70%（※個別タグ未検出、フォールバック）";
  } else {
    formulaStr += " + 投資有価証券×70%";
    if (investmentProperty !== null) {
      formulaStr += " + 投資不動産×50%";
    }
  }
  formulaStr += " − 有利子負債";
  
  return {
    company: fs.companyName,
    secCode: fs.secCode,
    components: {
      cashAndDeposits,
      securities,
      investmentSecurities: effectiveInvestmentSec,
      investmentProperty,
      investmentsOther: usedFallback ? null : investments,
      shortTermDebt,
      longTermDebt,
      totalInterestBearingDebt,
    },
    kiyohara: {
      netCash: kiyoharaNC,
      netCashRatio: kiyoharaRatio,
      formula: formulaStr,
      adjustments: {
        investmentSecuritiesAdj: invSecAdj,
        investmentPropertyAdj: invPropAdj,
      },
      verdict: kiyoharaVerdict.verdict,
      explanation: kiyoharaVerdict.explanation + (usedFallback 
        ? " ⚠️ 投資有価証券の個別タグが取得できず「投資その他の資産」全体を使用。過大評価の可能性あり。"
        : ""),
    },
    broad: {
      netCash: broadNC,
      netCashRatio: broadRatio,
      formula: "現金預金 + 有価証券 + 投資有価証券 + 投資不動産 − 有利子負債（割引なし）",
      verdict: broadVerdict.verdict,
    },
    marketCap: {
      value: marketCapValue,
      source: "yahoo-finance2 (自己株式控除ベース = sharesOutstanding × 株価)",
      note: "株探・四季報等は発行済株式数×株価のため、自己株式が多い銘柄では差異が生じます。",
      sharesOutstanding,
    },
    enterpriseValue,
    evToEbitda: null,
  };
}

export function formatNetCashAnalysis(analysis: NetCashAnalysis): object {
  return {
    company: analysis.company,
    secCode: analysis.secCode,
    kiyoharaNetCash: {
      formula: analysis.kiyohara.formula,
      components: {
        cashAndDeposits: toOku(analysis.components.cashAndDeposits),
        securities: toOku(analysis.components.securities),
        investmentSecurities: toOku(analysis.components.investmentSecurities),
        investmentSecuritiesAdj: toOku(analysis.kiyohara.adjustments.investmentSecuritiesAdj),
        investmentProperty: toOku(analysis.components.investmentProperty),
        investmentPropertyAdj: toOku(analysis.kiyohara.adjustments.investmentPropertyAdj),
        totalInterestBearingDebt: toOku(analysis.components.totalInterestBearingDebt),
      },
      netCash: toOku(analysis.kiyohara.netCash),
      netCashRatio: analysis.kiyohara.netCashRatio !== null 
        ? `${analysis.kiyohara.netCashRatio.toFixed(1)}%` : null,
      verdict: analysis.kiyohara.verdict,
      explanation: analysis.kiyohara.explanation,
    },
    broadNetCash: {
      formula: analysis.broad.formula,
      netCash: toOku(analysis.broad.netCash),
      netCashRatio: analysis.broad.netCashRatio !== null 
        ? `${analysis.broad.netCashRatio.toFixed(1)}%` : null,
      verdict: analysis.broad.verdict,
    },
    marketCap: {
      value: toOku(analysis.marketCap.value),
      sharesOutstanding: analysis.marketCap.sharesOutstanding 
        ? `${(analysis.marketCap.sharesOutstanding / 1000000).toFixed(2)}百万株` : null,
      source: analysis.marketCap.source,
      note: analysis.marketCap.note,
    },
    valuation: {
      enterpriseValue: toOku(analysis.enterpriseValue),
    },
  };
}
