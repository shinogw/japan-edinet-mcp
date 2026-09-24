/**
 * 時系列トレンド分析エンジン
 * 過去複数期の財務データを分析し、成長トレンドを検出
 * 
 * AIが自分でやると：
 * - 過去5年分のXBRLを全部ダウンロード（5回のAPI + 5回のZIP解凍）
 * - 各期のデータをパース（5回のXBRL解析）
 * - 成長率計算ロジックを実装
 * - トレンド判定ロジックを実装
 * → 推定トークン消費: 500,000+
 * 
 * このMCPなら: 1 API呼び出し
 */

import type { HistoryEntry } from "../parsers/xbrl.js";

export interface TrendMetric {
  metric: string;
  values: Array<{
    period: string;
    value: number | null;
    yoyChange: number | null; // 前年比変化率（%）
  }>;
  trend: "STRONG_GROWTH" | "GROWTH" | "STABLE" | "DECLINE" | "STRONG_DECLINE" | "VOLATILE" | "INSUFFICIENT_DATA";
  cagr: number | null; // 年平均成長率（%）
  summary: string;
}

export interface TrendAnalysis {
  companyName: string;
  secCode: string | null;
  analysisPeriod: string;
  
  // 主要指標のトレンド
  revenue: TrendMetric;
  ordinaryIncome: TrendMetric; // 営業利益は推移表に無いため経常利益（IFRSは税引前利益）
  netIncome: TrendMetric;
  eps: TrendMetric;
  totalAssets: TrendMetric;
  roe: TrendMetric;
  
  // 総合評価
  overallTrend: "EXPANDING" | "STABLE" | "CONTRACTING" | "TURNAROUND" | "DETERIORATING";
  
  // AIサマリー
  summary: {
    headline: string;
    keyFindings: string[];
    growthDrivers: string[];
    concerns: string[];
    outlook: string;
  };
  
  // トークン節約量
  tokenSaved: string;
}

/**
 * 成長率を計算（CAGR）
 */
function calculateCAGR(startValue: number, endValue: number, years: number): number | null {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return null;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

/**
 * トレンドを判定
 */
function determineTrend(values: Array<{ value: number | null; yoyChange: number | null }>): TrendMetric["trend"] {
  const validChanges = values
    .map((v) => v.yoyChange)
    .filter((c): c is number => c !== null);
  
  if (validChanges.length < 2) return "INSUFFICIENT_DATA";
  
  const avgChange = validChanges.reduce((a, b) => a + b, 0) / validChanges.length;
  const positiveCount = validChanges.filter((c) => c > 0).length;
  const negativeCount = validChanges.filter((c) => c < 0).length;
  
  // 変動が大きい場合
  // 大きな振れ（50%超）があり、かつ10%超の逆方向の動きもある場合のみ
  const maxChange = Math.max(...validChanges.map(Math.abs));
  const bigUp = validChanges.some((c) => c > 10);
  const bigDown = validChanges.some((c) => c < -10);
  if (maxChange > 50 && bigUp && bigDown) {
    return "VOLATILE";
  }
  
  if (avgChange >= 15 && positiveCount >= validChanges.length * 0.7) {
    return "STRONG_GROWTH";
  } else if (avgChange >= 5 && positiveCount >= validChanges.length * 0.6) {
    return "GROWTH";
  } else if (avgChange <= -15 && negativeCount >= validChanges.length * 0.7) {
    return "STRONG_DECLINE";
  } else if (avgChange <= -5 && negativeCount >= validChanges.length * 0.6) {
    return "DECLINE";
  } else {
    return "STABLE";
  }
}

/**
 * トレンドのサマリーを生成
 */
function generateTrendSummary(metric: string, trend: TrendMetric["trend"], cagr: number | null): string {
  const cagrStr = cagr !== null ? `（CAGR: ${cagr.toFixed(1)}%）` : "";
  
  switch (trend) {
    case "STRONG_GROWTH":
      return `${metric}は力強い成長トレンド${cagrStr}`;
    case "GROWTH":
      return `${metric}は成長基調${cagrStr}`;
    case "STABLE":
      return `${metric}は安定推移${cagrStr}`;
    case "DECLINE":
      return `${metric}は減少傾向${cagrStr}`;
    case "STRONG_DECLINE":
      return `${metric}は大幅減少${cagrStr}`;
    case "VOLATILE":
      return `${metric}は変動が大きい`;
    default:
      return `${metric}はデータ不足`;
  }
}

/**
 * 有価証券報告書「主要な経営指標等の推移」（最大5期）から時系列トレンドを分析
 */
export function buildTrendAnalysis(
  companyName: string,
  secCode: string | null,
  history: HistoryEntry[]
): TrendAnalysis {
  const label = (h: HistoryEntry, i: number) =>
    h.periodEnd ? `FY${h.periodEnd.substring(0, 7)}` : `FY-${history.length - 1 - i}`;

  const buildMetric = (
    metric: string,
    pickValue: (h: HistoryEntry) => number | null,
    changeMode: "percent" | "points" = "percent"
  ): TrendMetric => {
    const values = history.map((h, i) => {
      const value = pickValue(h);
      const prev = i > 0 ? pickValue(history[i - 1]) : null;
      let yoyChange: number | null = null;
      if (value !== null && prev !== null) {
        if (changeMode === "points") yoyChange = Math.round((value - prev) * 100) / 100;
        else if (prev !== 0) yoyChange = Math.round(((value - prev) / Math.abs(prev)) * 10000) / 100;
      }
      return { period: label(h, i), value, yoyChange };
    });

    const valid = values.filter((v) => v.value !== null);
    const cagr = changeMode === "percent" && valid.length >= 2
      ? calculateCAGR(valid[0].value!, valid[valid.length - 1].value!, valid.length - 1)
      : null;
    const roundedCagr = cagr !== null ? Math.round(cagr * 100) / 100 : null;

    // ROE等（%ポイント差）は変化幅をそのまま率として判定するとブレるため、2pt以上の動きを変化とみなす
    const trend = changeMode === "points"
      ? determinePointTrend(valid.map((v) => v.value!))
      : determineTrend(values);

    return {
      metric,
      values,
      trend,
      cagr: roundedCagr,
      summary: generateTrendSummary(metric, trend, roundedCagr),
    };
  };

  const revenue = buildMetric("売上高", (h) => h.revenue);
  const ordinaryIncome = buildMetric("経常利益（IFRSは税引前利益）", (h) => h.ordinaryIncome);
  const netIncome = buildMetric("純利益", (h) => h.netIncome);
  const eps = buildMetric("EPS", (h) => h.eps);
  const totalAssets = buildMetric("総資産", (h) => h.totalAssets);
  const roe = buildMetric("ROE", (h) => h.roe, "points");

  // 総合評価
  const core = [revenue, ordinaryIncome, netIncome];
  const growthCount = core.filter((m) => m.trend === "GROWTH" || m.trend === "STRONG_GROWTH").length;
  const declineCount = core.filter((m) => m.trend === "DECLINE" || m.trend === "STRONG_DECLINE").length;
  const latestNet = netIncome.values[netIncome.values.length - 1]?.value ?? null;
  const prevNet = netIncome.values[netIncome.values.length - 2]?.value ?? null;

  let overallTrend: TrendAnalysis["overallTrend"] = "STABLE";
  if (prevNet !== null && latestNet !== null && prevNet < 0 && latestNet > 0) overallTrend = "TURNAROUND";
  else if (growthCount >= 2) overallTrend = "EXPANDING";
  else if (declineCount >= 2) overallTrend = "CONTRACTING";
  else if (declineCount >= 1 && growthCount === 0) overallTrend = "DETERIORATING";

  const keyFindings: string[] = [];
  const growthDrivers: string[] = [];
  const concerns: string[] = [];

  for (const m of [revenue, ordinaryIncome, netIncome, eps]) {
    if (m.trend !== "INSUFFICIENT_DATA") keyFindings.push(m.summary);
  }
  if (revenue.trend === "GROWTH" || revenue.trend === "STRONG_GROWTH") growthDrivers.push("売上拡大");
  if (ordinaryIncome.cagr !== null && revenue.cagr !== null && ordinaryIncome.cagr > revenue.cagr + 3) {
    growthDrivers.push("利益率の改善（利益成長が売上成長を上回る）");
  }
  const latestRoe = roe.values[roe.values.length - 1]?.value ?? null;
  if (latestRoe !== null && latestRoe >= 15) growthDrivers.push(`高ROE（${latestRoe.toFixed(1)}%）`);

  if (netIncome.trend === "VOLATILE") concerns.push("純利益の変動が大きい（特別損益・減損等の確認を推奨）");
  for (const m of core) {
    if (m.trend === "DECLINE" || m.trend === "STRONG_DECLINE") concerns.push(m.summary);
  }
  if (roe.trend === "DECLINE") concerns.push("ROEが低下傾向");

  // 株式数の急変（分割・併合）があると過去EPSは比較不能
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1].sharesIssued;
    const b = history[i].sharesIssued;
    if (a && b && (b / a > 1.3 || a / b > 1.3)) {
      concerns.push(`${label(history[i], i)}に発行済株式数が大きく変化（株式分割・併合の可能性）。EPS推移は要注意`);
    }
  }

  const first = history[0]?.periodEnd?.substring(0, 7) ?? "?";
  const last = history[history.length - 1]?.periodEnd?.substring(0, 7) ?? "?";

  return {
    companyName,
    secCode,
    analysisPeriod: `${first}期〜${last}期（${history.length}期、有価証券報告書「主要な経営指標等の推移」）`,
    revenue,
    ordinaryIncome,
    netIncome,
    eps,
    totalAssets,
    roe,
    overallTrend,
    summary: {
      headline: `${companyName}は${
        overallTrend === "EXPANDING" ? "成長拡大" :
        overallTrend === "CONTRACTING" ? "縮小傾向" :
        overallTrend === "TURNAROUND" ? "黒字転換" :
        overallTrend === "DETERIORATING" ? "悪化傾向" : "安定推移"
      }`,
      keyFindings: keyFindings.length > 0 ? keyFindings : ["データ不足"],
      growthDrivers: growthDrivers.length > 0 ? growthDrivers : ["特筆すべき成長ドライバーなし"],
      concerns: concerns.length > 0 ? concerns : ["顕著な懸念なし"],
      outlook: overallTrend === "EXPANDING"
        ? "過去数期は成長基調。継続性は直近の四半期・会社予想で確認。"
        : overallTrend === "CONTRACTING" || overallTrend === "DETERIORATING"
        ? "業績改善の兆候を待つべき。"
        : overallTrend === "TURNAROUND"
        ? "黒字転換局面。利益の持続性を確認。"
        : "安定した業績。バリュエーション次第。",
    },
    tokenSaved: "~500,000 tokens (vs fetching 5 years of XBRL manually)",
  };
}

/**
 * %ポイントで動く指標（ROE等）のトレンド判定
 */
function determinePointTrend(values: number[]): TrendMetric["trend"] {
  if (values.length < 2) return "INSUFFICIENT_DATA";
  const diffs = values.slice(1).map((v, i) => v - values[i]);
  const total = values[values.length - 1] - values[0];
  const up = diffs.filter((d) => d > 0).length;
  const down = diffs.filter((d) => d < 0).length;
  if (Math.max(...diffs.map(Math.abs)) > 15 && up > 0 && down > 0) return "VOLATILE";
  if (total >= 5) return "GROWTH";
  if (total <= -5) return "DECLINE";
  return "STABLE";
}
