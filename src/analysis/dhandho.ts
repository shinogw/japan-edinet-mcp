/**
 * ダンドー分析（Dhandho Framework）
 * 
 * モニッシュ・パブライのダンドー投資法に基づく
 * 「価値が大きく、負けが小さい」賭けを見つける
 * 
 * 3つの軸:
 * 1. 上昇余地 — 2-3倍になる可能性があるか
 * 2. 下値限定 — 最悪ケースでも大損しないか
 * 3. 確率 — 上昇シナリオの蓋然性が高いか
 */

import { FinancialStatements } from "../parsers/xbrl.js";
import { getStockQuote, StockQuote } from "../api/stock-price.js";
import { NetCashAnalysis, calculateNetCash } from "./net-cash.js";

export interface DhandhoAnalysis {
  company: string;
  secCode: string | null;
  
  // 上昇余地
  upside: {
    score: number;           // 0-100
    currentPER: number | null;
    sectorAvgPER: number | null;  // 簡易推定
    targetPER: number | null;
    currentEPS: number | null;
    epsGrowthRate: number | null;
    potentialReturn: number | null;  // 2年後の想定リターン(%)
    catalysts: string[];
    assessment: string;
  };
  
  // 下値限定
  downside: {
    score: number;           // 0-100
    pbr: number | null;
    netCashRatio: number | null;
    dividendYield: number | null;
    hasStableRevenue: boolean | null;
    floorPrice: number | null;      // 下値目処
    maxDrawdown: number | null;     // 最大想定下落率(%)
    protections: string[];
    assessment: string;
  };
  
  // 確率
  probability: {
    score: number;           // 0-100
    epsGrowthConsecutive: boolean | null;  // EPS連続成長
    revenueGrowing: boolean | null;
    operatingMarginStable: boolean | null;
    lowDebt: boolean | null;
    factors: string[];
    assessment: string;
  };
  
  // 総合判定
  overall: {
    dhandhoScore: number;    // 0-100
    grade: string;           // S/A/B/C/D
    verdict: string;
    matrix: string;          // 判定マトリクス結果
    recommendation: string;
  };
}

const toOku = (val: number | null): string | null => {
  if (val === null) return null;
  return `${(val / 100000000).toFixed(1)}億円`;
};

/**
 * ダンドー分析を実行
 */
export async function analyzeDhandho(
  fs: FinancialStatements,
  nc: NetCashAnalysis,
  quote: StockQuote | null
): Promise<DhandhoAnalysis> {
  
  // === 上昇余地スコア ===
  const upsideResult = evaluateUpside(fs, quote);
  
  // === 下値限定スコア ===
  const downsideResult = evaluateDownside(fs, nc, quote);
  
  // === 確率スコア ===
  const probabilityResult = evaluateProbability(fs, quote);
  
  // === 総合判定 ===
  const dhandhoScore = Math.round(
    upsideResult.score * 0.35 + 
    downsideResult.score * 0.35 + 
    probabilityResult.score * 0.30
  );
  
  let grade: string;
  let verdict: string;
  let recommendation: string;
  
  if (dhandhoScore >= 80) {
    grade = "S";
    verdict = "🔥 ダンドーの理想形 — 大きく勝ち、小さく負ける賭け";
    recommendation = "強く買い検討。ポジションサイズを検討の上、エントリー。";
  } else if (dhandhoScore >= 65) {
    grade = "A";
    verdict = "✅ 良いダンドー — リスク/リワード比が魅力的";
    recommendation = "買い検討。カタリストのタイミングを計る。";
  } else if (dhandhoScore >= 50) {
    grade = "B";
    verdict = "🟡 まずまず — 一部条件を満たすが完璧ではない";
    recommendation = "ウォッチリスト。条件改善を待つ。";
  } else if (dhandhoScore >= 35) {
    grade = "C";
    verdict = "⚪ 微妙 — ダンドーの条件を十分に満たさない";
    recommendation = "見送り推奨。他に良い機会を探す。";
  } else {
    grade = "D";
    verdict = "🔴 ダンドーではない — リスク/リワードが悪い";
    recommendation = "見送り。";
  }
  
  // 判定マトリクス
  const epsOk = upsideResult.score >= 50;
  const peOk = downsideResult.score >= 50;  
  const dhandhoOk = probabilityResult.score >= 50 && downsideResult.score >= 50;
  
  let matrix: string;
  if (epsOk && peOk && dhandhoOk) matrix = "🟢🟢 強く買い増し";
  else if (epsOk && peOk) matrix = "🟢 買い増し";
  else if (epsOk && dhandhoOk) matrix = "🟢 買い増し";
  else if (!epsOk && peOk && dhandhoOk) matrix = "🟡 残す";
  else if (!epsOk && !peOk && dhandhoOk) matrix = "🟡 残す";
  else matrix = "🔴 売却検討";
  
  return {
    company: fs.companyName,
    secCode: fs.secCode,
    upside: upsideResult,
    downside: downsideResult,
    probability: probabilityResult,
    overall: {
      dhandhoScore,
      grade,
      verdict,
      matrix,
      recommendation,
    },
  };
}

function evaluateUpside(fs: FinancialStatements, quote: StockQuote | null): DhandhoAnalysis["upside"] {
  let score = 0;
  const catalysts: string[] = [];
  const per = quote?.per ?? null;
  const eps = fs.incomeStatement.eps ?? quote?.eps ?? null;
  const epsGrowth = fs.metrics.roe !== null && fs.metrics.roe > 0 ? fs.metrics.roe : null; // ROE as proxy
  
  // PERが低い = PE rerating余地
  if (per !== null) {
    if (per < 8) { score += 35; catalysts.push(`PER ${per.toFixed(1)}倍 — 大幅なrerating余地`); }
    else if (per < 12) { score += 25; catalysts.push(`PER ${per.toFixed(1)}倍 — rerating余地あり`); }
    else if (per < 15) { score += 15; catalysts.push(`PER ${per.toFixed(1)}倍 — 適正水準`); }
    else if (per < 25) { score += 5; }
    else { catalysts.push(`PER ${per.toFixed(1)}倍 — 高バリュエーション`); }
  }
  
  // EPS成長 → 利益成長による上昇余地
  const earningsGrowth = (quote as any)?.earningsGrowth ?? null;
  if (fs.metrics.roe !== null) {
    if (fs.metrics.roe >= 20) { score += 30; catalysts.push(`ROE ${fs.metrics.roe}% — 高い利益成長力`); }
    else if (fs.metrics.roe >= 15) { score += 25; catalysts.push(`ROE ${fs.metrics.roe}% — 優良`); }
    else if (fs.metrics.roe >= 10) { score += 15; catalysts.push(`ROE ${fs.metrics.roe}% — 堅実`); }
    else if (fs.metrics.roe >= 5) { score += 5; }
  }
  
  // 営業利益率が高い = 収益力
  if (fs.metrics.operatingMargin !== null) {
    if (fs.metrics.operatingMargin >= 20) { score += 20; catalysts.push(`営業利益率 ${fs.metrics.operatingMargin}% — 高収益`); }
    else if (fs.metrics.operatingMargin >= 10) { score += 10; }
  }
  
  // 想定リターン（簡易: PER 15倍を目標として）
  let potentialReturn: number | null = null;
  if (per !== null && per > 0) {
    const targetPER = Math.min(20, Math.max(12, per * 1.5));
    potentialReturn = Math.round(((targetPER / per) - 1) * 100);
    if (potentialReturn >= 100) { score += 15; catalysts.push(`PE rerating だけで ${potentialReturn}%の上昇余地`); }
    else if (potentialReturn >= 50) { score += 10; }
  }
  
  score = Math.min(100, score);
  
  let assessment: string;
  if (score >= 70) assessment = "大きな上昇余地あり。PER水準と利益成長の掛け算で2倍以上を狙える。";
  else if (score >= 45) assessment = "一定の上昇余地。カタリスト次第で大きくなる可能性。";
  else assessment = "上昇余地は限定的。バリュエーションか成長力に課題。";
  
  return {
    score,
    currentPER: per,
    sectorAvgPER: null,
    targetPER: per ? Math.min(20, Math.max(12, per * 1.5)) : null,
    currentEPS: eps,
    epsGrowthRate: epsGrowth,
    potentialReturn,
    catalysts,
    assessment,
  };
}

function evaluateDownside(fs: FinancialStatements, nc: NetCashAnalysis, quote: StockQuote | null): DhandhoAnalysis["downside"] {
  let score = 0;
  const protections: string[] = [];
  const pbr = quote?.pbr ?? null;
  const ncRatio = nc.kiyohara.netCashRatio;
  const divYield = quote?.dividendYield ?? null;
  
  // PBR < 1 = 資産面での下値サポート
  if (pbr !== null) {
    if (pbr < 0.5) { score += 25; protections.push(`PBR ${pbr.toFixed(2)}倍 — 強い資産裏付け`); }
    else if (pbr < 1.0) { score += 20; protections.push(`PBR ${pbr.toFixed(2)}倍 — 解散価値以下`); }
    else if (pbr < 1.5) { score += 10; protections.push(`PBR ${pbr.toFixed(2)}倍`); }
  }
  
  // ネットキャッシュ比率 = 現金による下値サポート
  if (ncRatio !== null) {
    if (ncRatio >= 100) { score += 30; protections.push(`NC比率 ${ncRatio.toFixed(0)}% — 現金>時価総額`); }
    else if (ncRatio >= 50) { score += 25; protections.push(`NC比率 ${ncRatio.toFixed(0)}% — 強力な現金裏付け`); }
    else if (ncRatio >= 30) { score += 15; protections.push(`NC比率 ${ncRatio.toFixed(0)}% — 一定の安全マージン`); }
    else if (ncRatio >= 0) { score += 5; }
  }
  
  // 配当利回り = 下値サポート
  if (divYield !== null) {
    if (divYield >= 4) { score += 20; protections.push(`配当利回り ${divYield.toFixed(1)}% — 高配当で下値サポート`); }
    else if (divYield >= 3) { score += 15; protections.push(`配当利回り ${divYield.toFixed(1)}%`); }
    else if (divYield >= 2) { score += 10; }
  }
  
  // 低負債 = 財務安全性
  if (fs.metrics.debtToEquity !== null) {
    if (fs.metrics.debtToEquity < 0.3) { score += 15; protections.push("D/Eレシオ極小 — 実質無借金"); }
    else if (fs.metrics.debtToEquity < 0.5) { score += 10; protections.push("低負債経営"); }
  }
  
  // 流動比率
  if (fs.metrics.currentRatio !== null && fs.metrics.currentRatio >= 2.0) {
    score += 10; protections.push(`流動比率 ${fs.metrics.currentRatio} — 短期安全性高い`);
  }
  
  score = Math.min(100, score);
  
  // 最大想定下落率
  let maxDrawdown: number | null = null;
  if (pbr !== null && pbr > 0) {
    // PBR 0.5倍までの下落を最悪ケースと仮定
    const floorPBR = Math.max(0.3, pbr * 0.5);
    maxDrawdown = Math.round((1 - floorPBR / pbr) * 100);
  }
  
  let assessment: string;
  if (score >= 70) assessment = "下値限定。PBR・NC比率・配当のトリプルプロテクション。大損しにくい構造。";
  else if (score >= 45) assessment = "一定の下値サポートあり。壊滅的下落は回避できそう。";
  else assessment = "下値サポートが弱い。大幅下落リスクに注意。";
  
  return {
    score,
    pbr,
    netCashRatio: ncRatio,
    dividendYield: divYield,
    hasStableRevenue: fs.incomeStatement.revenue !== null && fs.incomeStatement.revenue > 0,
    floorPrice: null,
    maxDrawdown,
    protections,
    assessment,
  };
}

function evaluateProbability(fs: FinancialStatements, quote: StockQuote | null): DhandhoAnalysis["probability"] {
  let score = 0;
  const factors: string[] = [];
  
  // ROE安定 = 持続的な利益創出
  if (fs.metrics.roe !== null && fs.metrics.roe >= 10) {
    score += 25;
    factors.push(`ROE ${fs.metrics.roe}% — 持続的な利益創出力`);
  }
  
  // 営業利益率 = ビジネスの質
  if (fs.metrics.operatingMargin !== null) {
    if (fs.metrics.operatingMargin >= 15) { score += 20; factors.push("高い営業利益率 — 競争優位性あり"); }
    else if (fs.metrics.operatingMargin >= 8) { score += 10; factors.push("安定した営業利益率"); }
  }
  
  // FCFプラス = キャッシュ創出
  if (fs.cashFlow.freeCashFlow !== null && fs.cashFlow.freeCashFlow > 0) {
    score += 20;
    factors.push(`FCF ${toOku(fs.cashFlow.freeCashFlow)} — キャッシュ創出力`);
  }
  
  // 低負債 = 財務リスク小
  if (fs.metrics.debtToEquity !== null) {
    if (fs.metrics.debtToEquity < 0.5) { score += 15; factors.push("低レバレッジ — 財務リスク小"); }
    else if (fs.metrics.debtToEquity < 1.0) { score += 5; }
    else { factors.push("レバレッジ高め — 金利上昇リスク"); }
  }
  
  // 売上がある = 事業基盤
  if (fs.incomeStatement.revenue !== null && fs.incomeStatement.netIncome !== null) {
    if (fs.incomeStatement.netIncome > 0) {
      score += 15;
      factors.push("黒字経営 — 基盤あり");
    } else {
      factors.push("⚠️ 赤字 — 上昇シナリオの蓋然性に疑問");
    }
  }
  
  score = Math.min(100, score);
  
  let assessment: string;
  if (score >= 70) assessment = "上昇シナリオの蓋然性が高い。ビジネス基盤が堅固で、成長の持続性に自信。";
  else if (score >= 45) assessment = "まずまずの蓋然性。一部リスク要因あるが、基本シナリオは健全。";
  else assessment = "蓋然性が低い。ビジネス基盤か財務に課題があり、確信を持ちにくい。";
  
  return {
    score,
    epsGrowthConsecutive: null,
    revenueGrowing: fs.incomeStatement.revenue !== null && fs.incomeStatement.revenue > 0,
    operatingMarginStable: fs.metrics.operatingMargin !== null && fs.metrics.operatingMargin >= 5,
    lowDebt: fs.metrics.debtToEquity !== null && fs.metrics.debtToEquity < 1.0,
    factors,
    assessment,
  };
}

/**
 * ダンドー分析をフォーマット
 */
export function formatDhandhoAnalysis(analysis: DhandhoAnalysis): object {
  return {
    company: analysis.company,
    secCode: analysis.secCode,
    
    overall: {
      dhandhoScore: `${analysis.overall.dhandhoScore}/100`,
      grade: analysis.overall.grade,
      verdict: analysis.overall.verdict,
      matrix: analysis.overall.matrix,
      recommendation: analysis.overall.recommendation,
    },
    
    upside: {
      score: `${analysis.upside.score}/100`,
      currentPER: analysis.upside.currentPER ? `${analysis.upside.currentPER.toFixed(1)}倍` : null,
      potentialReturn: analysis.upside.potentialReturn ? `${analysis.upside.potentialReturn}%` : null,
      catalysts: analysis.upside.catalysts,
      assessment: analysis.upside.assessment,
    },
    
    downside: {
      score: `${analysis.downside.score}/100`,
      pbr: analysis.downside.pbr ? `${analysis.downside.pbr.toFixed(2)}倍` : null,
      netCashRatio: analysis.downside.netCashRatio ? `${analysis.downside.netCashRatio.toFixed(1)}%` : null,
      dividendYield: analysis.downside.dividendYield ? `${analysis.downside.dividendYield.toFixed(1)}%` : null,
      maxDrawdown: analysis.downside.maxDrawdown ? `${analysis.downside.maxDrawdown}%` : null,
      protections: analysis.downside.protections,
      assessment: analysis.downside.assessment,
    },
    
    probability: {
      score: `${analysis.probability.score}/100`,
      factors: analysis.probability.factors,
      assessment: analysis.probability.assessment,
    },
    
    note: "ダンドー投資法: 「大きく勝ち、小さく負ける」非対称な賭けを探す。スコアは定量データに基づく参考値。定性的な競争優位性・経営者の質は別途評価が必要。",
  };
}
