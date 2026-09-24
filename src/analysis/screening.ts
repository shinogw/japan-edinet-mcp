/**
 * 統合スクリーニング
 * 3つの視点で銘柄を一括評価:
 *   1. EPS成長性
 *   2. PER割安 + カタリスト期待（EDINETバリュエーション）
 *   3. 清原式ネットキャッシュ
 */

import { getEPSHistory, EPSAnalysis } from "./eps-history.js";
import { calculateNetCash, NetCashAnalysis } from "./net-cash.js";
import { getEdinetClient } from "../api/edinet.js";
import { parseXbrlFromZip } from "../parsers/xbrl-parser.js";
import { FinancialStatements } from "../parsers/xbrl.js";
import { resolveToBusinessDay } from "../utils/business-day.js";

export interface ScreeningCriteria {
  secCodes?: string[];
  scanDays?: number;
  maxMarketCapOku?: number;
  minMarketCapOku?: number;
  weights?: {
    epsGrowth?: number;
    perCatalyst?: number;
    netCash?: number;
  };
  topN?: number;
}

export interface ScreeningResult {
  secCode: string;
  company: string;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  epsScore: number;
  epsDetail: {
    currentEPS: number | null;
    epsCAGR: string | null;
    consecutiveGrowthYears: number;
    growthAssessment: string;
  };
  perCatalystScore: number;
  perCatalystDetail: {
    per: number | null;
    pbr: number | null;
    catalysts: string[];
  };
  netCashScore: number;
  netCashDetail: {
    netCashOku: string | null;
    netCashRatio: number | null;
    verdict: string;
  };
  totalScore: number;
  grade: "🟢🟢" | "🟢" | "🟡" | "🔴";
  gradeLabel: string;
  errors?: string[];
}

export interface ScreeningOutput {
  criteria: {
    universe: string;
    marketCapFilter: string | null;
    weights: { epsGrowth: number; perCatalyst: number; netCash: number };
  };
  scanned: number;
  passed: number;
  results: ScreeningResult[];
  errors: string[];
}

function scoreEPSGrowth(eps: EPSAnalysis | null): { score: number; detail: ScreeningResult["epsDetail"] } {
  if (!eps) {
    return {
      score: 0,
      detail: { currentEPS: null, epsCAGR: null, consecutiveGrowthYears: 0, growthAssessment: "データなし" },
    };
  }
  let score = 30;
  if (eps.consecutiveGrowthYears >= 3) score += 30;
  else if (eps.consecutiveGrowthYears >= 2) score += 20;
  else if (eps.consecutiveGrowthYears >= 1) score += 10;
  if (eps.epsCAGR) {
    const cagr = parseFloat(eps.epsCAGR);
    if (cagr >= 20) score += 30;
    else if (cagr >= 10) score += 20;
    else if (cagr >= 5) score += 10;
    else if (cagr < 0) score -= 20;
  }
  if (eps.currentEPS && eps.currentEPS > 0) score += 10;
  else if (eps.currentEPS && eps.currentEPS < 0) score -= 20;
  return {
    score: Math.max(0, Math.min(100, score)),
    detail: {
      currentEPS: eps.currentEPS,
      epsCAGR: eps.epsCAGR,
      consecutiveGrowthYears: eps.consecutiveGrowthYears,
      growthAssessment: eps.growthAssessment,
    },
  };
}

/** EDINETのバリュエーション指標からPER/PBR割安度を評価 */
function scorePERCatalyst(fs: FinancialStatements | null): { score: number; detail: ScreeningResult["perCatalystDetail"] } {
  if (!fs) {
    return {
      score: 0,
      detail: { per: null, pbr: null, catalysts: [] },
    };
  }

  const per = fs.valuation.per;
  const pbr = fs.valuation.pbr;
  let score = 30;
  const catalysts: string[] = [];

  if (per !== null) {
    if (per > 0 && per <= 8) {
      score += 25; catalysts.push(`PER ${per.toFixed(1)}倍 — 超割安`);
    } else if (per > 0 && per <= 12) {
      score += 20; catalysts.push(`PER ${per.toFixed(1)}倍 — 割安`);
    } else if (per > 0 && per <= 15) {
      score += 10;
    } else if (per > 25) {
      score -= 10;
    }
  }
  if (pbr !== null) {
    if (pbr < 0.5) {
      score += 15; catalysts.push(`PBR ${pbr.toFixed(2)}倍 — 解散価値以下`);
    } else if (pbr < 1.0) {
      score += 10; catalysts.push(`PBR ${pbr.toFixed(2)}倍 — 1倍割れ`);
    }
  }
  if (pbr !== null && pbr < 1.0) {
    catalysts.push("東証PBR1倍割れ是正の対象候補");
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    detail: { per, pbr, catalysts },
  };
}

function scoreNetCash(nc: NetCashAnalysis | null): { score: number; detail: ScreeningResult["netCashDetail"] } {
  if (!nc || nc.kiyohara.netCash === null) {
    return { score: 0, detail: { netCashOku: null, netCashRatio: null, verdict: "データなし" } };
  }
  let score = 30;
  // NC比率が取れない場合は絶対額で評価
  if (nc.kiyohara.netCashRatio !== null) {
    const ratio = nc.kiyohara.netCashRatio;
    if (ratio >= 100) score += 60;
    else if (ratio >= 50) score += 45;
    else if (ratio >= 30) score += 30;
    else if (ratio >= 15) score += 15;
    else if (ratio >= 0) score += 5;
    else score -= 10;
  } else {
    // 絶対額のみ（NC > 0 ならプラス評価）
    if (nc.kiyohara.netCash > 0) score += 20;
    else score -= 10;
  }
  const toOku = (val: number | null): string | null => {
    if (val === null) return null;
    return `${(val / 100000000).toFixed(1)}億円`;
  };
  return {
    score: Math.max(0, Math.min(100, score)),
    detail: {
      netCashOku: toOku(nc.kiyohara.netCash),
      netCashRatio: nc.kiyohara.netCashRatio,
      verdict: nc.kiyohara.verdict,
    },
  };
}

function determineGrade(epsScore: number, perScore: number, netCashScore: number): { grade: ScreeningResult["grade"]; gradeLabel: string } {
  const epsOk = epsScore >= 50;
  const perOk = perScore >= 50;
  const ncOk = netCashScore >= 50;
  if (epsOk && perOk && ncOk) return { grade: "🟢🟢", gradeLabel: "強く買い検討" };
  if ((epsOk && perOk) || (epsOk && ncOk)) return { grade: "🟢", gradeLabel: "買い検討" };
  if (perOk && ncOk) return { grade: "🟡", gradeLabel: "残す / 監視" };
  if (ncOk) return { grade: "🟡", gradeLabel: "残す / 監視" };
  return { grade: "🔴", gradeLabel: "見送り" };
}

async function buildUniverseFromEdinet(scanDays: number): Promise<string[]> {
  const client = getEdinetClient();
  const secCodes = new Set<string>();
  for (let i = 0; i < scanDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const resolved = resolveToBusinessDay(d.toISOString().split("T")[0]);
    try {
      const response = await client.getDocumentList({ date: resolved.date, type: "2" });
      for (const doc of response.results) {
        if (
          (doc.docTypeCode === "120" || doc.docTypeCode === "140" || doc.docTypeCode === "160") &&
          doc.secCode && doc.secCode.match(/^\d{5}$/)
        ) {
          secCodes.add(doc.secCode);
        }
      }
    } catch { /* skip */ }
  }
  return Array.from(secCodes);
}

export async function runScreening(criteria: ScreeningCriteria): Promise<ScreeningOutput> {
  const weights = {
    epsGrowth: criteria.weights?.epsGrowth ?? 0.35,
    perCatalyst: criteria.weights?.perCatalyst ?? 0.30,
    netCash: criteria.weights?.netCash ?? 0.35,
  };
  const topN = criteria.topN ?? 20;
  const errors: string[] = [];

  let secCodes: string[];
  let universeLabel: string;
  if (criteria.secCodes && criteria.secCodes.length > 0) {
    secCodes = criteria.secCodes.map(c => c.length === 4 ? c + "0" : c);
    universeLabel = `指定リスト (${secCodes.length}銘柄)`;
  } else {
    const days = criteria.scanDays ?? 5;
    secCodes = await buildUniverseFromEdinet(days);
    universeLabel = `EDINET直近${days}日の開示 (${secCodes.length}銘柄)`;
  }

  const marketCapFilter = criteria.maxMarketCapOku || criteria.minMarketCapOku
    ? `${criteria.minMarketCapOku || 0}億円〜${criteria.maxMarketCapOku || "∞"}億円`
    : null;

  const results: ScreeningResult[] = [];
  const batchSize = 5;

  for (let i = 0; i < secCodes.length; i += batchSize) {
    const batch = secCodes.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (secCode) => {
        const stockErrors: string[] = [];

        // EDINET財務データ取得
        let parsedFs: FinancialStatements | null = null;
        let companyName = secCode;
        try {
          const client = getEdinetClient();
          let docs: any[] = [];
          for (const days of [30, 90, 180, 365]) {
            if (docs.length > 0) break;
            const endDate = new Date().toISOString().split("T")[0];
            const startDate = (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split("T")[0]; })();
            docs = await client.searchBySecCode(secCode, startDate, endDate);
            const reportDocs = docs.filter((d: any) => (d.docTypeCode === "120" || d.docTypeCode === "140" || d.docTypeCode === "160") && d.xbrlFlag === "1");
            if (reportDocs.length > 0) { docs = reportDocs; break; }
          }
          if (docs.length > 0) {
            companyName = docs[0].filerName || secCode;
            const xbrlZip = await client.getDocument(docs[0].docID, "1");
            parsedFs = await parseXbrlFromZip(xbrlZip);
            parsedFs.companyName = parsedFs.companyName || docs[0].filerName;
            parsedFs.secCode = parsedFs.secCode || docs[0].secCode;
          }
        } catch (e) { stockErrors.push(`EDINET取得失敗`); }

        // EPS分析
        let epsAnalysis: EPSAnalysis | null = null;
        try { epsAnalysis = await getEPSHistory(secCode); } catch (e) { stockErrors.push(`EPS取得失敗`); }

        // ネットキャッシュ分析
        let netCashAnalysis: NetCashAnalysis | null = null;
        if (parsedFs) {
          try { netCashAnalysis = await calculateNetCash(parsedFs, secCode); } catch (e) { stockErrors.push(`ネットキャッシュ分析失敗`); }
        }

        const eps = scoreEPSGrowth(epsAnalysis);
        const perCat = scorePERCatalyst(parsedFs);
        const nc = scoreNetCash(netCashAnalysis);
        const totalScore = Math.round(eps.score * weights.epsGrowth + perCat.score * weights.perCatalyst + nc.score * weights.netCash);
        const { grade, gradeLabel } = determineGrade(eps.score, perCat.score, nc.score);
        const company = parsedFs?.companyName || epsAnalysis?.company || companyName;

        const result: ScreeningResult = {
          secCode, company,
          per: parsedFs?.valuation.per || null,
          pbr: parsedFs?.valuation.pbr || null,
          eps: parsedFs?.trailing.eps || null,
          bps: parsedFs?.valuation.bps || null,
          epsScore: eps.score, epsDetail: eps.detail,
          perCatalystScore: perCat.score, perCatalystDetail: perCat.detail,
          netCashScore: nc.score, netCashDetail: nc.detail,
          totalScore, grade, gradeLabel,
        };
        if (stockErrors.length > 0) result.errors = stockErrors;
        return result;
      })
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value) results.push(r.value);
      else if (r.status === "rejected") errors.push(String(r.reason));
    }
  }

  results.sort((a, b) => b.totalScore - a.totalScore);

  return {
    criteria: { universe: universeLabel, marketCapFilter, weights },
    scanned: secCodes.length,
    passed: results.length,
    results: results.slice(0, topN),
    errors,
  };
}
