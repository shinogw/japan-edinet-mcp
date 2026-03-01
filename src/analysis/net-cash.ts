/**
 * 清原式ネットキャッシュ分析
 * 清原達郎（元タワー投資顧問）の投資手法
 * 
 * ネットキャッシュ = 現金預金 + 有価証券 + 投資有価証券 × 70% - 有利子負債
 * ネットキャッシュ比率 = ネットキャッシュ / 時価総額
 */

import { FinancialStatements } from "../parsers/xbrl.js";
import { getStockQuote } from "../api/stock-price.js";

export interface NetCashAnalysis {
  company: string;
  secCode: string | null;
  
  // 構成要素
  components: {
    cashAndDeposits: number | null;       // 現金及び預金
    securities: number | null;            // 有価証券（流動資産）
    investmentSecurities: number | null;  // 投資有価証券
    investmentSecuritiesAdj: number | null; // 投資有価証券 × 70%
    shortTermDebt: number | null;         // 短期借入金
    longTermDebt: number | null;          // 長期借入金
    totalInterestBearingDebt: number | null; // 有利子負債合計
  };
  
  // 計算結果
  netCash: number | null;                 // ネットキャッシュ
  marketCap: number | null;               // 時価総額
  netCashRatio: number | null;            // ネットキャッシュ比率(%)
  
  // 評価
  verdict: string;
  explanation: string;
  
  // バリュー投資指標
  enterpriseValue: number | null;         // EV = 時価総額 - ネットキャッシュ
  evToEbitda: number | null;              // EV/EBITDA（簡易版）
}

const toOku = (val: number | null): string | null => {
  if (val === null) return null;
  return `${(val / 100000000).toFixed(1)}億円`;
};

/**
 * 清原式ネットキャッシュを計算
 */
export async function calculateNetCash(
  fs: FinancialStatements,
  secCode?: string
): Promise<NetCashAnalysis> {
  // 構成要素を取得
  const cashAndDeposits = fs.balanceSheet.cashAndDeposits;
  const investments = fs.balanceSheet.investments; // 投資有価証券含む
  const shortTermDebt = fs.balanceSheet.shortTermDebt;
  const longTermDebt = fs.balanceSheet.longTermDebt;
  
  // 投資有価証券の70%
  const investmentSecuritiesAdj = investments ? Math.round(investments * 0.7) : null;
  
  // 有利子負債合計
  const totalDebt = (shortTermDebt || 0) + (longTermDebt || 0);
  const totalInterestBearingDebt = totalDebt > 0 ? totalDebt : null;
  
  // ネットキャッシュ計算
  let netCash: number | null = null;
  if (cashAndDeposits !== null) {
    netCash = cashAndDeposits + (investmentSecuritiesAdj || 0) - (totalInterestBearingDebt || 0);
  }
  
  // 時価総額を取得
  let marketCap: number | null = null;
  const code = secCode || fs.secCode;
  if (code) {
    const quote = await getStockQuote(code);
    if (quote) {
      marketCap = quote.marketCap;
    }
  }
  
  // ネットキャッシュ比率
  let netCashRatio: number | null = null;
  if (netCash !== null && marketCap && marketCap > 0) {
    netCashRatio = Math.round((netCash / marketCap) * 10000) / 100;
  }
  
  // EV計算
  let enterpriseValue: number | null = null;
  if (marketCap && netCash !== null) {
    enterpriseValue = marketCap - netCash;
  }
  
  // 評価
  let verdict: string;
  let explanation: string;
  
  if (netCashRatio === null) {
    verdict = "データ不足";
    explanation = "ネットキャッシュ比率を算出できません（時価総額データが必要）";
  } else if (netCashRatio >= 100) {
    verdict = "超割安（ネットキャッシュ > 時価総額）";
    explanation = `現金同等物だけで時価総額の${netCashRatio.toFixed(0)}%をカバー。事業価値がほぼゼロと評価されている異常事態。清原式では最も注目すべき水準。`;
  } else if (netCashRatio >= 50) {
    verdict = "割安";
    explanation = `ネットキャッシュ比率${netCashRatio.toFixed(0)}%。時価総額の半分以上が現金で裏付けられている。事業価値を安く買えるチャンス。`;
  } else if (netCashRatio >= 30) {
    verdict = "やや割安";
    explanation = `ネットキャッシュ比率${netCashRatio.toFixed(0)}%。一定の安全マージンあり。`;
  } else if (netCashRatio >= 0) {
    verdict = "標準";
    explanation = `ネットキャッシュ比率${netCashRatio.toFixed(0)}%。特に割安とは言えない水準。`;
  } else {
    verdict = "ネットデット（純負債）";
    explanation = `ネットキャッシュ比率${netCashRatio.toFixed(0)}%。有利子負債が現金資産を上回っている。`;
  }
  
  return {
    company: fs.companyName,
    secCode: fs.secCode,
    components: {
      cashAndDeposits,
      securities: null, // 流動資産の有価証券（別途タグ必要）
      investmentSecurities: investments,
      investmentSecuritiesAdj,
      shortTermDebt,
      longTermDebt,
      totalInterestBearingDebt,
    },
    netCash,
    marketCap,
    netCashRatio,
    verdict,
    explanation,
    enterpriseValue,
    evToEbitda: null, // EBITDA計算は別途必要
  };
}

/**
 * ネットキャッシュ分析をフォーマット
 */
export function formatNetCashAnalysis(analysis: NetCashAnalysis): object {
  return {
    company: analysis.company,
    secCode: analysis.secCode,
    kiyoharaNetCash: {
      formula: "現金預金 + 投資有価証券×70% - 有利子負債",
      components: {
        cashAndDeposits: toOku(analysis.components.cashAndDeposits),
        investmentSecurities: toOku(analysis.components.investmentSecurities),
        investmentSecuritiesAdj: toOku(analysis.components.investmentSecuritiesAdj),
        totalInterestBearingDebt: toOku(analysis.components.totalInterestBearingDebt),
      },
      netCash: toOku(analysis.netCash),
      marketCap: toOku(analysis.marketCap),
      netCashRatio: analysis.netCashRatio !== null ? `${analysis.netCashRatio.toFixed(1)}%` : null,
      verdict: analysis.verdict,
      explanation: analysis.explanation,
    },
    valuation: {
      enterpriseValue: toOku(analysis.enterpriseValue),
    },
  };
}
