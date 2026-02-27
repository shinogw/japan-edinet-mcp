/**
 * 投資推奨レーティングエンジン
 * 投資助言業登録に基づく法的根拠付き推奨
 */

import { FinancialStatements } from "../parsers/xbrl.js";

export type Recommendation = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";

export interface InvestmentRecommendation {
  // 推奨
  recommendation: Recommendation;
  confidence: number; // 0-1
  
  // 根拠
  rationale: {
    summary: string;
    positives: string[];
    negatives: string[];
    keyMetrics: Record<string, string>;
  };
  
  // リスク
  risks: string[];
  
  // 法的情報
  legal: {
    disclaimer: string;
    basis: string;
    registrationNumber: string;
  };
  
  // メタ情報
  meta: {
    analyzedAt: string;
    dataSource: string;
    fiscalPeriod: string;
  };
}

/**
 * スコアリング基準
 */
interface ScoringCriteria {
  metric: string;
  value: number | null;
  weight: number;
  thresholds: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  higherIsBetter: boolean;
}

/**
 * 財務データから投資推奨を生成
 */
export function generateInvestmentRecommendation(
  fs: FinancialStatements,
  registrationNumber: string = "関東財務局長（金商）第XXXX号"
): InvestmentRecommendation {
  
  // スコアリング基準を定義
  const criteria: ScoringCriteria[] = [
    {
      metric: "ROE",
      value: fs.metrics.roe,
      weight: 25,
      thresholds: { excellent: 15, good: 10, fair: 5, poor: 0 },
      higherIsBetter: true,
    },
    {
      metric: "ROA",
      value: fs.metrics.roa,
      weight: 15,
      thresholds: { excellent: 8, good: 5, fair: 2, poor: 0 },
      higherIsBetter: true,
    },
    {
      metric: "営業利益率",
      value: fs.metrics.operatingMargin,
      weight: 20,
      thresholds: { excellent: 15, good: 10, fair: 5, poor: 0 },
      higherIsBetter: true,
    },
    {
      metric: "純利益率",
      value: fs.metrics.netMargin,
      weight: 10,
      thresholds: { excellent: 10, good: 5, fair: 2, poor: 0 },
      higherIsBetter: true,
    },
    {
      metric: "D/Eレシオ",
      value: fs.metrics.debtToEquity,
      weight: 15,
      thresholds: { excellent: 0.3, good: 0.7, fair: 1.5, poor: 3 },
      higherIsBetter: false,
    },
    {
      metric: "流動比率",
      value: fs.metrics.currentRatio,
      weight: 15,
      thresholds: { excellent: 2, good: 1.5, fair: 1, poor: 0.5 },
      higherIsBetter: true,
    },
  ];

  // スコア計算
  let totalScore = 0;
  let totalWeight = 0;
  const positives: string[] = [];
  const negatives: string[] = [];
  const keyMetrics: Record<string, string> = {};

  for (const c of criteria) {
    if (c.value === null) continue;
    
    totalWeight += c.weight;
    let score = 0;
    
    if (c.higherIsBetter) {
      if (c.value >= c.thresholds.excellent) {
        score = 100;
        positives.push(`${c.metric} ${c.value}%は優良水準（${c.thresholds.excellent}%以上）`);
      } else if (c.value >= c.thresholds.good) {
        score = 75;
        positives.push(`${c.metric} ${c.value}%は良好水準`);
      } else if (c.value >= c.thresholds.fair) {
        score = 50;
      } else {
        score = 25;
        negatives.push(`${c.metric} ${c.value}%は要注意水準`);
      }
    } else {
      // Lower is better (e.g., D/E ratio)
      if (c.value <= c.thresholds.excellent) {
        score = 100;
        positives.push(`${c.metric} ${c.value}は健全水準（${c.thresholds.excellent}以下）`);
      } else if (c.value <= c.thresholds.good) {
        score = 75;
        positives.push(`${c.metric} ${c.value}は良好水準`);
      } else if (c.value <= c.thresholds.fair) {
        score = 50;
      } else {
        score = 25;
        negatives.push(`${c.metric} ${c.value}は高リスク水準`);
      }
    }
    
    totalScore += score * c.weight;
    keyMetrics[c.metric] = c.higherIsBetter 
      ? `${c.value}%` 
      : `${c.value}`;
  }

  // フリーキャッシュフロー評価
  if (fs.cashFlow.freeCashFlow !== null) {
    const fcfBillions = fs.cashFlow.freeCashFlow / 100000000;
    if (fcfBillions > 0) {
      positives.push(`フリーCF ${fcfBillions.toFixed(1)}億円とキャッシュ創出力あり`);
      totalScore += 10 * 100;
      totalWeight += 10;
    } else {
      negatives.push(`フリーCFがマイナス（${fcfBillions.toFixed(1)}億円）`);
      totalScore += 10 * 25;
      totalWeight += 10;
    }
    keyMetrics["フリーCF"] = `${fcfBillions.toFixed(1)}億円`;
  }

  // 最終スコア（0-100）
  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 50;
  
  // スコアから推奨を決定
  let recommendation: Recommendation;
  let summary: string;
  
  if (finalScore >= 85) {
    recommendation = "STRONG_BUY";
    summary = "財務指標が全般的に優良。積極的な投資検討を推奨。";
  } else if (finalScore >= 70) {
    recommendation = "BUY";
    summary = "財務健全性が高く、投資妙味あり。";
  } else if (finalScore >= 50) {
    recommendation = "HOLD";
    summary = "財務状況は中立的。追加情報を待って判断を推奨。";
  } else if (finalScore >= 35) {
    recommendation = "SELL";
    summary = "財務面でいくつかの懸念あり。ポジション縮小を検討。";
  } else {
    recommendation = "STRONG_SELL";
    summary = "財務リスクが高い。投資回避を推奨。";
  }

  // リスク要因の特定
  const risks: string[] = [];
  if (fs.metrics.debtToEquity !== null && fs.metrics.debtToEquity > 1.5) {
    risks.push("高レバレッジによる金利上昇リスク");
  }
  if (fs.metrics.currentRatio !== null && fs.metrics.currentRatio < 1) {
    risks.push("短期流動性リスク");
  }
  if (fs.cashFlow.operatingCF !== null && fs.cashFlow.operatingCF < 0) {
    risks.push("本業からのキャッシュ創出力低下");
  }
  if (negatives.length === 0 && risks.length === 0) {
    risks.push("特筆すべきリスク要因は検出されず");
  }

  // 信頼度（データの充実度に基づく）
  const dataCompleteness = totalWeight / 110; // 最大110ポイント
  const confidence = Math.min(0.95, Math.max(0.3, dataCompleteness));

  return {
    recommendation,
    confidence: Math.round(confidence * 100) / 100,
    rationale: {
      summary,
      positives: positives.length > 0 ? positives : ["特筆すべきポジティブ要因なし"],
      negatives: negatives.length > 0 ? negatives : ["顕著なネガティブ要因なし"],
      keyMetrics,
    },
    risks,
    legal: {
      disclaimer: "本推奨は財務データに基づく定量分析であり、投資成果を保証するものではありません。投資判断は自己責任で行ってください。",
      basis: "金融商品取引法に基づく投資助言業登録",
      registrationNumber,
    },
    meta: {
      analyzedAt: new Date().toISOString(),
      dataSource: "EDINET (金融庁)",
      fiscalPeriod: fs.fiscalPeriod || fs.fiscalYear,
    },
  };
}

/**
 * 複数企業の比較ランキング
 */
export function rankCompanies(
  companies: Array<{ name: string; secCode: string; fs: FinancialStatements }>
): Array<{
  rank: number;
  name: string;
  secCode: string;
  score: number;
  recommendation: Recommendation;
  highlights: string[];
}> {
  const ranked = companies.map((c) => {
    const rec = generateInvestmentRecommendation(c.fs);
    const score = 
      rec.recommendation === "STRONG_BUY" ? 100 :
      rec.recommendation === "BUY" ? 80 :
      rec.recommendation === "HOLD" ? 60 :
      rec.recommendation === "SELL" ? 40 : 20;
    
    return {
      name: c.name,
      secCode: c.secCode,
      score,
      recommendation: rec.recommendation,
      highlights: rec.rationale.positives.slice(0, 2),
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  
  return ranked.map((r, i) => ({
    rank: i + 1,
    ...r,
  }));
}
