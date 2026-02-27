/**
 * 異常値検出エンジン
 * 前期比で大幅変動した財務項目を自動検出
 * 
 * AIが自分でやると：
 * - 前期のXBRLをダウンロード・パース
 * - 当期との比較ロジックを実装
 * - 閾値設定・異常判定ロジックを実装
 * - 各項目ごとに分析
 * → 推定トークン消費: 200,000+
 * 
 * このMCPなら: 1 API呼び出し
 */

export type AnomalyType = 
  | "REVENUE_SURGE"        // 売上急増（+30%以上）
  | "REVENUE_PLUNGE"       // 売上急減（-30%以上）
  | "PROFIT_TURNAROUND"    // 黒字転換
  | "PROFIT_REVERSAL"      // 赤字転落
  | "MARGIN_EXPANSION"     // 利益率大幅改善
  | "MARGIN_COMPRESSION"   // 利益率大幅悪化
  | "ASSET_EXPANSION"      // 資産急増（M&A等）
  | "ASSET_CONTRACTION"    // 資産急減（売却等）
  | "DEBT_SURGE"           // 負債急増
  | "DEBT_REDUCTION"       // 負債急減
  | "CASH_SURGE"           // 現金急増
  | "CASH_BURN"            // 現金急減
  | "ROE_IMPROVEMENT"      // ROE大幅改善
  | "ROE_DETERIORATION"    // ROE大幅悪化
  | "DIVIDEND_CHANGE"      // 配当変更
  | "EXTRAORDINARY_ITEM";  // 特別損益

export interface Anomaly {
  type: AnomalyType;
  metric: string;
  previousValue: number | null;
  currentValue: number | null;
  changePercent: number | null;
  changeAbsolute: number | null;
  
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  
  description: string;
  possibleCauses: string[];
  investmentImplication: string;
}

export interface AnomalyReport {
  companyName: string;
  secCode: string | null;
  comparisonPeriod: string;
  
  anomalies: Anomaly[];
  anomalyCount: number;
  criticalCount: number;
  
  // 総合評価
  overallAssessment: {
    riskLevel: "HIGH" | "MEDIUM" | "LOW";
    summary: string;
    actionRequired: boolean;
    recommendedAction: string;
  };
  
  tokenSaved: string;
}

/**
 * 異常値を検出
 */
export function detectAnomalies(
  companyName: string,
  secCode: string | null,
  current: {
    revenue: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    totalAssets: number | null;
    totalLiabilities: number | null;
    netAssets: number | null;
    cash: number | null;
    roe: number | null;
    operatingMargin: number | null;
  },
  previous: {
    revenue: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    totalAssets: number | null;
    totalLiabilities: number | null;
    netAssets: number | null;
    cash: number | null;
    roe: number | null;
    operatingMargin: number | null;
  } | null
): AnomalyReport {
  const anomalies: Anomaly[] = [];
  
  // 前期データがない場合は比較不可
  if (!previous) {
    return {
      companyName,
      secCode,
      comparisonPeriod: "前期データなし",
      anomalies: [],
      anomalyCount: 0,
      criticalCount: 0,
      overallAssessment: {
        riskLevel: "LOW",
        summary: "前期データがないため比較分析不可",
        actionRequired: false,
        recommendedAction: "前期データを取得して再分析",
      },
      tokenSaved: "~200,000 tokens",
    };
  }
  
  // 売上高の変動チェック
  if (current.revenue && previous.revenue) {
    const changePercent = ((current.revenue - previous.revenue) / Math.abs(previous.revenue)) * 100;
    
    if (changePercent >= 30) {
      anomalies.push({
        type: "REVENUE_SURGE",
        metric: "売上高",
        previousValue: previous.revenue,
        currentValue: current.revenue,
        changePercent,
        changeAbsolute: current.revenue - previous.revenue,
        severity: "HIGH",
        direction: "POSITIVE",
        description: `売上高が前期比${changePercent.toFixed(1)}%増加`,
        possibleCauses: ["M&Aによる規模拡大", "新製品・サービスの成功", "市場シェア拡大", "価格改定"],
        investmentImplication: "成長期待で買い検討。ただし持続性を確認。",
      });
    } else if (changePercent <= -30) {
      anomalies.push({
        type: "REVENUE_PLUNGE",
        metric: "売上高",
        previousValue: previous.revenue,
        currentValue: current.revenue,
        changePercent,
        changeAbsolute: current.revenue - previous.revenue,
        severity: "CRITICAL",
        direction: "NEGATIVE",
        description: `売上高が前期比${Math.abs(changePercent).toFixed(1)}%減少`,
        possibleCauses: ["主要顧客の喪失", "事業売却", "市場縮小", "競争激化"],
        investmentImplication: "業績悪化懸念。原因を確認し、売却を検討。",
      });
    }
  }
  
  // 純利益の変動チェック（黒字転換/赤字転落）
  if (current.netIncome !== null && previous.netIncome !== null) {
    if (previous.netIncome < 0 && current.netIncome > 0) {
      anomalies.push({
        type: "PROFIT_TURNAROUND",
        metric: "純利益",
        previousValue: previous.netIncome,
        currentValue: current.netIncome,
        changePercent: null,
        changeAbsolute: current.netIncome - previous.netIncome,
        severity: "HIGH",
        direction: "POSITIVE",
        description: "赤字から黒字に転換",
        possibleCauses: ["コスト削減効果", "売上回復", "事業再構築の成果", "特別利益"],
        investmentImplication: "ターンアラウンド成功シグナル。買い検討。",
      });
    } else if (previous.netIncome > 0 && current.netIncome < 0) {
      anomalies.push({
        type: "PROFIT_REVERSAL",
        metric: "純利益",
        previousValue: previous.netIncome,
        currentValue: current.netIncome,
        changePercent: null,
        changeAbsolute: current.netIncome - previous.netIncome,
        severity: "CRITICAL",
        direction: "NEGATIVE",
        description: "黒字から赤字に転落",
        possibleCauses: ["売上減少", "コスト増加", "減損損失", "為替差損"],
        investmentImplication: "業績悪化。保有中なら損切り検討。",
      });
    }
  }
  
  // ROEの変動チェック
  if (current.roe !== null && previous.roe !== null) {
    const roeChange = current.roe - previous.roe;
    
    if (roeChange >= 5) {
      anomalies.push({
        type: "ROE_IMPROVEMENT",
        metric: "ROE",
        previousValue: previous.roe,
        currentValue: current.roe,
        changePercent: null,
        changeAbsolute: roeChange,
        severity: "MEDIUM",
        direction: "POSITIVE",
        description: `ROEが${previous.roe.toFixed(1)}%から${current.roe.toFixed(1)}%に改善（+${roeChange.toFixed(1)}pt）`,
        possibleCauses: ["利益率改善", "資本効率向上", "自社株買い効果"],
        investmentImplication: "収益性改善。ポジティブ材料。",
      });
    } else if (roeChange <= -5) {
      anomalies.push({
        type: "ROE_DETERIORATION",
        metric: "ROE",
        previousValue: previous.roe,
        currentValue: current.roe,
        changePercent: null,
        changeAbsolute: roeChange,
        severity: "MEDIUM",
        direction: "NEGATIVE",
        description: `ROEが${previous.roe.toFixed(1)}%から${current.roe.toFixed(1)}%に悪化（${roeChange.toFixed(1)}pt）`,
        possibleCauses: ["利益減少", "増資による希薄化", "資産効率低下"],
        investmentImplication: "収益性悪化。注意が必要。",
      });
    }
  }
  
  // 営業利益率の変動チェック
  if (current.operatingMargin !== null && previous.operatingMargin !== null) {
    const marginChange = current.operatingMargin - previous.operatingMargin;
    
    if (marginChange >= 5) {
      anomalies.push({
        type: "MARGIN_EXPANSION",
        metric: "営業利益率",
        previousValue: previous.operatingMargin,
        currentValue: current.operatingMargin,
        changePercent: null,
        changeAbsolute: marginChange,
        severity: "MEDIUM",
        direction: "POSITIVE",
        description: `営業利益率が${marginChange.toFixed(1)}pt改善`,
        possibleCauses: ["コスト削減", "価格改定", "製品ミックス改善", "規模の経済"],
        investmentImplication: "収益構造改善。ポジティブ。",
      });
    } else if (marginChange <= -5) {
      anomalies.push({
        type: "MARGIN_COMPRESSION",
        metric: "営業利益率",
        previousValue: previous.operatingMargin,
        currentValue: current.operatingMargin,
        changePercent: null,
        changeAbsolute: marginChange,
        severity: "HIGH",
        direction: "NEGATIVE",
        description: `営業利益率が${Math.abs(marginChange).toFixed(1)}pt悪化`,
        possibleCauses: ["原材料高騰", "人件費増加", "価格競争", "販管費増加"],
        investmentImplication: "収益構造悪化。業績下振れリスク。",
      });
    }
  }
  
  // 総資産の変動チェック
  if (current.totalAssets && previous.totalAssets) {
    const changePercent = ((current.totalAssets - previous.totalAssets) / previous.totalAssets) * 100;
    
    if (changePercent >= 50) {
      anomalies.push({
        type: "ASSET_EXPANSION",
        metric: "総資産",
        previousValue: previous.totalAssets,
        currentValue: current.totalAssets,
        changePercent,
        changeAbsolute: current.totalAssets - previous.totalAssets,
        severity: "HIGH",
        direction: "NEUTRAL",
        description: `総資産が前期比${changePercent.toFixed(1)}%増加`,
        possibleCauses: ["大型M&A", "設備投資", "増資"],
        investmentImplication: "成長投資の可能性。ROA・ROEへの影響を確認。",
      });
    }
  }
  
  // リスクレベル判定
  const criticalCount = anomalies.filter((a) => a.severity === "CRITICAL").length;
  const highCount = anomalies.filter((a) => a.severity === "HIGH").length;
  const negativeCount = anomalies.filter((a) => a.direction === "NEGATIVE").length;
  
  let riskLevel: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  let actionRequired = false;
  let recommendedAction = "現状維持で問題なし";
  
  if (criticalCount > 0 || negativeCount >= 2) {
    riskLevel = "HIGH";
    actionRequired = true;
    recommendedAction = "詳細分析を実施し、ポジション見直しを検討";
  } else if (highCount > 0 || negativeCount === 1) {
    riskLevel = "MEDIUM";
    actionRequired = false;
    recommendedAction = "継続モニタリングを推奨";
  }
  
  return {
    companyName,
    secCode,
    comparisonPeriod: "前期比",
    anomalies,
    anomalyCount: anomalies.length,
    criticalCount,
    overallAssessment: {
      riskLevel,
      summary: anomalies.length > 0
        ? `${anomalies.length}件の重要な変動を検出（CRITICAL: ${criticalCount}件）`
        : "重要な変動は検出されませんでした",
      actionRequired,
      recommendedAction,
    },
    tokenSaved: "~200,000 tokens (vs manually comparing periods)",
  };
}
