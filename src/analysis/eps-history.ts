/**
 * EPS履歴分析
 * EDINETの有価証券報告書からEPSの推移を分析
 */

import { getEdinetClient } from "../api/edinet.js";
import { parseXbrlFromZip } from "../parsers/xbrl-parser.js";

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
  splitWarnings: string[];
}

/**
 * EDINETからEPS履歴を取得・分析
 * 最新の有価証券報告書「主要な経営指標等の推移」（最大5期）から構築する
 */
export async function getEPSHistory(secCode: string): Promise<EPSAnalysis | null> {
  try {
    const client = getEdinetClient();
    const code = secCode.length === 4 ? secCode + "0" : secCode;

    const [doc] = await client.findLatestFilings(code, ["120"], 400);
    if (!doc) return null;

    const xbrlZip = await client.getDocument(doc.docID, "1");
    const parsedFs = await parseXbrlFromZip(xbrlZip);
    const companyName = parsedFs.companyName || doc.filerName || code;

    const history: EPSHistoryEntry[] = parsedFs.history.map((h) => ({
      fiscalYear: h.periodEnd ? h.periodEnd.substring(0, 7) : "",
      eps: h.eps,
      netIncome: h.netIncome,
      revenue: h.revenue,
    }));

    // 株式数が大きく変化した期（分割・併合）の前後はEPSが比較不能
    const splitWarnings: string[] = [];
    for (let i = 1; i < parsedFs.history.length; i++) {
      const a = parsedFs.history[i - 1].sharesIssued;
      const b = parsedFs.history[i].sharesIssued;
      if (a && b && (b / a > 1.3 || a / b > 1.3)) {
        splitWarnings.push(`${history[i].fiscalYear}期に発行済株式数が${(b / a).toFixed(2)}倍（株式分割・併合の可能性）`);
      }
    }

    // 古い順にソート
    history.sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));

    if (history.length === 0) {
      return null;
    }

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

    const currentEPS = history.length > 0 ? history[history.length - 1].eps : null;

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
      splitWarnings,
    };
  } catch (error) {
    console.error(`Failed to get EPS history for ${secCode}:`, error);
    return null;
  }
}
