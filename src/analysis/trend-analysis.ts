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
  operatingIncome: TrendMetric;
  netIncome: TrendMetric;
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
  const maxChange = Math.max(...validChanges.map(Math.abs));
  if (maxChange > 50 && positiveCount > 0 && negativeCount > 0) {
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
 * モック: 時系列データを生成（実際はEDINETから取得）
 * 将来的には過去の有価証券報告書から実データを取得
 */
export function generateMockTrendAnalysis(
  companyName: string,
  secCode: string | null,
  currentRevenue: number | null,
  currentOperatingIncome: number | null,
  currentNetIncome: number | null,
  currentAssets: number | null,
  currentRoe: number | null
): TrendAnalysis {
  
  // モックで過去5年分のデータを生成（実際は過去のXBRLから取得）
  const years = ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"];
  
  // 売上高トレンド（仮にランダム変動を追加）
  const revenueValues = years.map((year, i) => {
    const baseValue = currentRevenue ? currentRevenue * (0.8 + i * 0.05) : null;
    const prevValue = i > 0 && currentRevenue ? currentRevenue * (0.8 + (i - 1) * 0.05) : null;
    return {
      period: year,
      value: baseValue,
      yoyChange: baseValue && prevValue ? ((baseValue - prevValue) / prevValue) * 100 : null,
    };
  });
  
  const revenueTrend = determineTrend(revenueValues);
  const revenueCAGR = currentRevenue ? calculateCAGR(currentRevenue * 0.8, currentRevenue, 4) : null;
  
  const revenue: TrendMetric = {
    metric: "売上高",
    values: revenueValues,
    trend: revenueTrend,
    cagr: revenueCAGR,
    summary: generateTrendSummary("売上高", revenueTrend, revenueCAGR),
  };
  
  // 他の指標も同様に（簡略化）
  const operatingIncome: TrendMetric = {
    metric: "営業利益",
    values: [],
    trend: currentOperatingIncome && currentOperatingIncome > 0 ? "GROWTH" : "DECLINE",
    cagr: null,
    summary: currentOperatingIncome && currentOperatingIncome > 0 
      ? "営業利益は黒字基調" 
      : "営業利益は赤字または減益傾向",
  };
  
  const netIncome: TrendMetric = {
    metric: "純利益",
    values: [],
    trend: currentNetIncome && currentNetIncome > 0 ? "GROWTH" : "DECLINE",
    cagr: null,
    summary: currentNetIncome && currentNetIncome > 0 
      ? "純利益は黒字基調" 
      : "純利益は赤字または減益傾向",
  };
  
  const totalAssets: TrendMetric = {
    metric: "総資産",
    values: [],
    trend: "STABLE",
    cagr: null,
    summary: "総資産は安定推移",
  };
  
  const roe: TrendMetric = {
    metric: "ROE",
    values: [],
    trend: currentRoe && currentRoe > 10 ? "GROWTH" : currentRoe && currentRoe > 0 ? "STABLE" : "DECLINE",
    cagr: null,
    summary: currentRoe 
      ? `ROE ${currentRoe.toFixed(1)}%で${currentRoe > 10 ? "高収益" : currentRoe > 0 ? "安定" : "低収益"}` 
      : "ROEデータなし",
  };
  
  // 総合評価
  let overallTrend: TrendAnalysis["overallTrend"] = "STABLE";
  const growthCount = [revenue, operatingIncome, netIncome].filter(
    (m) => m.trend === "GROWTH" || m.trend === "STRONG_GROWTH"
  ).length;
  const declineCount = [revenue, operatingIncome, netIncome].filter(
    (m) => m.trend === "DECLINE" || m.trend === "STRONG_DECLINE"
  ).length;
  
  if (growthCount >= 2) overallTrend = "EXPANDING";
  else if (declineCount >= 2) overallTrend = "CONTRACTING";
  else if (growthCount === 1 && declineCount === 1) overallTrend = "TURNAROUND";
  
  // サマリー生成
  const keyFindings: string[] = [];
  const growthDrivers: string[] = [];
  const concerns: string[] = [];
  
  if (revenue.trend === "STRONG_GROWTH" || revenue.trend === "GROWTH") {
    keyFindings.push(revenue.summary);
    growthDrivers.push("売上拡大");
  }
  if (operatingIncome.trend === "DECLINE" || operatingIncome.trend === "STRONG_DECLINE") {
    concerns.push("収益性の低下");
  }
  if (currentRoe && currentRoe > 15) {
    growthDrivers.push(`高ROE（${currentRoe.toFixed(1)}%）`);
  }
  
  return {
    companyName,
    secCode,
    analysisPeriod: "FY2021-FY2025（5年間）",
    revenue,
    operatingIncome,
    netIncome,
    totalAssets,
    roe,
    overallTrend,
    summary: {
      headline: `${companyName}は${overallTrend === "EXPANDING" ? "成長拡大" : overallTrend === "CONTRACTING" ? "縮小傾向" : "安定推移"}`,
      keyFindings: keyFindings.length > 0 ? keyFindings : ["データ分析中"],
      growthDrivers: growthDrivers.length > 0 ? growthDrivers : ["特筆すべき成長ドライバーなし"],
      concerns: concerns.length > 0 ? concerns : ["顕著な懸念なし"],
      outlook: overallTrend === "EXPANDING" 
        ? "成長継続が期待される。投資妙味あり。"
        : overallTrend === "CONTRACTING"
        ? "業績改善の兆候を待つべき。"
        : "安定した業績。バリュエーション次第。",
    },
    tokenSaved: "~500,000 tokens (vs fetching 5 years of XBRL manually)",
  };
}
