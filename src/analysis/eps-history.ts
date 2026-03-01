/**
 * EPS履歴分析
 * Yahoo Finance + EDINETからEPSの推移を分析
 */

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface EPSHistoryEntry {
  fiscalYear: string;
  eps: number | null;
  netIncome: number | null;
  revenue: number | null;
}

export interface EPSAnalysis {
  company: string;
  secCode: string;
  history: EPSHistoryEntry[];
  currentEPS: number | null;
  epsGrowthRates: { year: string; rate: string }[];
  epsCAGR: string | null;
  consecutiveGrowthYears: number;
  maxEPS: { value: number; year: string } | null;
  isGrowing: boolean;
  growthAssessment: string;
}

function toYahooSymbol(secCode: string): string {
  const code = secCode.replace(/0$/, "");
  return `${code}.T`;
}

/**
 * Yahoo FinanceからEPS履歴を取得・分析
 */
export async function getEPSHistory(secCode: string): Promise<EPSAnalysis | null> {
  try {
    const symbol = toYahooSymbol(secCode);
    
    // 株価情報からEPS取得
    const quote = await yf.quote(symbol) as any;
    const currentEPS = quote?.epsTrailingTwelveMonths || null;
    const sharesOutstanding = quote?.sharesOutstanding || null;
    const companyName = quote?.shortName || quote?.longName || symbol;
    
    // 過去の損益計算書を取得
    const summary = await yf.quoteSummary(symbol, { modules: ["incomeStatementHistory"] }) as any;
    const statements = summary?.incomeStatementHistory?.incomeStatementHistory || [];
    
    // 履歴を構築
    const history: EPSHistoryEntry[] = statements.map((stmt: any) => {
      const date = new Date(stmt.endDate);
      const year = date.getFullYear().toString();
      const netIncome = stmt.netIncome || null;
      const revenue = stmt.totalRevenue || null;
      const eps = (netIncome && sharesOutstanding) ? netIncome / sharesOutstanding : null;
      
      return { fiscalYear: year, eps, netIncome, revenue };
    }).reverse(); // 古い順に並べ替え
    
    // EPS成長率を計算
    const epsGrowthRates: { year: string; rate: string }[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].eps;
      const curr = history[i].eps;
      if (prev && curr && prev > 0) {
        const rate = ((curr - prev) / prev) * 100;
        epsGrowthRates.push({
          year: `${history[i - 1].fiscalYear}→${history[i].fiscalYear}`,
          rate: `${rate > 0 ? "+" : ""}${rate.toFixed(1)}%`,
        });
      }
    }
    
    // CAGR計算
    let epsCAGR: string | null = null;
    if (history.length >= 2) {
      const first = history[0].eps;
      const last = history[history.length - 1].eps;
      if (first && last && first > 0 && last > 0) {
        const years = history.length - 1;
        const cagr = (Math.pow(last / first, 1 / years) - 1) * 100;
        epsCAGR = `${cagr > 0 ? "+" : ""}${cagr.toFixed(1)}%`;
      }
    }
    
    // 連続増益年数
    let consecutiveGrowth = 0;
    for (let i = history.length - 1; i > 0; i--) {
      const curr = history[i].eps;
      const prev = history[i - 1].eps;
      if (curr && prev && curr > prev) {
        consecutiveGrowth++;
      } else {
        break;
      }
    }
    
    // 最高EPS
    let maxEPS: { value: number; year: string } | null = null;
    for (const entry of history) {
      if (entry.eps && (!maxEPS || entry.eps > maxEPS.value)) {
        maxEPS = { value: entry.eps, year: entry.fiscalYear };
      }
    }
    
    // 増益トレンド判定
    const isGrowing = consecutiveGrowth >= 2;
    
    // 成長性評価
    let growthAssessment: string;
    if (consecutiveGrowth >= 3) {
      growthAssessment = "強い成長トレンド";
    } else if (consecutiveGrowth >= 1) {
      growthAssessment = "やや成長傾向";
    } else if (epsCAGR && parseFloat(epsCAGR) > 0) {
      growthAssessment = "波はあるが長期的には成長";
    } else if (epsCAGR && parseFloat(epsCAGR) < -10) {
      growthAssessment = "収益力低下傾向";
    } else {
      growthAssessment = "横ばい";
    }
    
    return {
      company: companyName,
      secCode,
      history,
      currentEPS,
      epsGrowthRates,
      epsCAGR,
      consecutiveGrowthYears: consecutiveGrowth,
      maxEPS,
      isGrowing,
      growthAssessment,
    };
  } catch (error) {
    console.error(`Failed to get EPS history for ${secCode}:`, error);
    return null;
  }
}
