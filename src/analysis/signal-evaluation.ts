/**
 * シグナル評価エンジン
 * 財務指標を「判断しやすい形式」に変換
 * 
 * 法的注意: これは「情報提供」の範囲内であり、投資助言ではありません。
 * シグナルは業界ベンチマークとの比較に基づく事実の提示です。
 */

export type Signal = "POSITIVE" | "NEUTRAL" | "NEGATIVE";
export type Trend = "IMPROVING" | "STABLE" | "DECLINING";

/**
 * 業界ベンチマーク（一般的な目安）
 * 注: 実際の投資判断には業界別の詳細な分析が必要です
 */
const BENCHMARKS = {
  roe: { excellent: 15, good: 10, poor: 5 },
  roa: { excellent: 8, good: 5, poor: 2 },
  operatingMargin: { excellent: 15, good: 8, poor: 3 },
  netMargin: { excellent: 10, good: 5, poor: 2 },
  currentRatio: { excellent: 2.0, good: 1.5, poor: 1.0 },
  debtToEquity: { excellent: 0.5, good: 1.0, poor: 2.0 }, // 低い方が良い
  payoutRatio: { excellent: 50, good: 30, poor: 10 },
};

/**
 * 指標をシグナルに変換
 */
export function evaluateSignal(
  metric: keyof typeof BENCHMARKS,
  value: number | null
): { signal: Signal; context: string } | null {
  if (value === null) return null;

  const bench = BENCHMARKS[metric];
  
  // debtToEquityは低い方が良い（逆転）
  if (metric === "debtToEquity") {
    if (value <= bench.excellent) return { signal: "POSITIVE", context: "低負債で健全" };
    if (value <= bench.good) return { signal: "NEUTRAL", context: "標準的な負債水準" };
    return { signal: "NEGATIVE", context: "負債比率が高め" };
  }
  
  // その他は高い方が良い
  if (value >= bench.excellent) return { signal: "POSITIVE", context: "業界平均を大きく上回る" };
  if (value >= bench.good) return { signal: "NEUTRAL", context: "業界平均並み" };
  return { signal: "NEGATIVE", context: "業界平均を下回る" };
}

/**
 * 財務健全性スコアを算出（0-100）
 */
export function calculateHealthScore(metrics: {
  roe: number | null;
  roa: number | null;
  operatingMargin: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
}): { score: number; grade: string; factors: string[] } {
  let totalScore = 0;
  let count = 0;
  const factors: string[] = [];

  // ROE (25点満点)
  if (metrics.roe !== null) {
    const roeScore = Math.min(25, Math.max(0, metrics.roe * 1.5));
    totalScore += roeScore;
    count++;
    if (metrics.roe >= 15) factors.push(`✅ 高ROE (${metrics.roe}%)`);
    else if (metrics.roe < 5) factors.push(`⚠️ 低ROE (${metrics.roe}%)`);
  }

  // ROA (20点満点)
  if (metrics.roa !== null) {
    const roaScore = Math.min(20, Math.max(0, metrics.roa * 2));
    totalScore += roaScore;
    count++;
    if (metrics.roa >= 8) factors.push(`✅ 高ROA (${metrics.roa}%)`);
    else if (metrics.roa < 2) factors.push(`⚠️ 低ROA (${metrics.roa}%)`);
  }

  // 営業利益率 (20点満点)
  if (metrics.operatingMargin !== null) {
    const marginScore = Math.min(20, Math.max(0, metrics.operatingMargin * 1.2));
    totalScore += marginScore;
    count++;
    if (metrics.operatingMargin >= 15) factors.push(`✅ 高営業利益率 (${metrics.operatingMargin}%)`);
    else if (metrics.operatingMargin < 3) factors.push(`⚠️ 低営業利益率 (${metrics.operatingMargin}%)`);
  }

  // 流動比率 (15点満点)
  if (metrics.currentRatio !== null) {
    const currentScore = Math.min(15, Math.max(0, metrics.currentRatio * 7.5));
    totalScore += currentScore;
    count++;
    if (metrics.currentRatio >= 2.0) factors.push(`✅ 高流動性 (${metrics.currentRatio}倍)`);
    else if (metrics.currentRatio < 1.0) factors.push(`⚠️ 流動性懸念 (${metrics.currentRatio}倍)`);
  }

  // 負債比率 (20点満点) - 低い方が良い
  if (metrics.debtToEquity !== null) {
    const debtScore = Math.min(20, Math.max(0, 20 - metrics.debtToEquity * 10));
    totalScore += debtScore;
    count++;
    if (metrics.debtToEquity <= 0.5) factors.push(`✅ 低負債 (D/E ${metrics.debtToEquity}倍)`);
    else if (metrics.debtToEquity > 2.0) factors.push(`⚠️ 高負債 (D/E ${metrics.debtToEquity}倍)`);
  }

  // スコアが取れない場合のデフォルト
  if (count === 0) {
    return { score: 50, grade: "データ不足", factors: ["⚠️ 評価に必要なデータが不足"] };
  }

  // 100点満点に正規化
  const normalizedScore = Math.round((totalScore / (count * 20)) * 100);
  
  // グレード判定
  let grade: string;
  if (normalizedScore >= 80) grade = "A (優良)";
  else if (normalizedScore >= 60) grade = "B (良好)";
  else if (normalizedScore >= 40) grade = "C (標準)";
  else if (normalizedScore >= 20) grade = "D (注意)";
  else grade = "E (懸念)";

  return { score: normalizedScore, grade, factors };
}

/**
 * 判断サマリーを生成
 */
export function generateJudgmentSummary(
  healthScore: number,
  highlights: string[],
  risks: string[]
): {
  overallSignal: Signal;
  keyMessage: string;
  actionHint: string;
} {
  let overallSignal: Signal;
  let keyMessage: string;
  let actionHint: string;

  if (healthScore >= 70 && risks.length === 0) {
    overallSignal = "POSITIVE";
    keyMessage = "財務健全性が高く、リスク要因が少ない";
    actionHint = "詳細分析の価値あり";
  } else if (healthScore >= 50 && risks.length <= 1) {
    overallSignal = "NEUTRAL";
    keyMessage = "標準的な財務状況、一部注意点あり";
    actionHint = "リスク要因の詳細確認を推奨";
  } else {
    overallSignal = "NEGATIVE";
    keyMessage = "財務面でいくつかの懸念あり";
    actionHint = "慎重な追加調査が必要";
  }

  return { overallSignal, keyMessage, actionHint };
}

/**
 * 業績修正の影響度を評価
 */
export function evaluateRevisionImpact(
  revisionType: string,
  revisionRate: number
): { level: "HIGH" | "MEDIUM" | "LOW"; direction: Signal; estimatedPriceImpact: string } {
  const absRate = Math.abs(revisionRate);
  const direction: Signal = revisionRate > 0 ? "POSITIVE" : revisionRate < 0 ? "NEGATIVE" : "NEUTRAL";
  
  let level: "HIGH" | "MEDIUM" | "LOW";
  let priceImpact: string;

  if (absRate >= 30) {
    level = "HIGH";
    priceImpact = `±10-15%の株価変動可能性`;
  } else if (absRate >= 10) {
    level = "MEDIUM";
    priceImpact = `±3-10%の株価変動可能性`;
  } else {
    level = "LOW";
    priceImpact = `±3%以内の軽微な影響`;
  }

  return { level, direction, estimatedPriceImpact: priceImpact };
}
