/**
 * 統合スクリーニング
 * 3つの視点で銘柄を一括評価:
 *   1. EPS成長性
 *   2. PER割安 + カタリスト期待
 *   3. 清原式ネットキャッシュ
 */

import { getStockQuote, StockQuote } from "../api/stock-price.js";
import { getEPSHistory, EPSAnalysis } from "./eps-history.js";
import { calculateNetCash, NetCashAnalysis } from "./net-cash.js";
import { getEdinetClient } from "../api/edinet.js";
import { parseXbrlFromZip } from "../parsers/xbrl-parser.js";
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
  price: number | null;
  marketCapOku: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
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
    dividendYield: number | null;
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

function scorePERCatalyst(quote: StockQuote | null): { score: number; detail: ScreeningResult["perCatalystDetail"] } {
  if (!quote) {
    return {
      score: 0,
      detail: { per: null, pbr: null, dividendYield: null, catalysts: [] },
    };
  }
  let score = 30;
  const catalysts: string[] = [];
  if (quote.per !== null) {
    if (quote.per > 0 && quote.per <= 8) {
      score += 25; catalysts.push(`PER ${quote.per.toFixed(1)}倍 — 超割安`);
    } else if (quote.per > 0 && quote.per <= 12) {
      score += 20; catalysts.push(`PER ${quote.per.toFixed(1)}倍 — 割安`);
    } else if (quote.per > 0 && quote.per <= 15) {
      score += 10;
    } else if (quote.per > 25) {
      score -= 10;
    }
  }
  if (quote.pbr !== null) {
    if (quote.pbr < 0.5) {
      score += 15; catalysts.push(`PBR ${quote.pbr.toFixed(2)}倍 — 解散価値以下`);
    } else if (quote.pbr < 1.0) {
      score += 10; catalysts.push(`PBR ${quote.pbr.toFixed(2)}倍 — 1倍割れ`);
    }
  }
  if (quote.dividendYield !== null) {
    if (quote.dividendYield >= 4.0) {
      score += 15; catalysts.push(`配当利回り ${quote.dividendYield.toFixed(1)}% — 高配当`);
    } else if (quote.dividendYield >= 3.0) {
      score += 10; catalysts.push(`配当利回り ${quote.dividendYield.toFixed(1)}%`);
    }
  }
  if (quote.pbr !== null && quote.pbr < 1.0) {
    catalysts.push("東証PBR1倍割れ是正の対象候補");
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    detail: { per: quote.per, pbr: quote.pbr, dividendYield: quote.dividendYield, catalysts },
  };
}

function scoreNetCash(nc: NetCashAnalysis | null): { score: number; detail: ScreeningResult["netCashDetail"] } {
  if (!nc || nc.kiyohara.netCashRatio === null) {
    return { score: 0, detail: { netCashOku: null, netCashRatio: null, verdict: "データなし" } };
  }
  let score = 30;
  const ratio = nc.kiyohara.netCashRatio;
  if (ratio >= 100) score += 60;
  else if (ratio >= 50) score += 45;
  else if (ratio >= 30) score += 30;
  else if (ratio >= 15) score += 15;
  else if (ratio >= 0) score += 5;
  else score -= 10;
  const toOku = (val: number | null): string | null => {
    if (val === null) return null;
    return `${(val / 100000000).toFixed(1)}億円`;
  };
  return {
    score: Math.max(0, Math.min(100, score)),
    detail: { netCashOku: toOku(nc.kiyohara.netCash), netCashRatio: ratio, verdict: nc.kiyohara.verdict },
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
        
        let quote: StockQuote | null = null;
        try { quote = await getStockQuote(secCode); } catch (e) { stockErrors.push(`株価取得失敗`); }
        
        if (quote?.marketCap) {
          const mcOku = quote.marketCap / 100000000;
          if (criteria.maxMarketCapOku && mcOku > criteria.maxMarketCapOku) return null;
          if (criteria.minMarketCapOku && mcOku < criteria.minMarketCapOku) return null;
        }
        
        let epsAnalysis: EPSAnalysis | null = null;
        try { epsAnalysis = await getEPSHistory(secCode); } catch (e) { stockErrors.push(`EPS取得失敗`); }
        
        let netCashAnalysis: NetCashAnalysis | null = null;
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
            const xbrlZip = await client.getDocument(docs[0].docID, "1");
            const parsedFs = await parseXbrlFromZip(xbrlZip);
            parsedFs.companyName = parsedFs.companyName || docs[0].filerName;
            parsedFs.secCode = parsedFs.secCode || docs[0].secCode;
            netCashAnalysis = await calculateNetCash(parsedFs, secCode);
          }
        } catch (e) { stockErrors.push(`ネットキャッシュ分析失敗`); }
        
        const eps = scoreEPSGrowth(epsAnalysis);
        const perCat = scorePERCatalyst(quote);
        const nc = scoreNetCash(netCashAnalysis);
        const totalScore = Math.round(eps.score * weights.epsGrowth + perCat.score * weights.perCatalyst + nc.score * weights.netCash);
        const { grade, gradeLabel } = determineGrade(eps.score, perCat.score, nc.score);
        const company = quote?.name || epsAnalysis?.company || netCashAnalysis?.company || secCode;
        
        const result: ScreeningResult = {
          secCode, company,
          price: quote?.price || null,
          marketCapOku: quote?.marketCap ? Math.round(quote.marketCap / 100000000) : null,
          per: quote?.per || null, pbr: quote?.pbr || null, dividendYield: quote?.dividendYield || null,
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
