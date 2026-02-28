/**
 * 投資判断エンジン
 * 投資助言業ライセンスに基づく明示的な投資推奨
 * 
 * 注意: このモジュールは投資助言業登録を持つ事業者向けです。
 */

import { FinancialStatements } from "../parsers/xbrl.js";

export type Verdict = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";

export interface InvestmentVerdict {
  // 判断
  verdict: Verdict;
  verdictLabel: string;
  confidence: number;  // 0-1
  
  // 根拠
  rationale: {
    positive: string[];
    negative: string[];
  };
  
  // スコア詳細
  scores: {
    profitability: number;    // 収益性 0-100
    stability: number;        // 安定性 0-100
    growth: number;           // 成長性 0-100
    valuation: number;        // バリュエーション 0-100
    overall: number;          // 総合 0-100
  };
  
  // リスク
  risks: string[];
  
  // 免責事項
  disclaimer: string;
  
  // メタデータ
  analysisDate: string;
  dataSource: string;
}

const VERDICT_LABELS: Record<Verdict, string> = {
  "STRONG_BUY": "強気買い",
  "BUY": "買い",
  "HOLD": "中立",
  "SELL": "売り",
  "STRONG_SELL": "強気売り",
};

const DISCLAIMER = `
本情報は投資助言業登録に基づく情報提供であり、特定の金融商品の売買を推奨するものではありません。
投資判断はご自身の責任において行ってください。
過去の実績は将来の成果を保証するものではありません。
`.trim();

/**
 * 収益性スコアを計算
 */
function calculateProfitabilityScore(fs: FinancialStatements): { score: number; reasons: string[] } {
  let score = 50; // ベーススコア
  const reasons: string[] = [];
  
  // ROE
  if (fs.metrics.roe !== null) {
    if (fs.metrics.roe >= 15) {
      score += 20;
      reasons.push(`高ROE (${fs.metrics.roe}%)`);
    } else if (fs.metrics.roe >= 10) {
      score += 10;
      reasons.push(`良好なROE (${fs.metrics.roe}%)`);
    } else if (fs.metrics.roe < 5) {
      score -= 15;
      reasons.push(`低ROE (${fs.metrics.roe}%)`);
    }
  }
  
  // ROA
  if (fs.metrics.roa !== null) {
    if (fs.metrics.roa >= 8) {
      score += 15;
      reasons.push(`高ROA (${fs.metrics.roa}%)`);
    } else if (fs.metrics.roa >= 5) {
      score += 8;
    } else if (fs.metrics.roa < 2) {
      score -= 10;
      reasons.push(`低ROA (${fs.metrics.roa}%)`);
    }
  }
  
  // 営業利益率
  if (fs.metrics.operatingMargin !== null) {
    if (fs.metrics.operatingMargin >= 15) {
      score += 15;
      reasons.push(`高営業利益率 (${fs.metrics.operatingMargin}%)`);
    } else if (fs.metrics.operatingMargin >= 8) {
      score += 8;
    } else if (fs.metrics.operatingMargin < 3) {
      score -= 10;
      reasons.push(`低営業利益率 (${fs.metrics.operatingMargin}%)`);
    }
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * 安定性スコアを計算
 */
function calculateStabilityScore(fs: FinancialStatements): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];
  
  // 流動比率
  if (fs.metrics.currentRatio !== null) {
    if (fs.metrics.currentRatio >= 2.0) {
      score += 20;
      reasons.push(`高い流動性 (流動比率 ${fs.metrics.currentRatio}倍)`);
    } else if (fs.metrics.currentRatio >= 1.5) {
      score += 10;
    } else if (fs.metrics.currentRatio < 1.0) {
      score -= 20;
      reasons.push(`流動性懸念 (流動比率 ${fs.metrics.currentRatio}倍)`);
    }
  }
  
  // D/Eレシオ
  if (fs.metrics.debtToEquity !== null) {
    if (fs.metrics.debtToEquity <= 0.5) {
      score += 20;
      reasons.push(`低負債 (D/E ${fs.metrics.debtToEquity}倍)`);
    } else if (fs.metrics.debtToEquity <= 1.0) {
      score += 10;
    } else if (fs.metrics.debtToEquity > 2.0) {
      score -= 20;
      reasons.push(`高負債 (D/E ${fs.metrics.debtToEquity}倍)`);
    }
  }
  
  // 営業CF
  if (fs.cashFlow.operatingCF !== null) {
    if (fs.cashFlow.operatingCF > 0) {
      score += 10;
      reasons.push("営業CFプラス");
    } else {
      score -= 15;
      reasons.push("営業CFマイナス");
    }
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * 成長性スコアを計算（簡易版）
 */
function calculateGrowthScore(fs: FinancialStatements): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];
  
  // 売上高がある場合（前年比較はデータがないため、現状ではベーススコア）
  if (fs.incomeStatement.revenue !== null && fs.incomeStatement.revenue > 0) {
    score += 10;
    reasons.push("売上高データあり");
  }
  
  // フリーキャッシュフロー
  if (fs.cashFlow.freeCashFlow !== null) {
    if (fs.cashFlow.freeCashFlow > 0) {
      score += 15;
      reasons.push("フリーCFプラス");
    } else {
      score -= 10;
      reasons.push("フリーCFマイナス");
    }
  }
  
  // 配当
  if (fs.dividend.annualDividendPerShare !== null && fs.dividend.annualDividendPerShare > 0) {
    score += 10;
    reasons.push("配当あり");
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * バリュエーションスコア（簡易版）
 */
function calculateValuationScore(fs: FinancialStatements): { score: number; reasons: string[] } {
  // PER, PBRがないため、配当性向で代用
  let score = 50;
  const reasons: string[] = [];
  
  if (fs.dividend.payoutRatio !== null) {
    if (fs.dividend.payoutRatio >= 30 && fs.dividend.payoutRatio <= 50) {
      score += 15;
      reasons.push(`適正な配当性向 (${fs.dividend.payoutRatio}%)`);
    } else if (fs.dividend.payoutRatio > 80) {
      score -= 10;
      reasons.push(`高い配当性向 (${fs.dividend.payoutRatio}%) - 持続性懸念`);
    }
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * 総合判断を生成
 */
export function generateInvestmentVerdict(fs: FinancialStatements): InvestmentVerdict {
  // 各スコアを計算
  const profitability = calculateProfitabilityScore(fs);
  const stability = calculateStabilityScore(fs);
  const growth = calculateGrowthScore(fs);
  const valuation = calculateValuationScore(fs);
  
  // 総合スコア（重み付き平均）
  const overall = Math.round(
    profitability.score * 0.3 +
    stability.score * 0.25 +
    growth.score * 0.25 +
    valuation.score * 0.2
  );
  
  // 判断を決定
  let verdict: Verdict;
  if (overall >= 80) verdict = "STRONG_BUY";
  else if (overall >= 65) verdict = "BUY";
  else if (overall >= 40) verdict = "HOLD";
  else if (overall >= 25) verdict = "SELL";
  else verdict = "STRONG_SELL";
  
  // 信頼度（データの充実度に基づく）
  let dataPoints = 0;
  if (fs.metrics.roe !== null) dataPoints++;
  if (fs.metrics.roa !== null) dataPoints++;
  if (fs.metrics.operatingMargin !== null) dataPoints++;
  if (fs.metrics.currentRatio !== null) dataPoints++;
  if (fs.metrics.debtToEquity !== null) dataPoints++;
  if (fs.cashFlow.operatingCF !== null) dataPoints++;
  if (fs.cashFlow.freeCashFlow !== null) dataPoints++;
  const confidence = Math.min(0.95, dataPoints / 7 * 0.7 + 0.3);
  
  // ポジティブ/ネガティブ理由を分離
  const allReasons = [
    ...profitability.reasons,
    ...stability.reasons,
    ...growth.reasons,
    ...valuation.reasons,
  ];
  
  const positive = allReasons.filter(r => 
    r.includes("高") || r.includes("良好") || r.includes("プラス") || r.includes("低負債") || r.includes("適正")
  );
  const negative = allReasons.filter(r => 
    r.includes("低") || r.includes("マイナス") || r.includes("懸念") || r.includes("高負債")
  );
  
  // リスク要因
  const risks: string[] = [];
  if (fs.metrics.debtToEquity !== null && fs.metrics.debtToEquity > 1.5) {
    risks.push("財務レバレッジリスク");
  }
  if (fs.cashFlow.operatingCF !== null && fs.cashFlow.operatingCF < 0) {
    risks.push("キャッシュフローリスク");
  }
  if (fs.metrics.currentRatio !== null && fs.metrics.currentRatio < 1.0) {
    risks.push("短期流動性リスク");
  }
  if (confidence < 0.6) {
    risks.push("データ不足による判断精度リスク");
  }
  
  return {
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    confidence: Math.round(confidence * 100) / 100,
    rationale: {
      positive: positive.length > 0 ? positive : ["特筆すべきポジティブ要因なし"],
      negative: negative.length > 0 ? negative : ["特筆すべきネガティブ要因なし"],
    },
    scores: {
      profitability: profitability.score,
      stability: stability.score,
      growth: growth.score,
      valuation: valuation.score,
      overall,
    },
    risks: risks.length > 0 ? risks : ["重大なリスク要因は検出されませんでした"],
    disclaimer: DISCLAIMER,
    analysisDate: new Date().toISOString().split("T")[0],
    dataSource: "EDINET (金融庁)",
  };
}
