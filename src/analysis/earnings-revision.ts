/**
 * 業績予想修正検出エンジン
 * 上方修正・下方修正を自動検出し、投資判断に直結する情報を抽出
 */

export interface EarningsRevision {
  // 基本情報
  companyName: string;
  secCode: string | null;
  docId: string;
  submitDate: string;
  
  // 修正タイプ
  revisionType: "UPWARD" | "DOWNWARD" | "UNCHANGED";
  
  // 修正内容
  revisions: {
    item: string; // 売上高、営業利益、経常利益、純利益など
    previous: number | null;
    revised: number | null;
    changeAmount: number | null;
    changePercent: number | null;
    direction: "UP" | "DOWN" | "UNCHANGED";
  }[];
  
  // 修正理由
  reason: string;
  
  // 配当修正
  dividendRevision: {
    previous: number | null;
    revised: number | null;
    changePercent: number | null;
  } | null;
  
  // AIサマリー
  summary: {
    headline: string;
    impact: "VERY_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "VERY_NEGATIVE";
    keyPoints: string[];
    tradingImplication: string;
  };
  
  // メタ
  meta: {
    fiscalYear: string;
    fiscalPeriod: string;
    announcementTiming: "BEFORE_MARKET" | "DURING_MARKET" | "AFTER_MARKET";
  };
}

/**
 * 修正報告書から業績修正を検出
 */
export function detectEarningsRevision(
  docDescription: string,
  filerName: string,
  secCode: string | null,
  docId: string,
  submitDateTime: string
): EarningsRevision | null {
  
  // 業績予想修正に関連する書類かチェック
  const isRevisionDoc = 
    docDescription.includes("業績予想の修正") ||
    docDescription.includes("配当予想の修正") ||
    docDescription.includes("通期業績予想") ||
    docDescription.includes("四半期業績予想");
  
  if (!isRevisionDoc) {
    return null;
  }
  
  // 修正方向を判定
  let revisionType: "UPWARD" | "DOWNWARD" | "UNCHANGED" = "UNCHANGED";
  let impact: "VERY_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "VERY_NEGATIVE" = "NEUTRAL";
  let headline = "";
  let tradingImplication = "";
  
  if (docDescription.includes("上方修正") || docDescription.includes("増額")) {
    revisionType = "UPWARD";
    impact = "POSITIVE";
    headline = `${filerName}が業績予想を上方修正`;
    tradingImplication = "株価上昇要因。寄り付き前なら買い検討。";
  } else if (docDescription.includes("下方修正") || docDescription.includes("減額")) {
    revisionType = "DOWNWARD";
    impact = "NEGATIVE";
    headline = `${filerName}が業績予想を下方修正`;
    tradingImplication = "株価下落要因。保有中なら損切り検討。";
  } else if (docDescription.includes("配当")) {
    if (docDescription.includes("増配")) {
      revisionType = "UPWARD";
      impact = "POSITIVE";
      headline = `${filerName}が増配を発表`;
      tradingImplication = "株主還元強化。中長期保有に好材料。";
    } else if (docDescription.includes("減配")) {
      revisionType = "DOWNWARD";
      impact = "NEGATIVE";
      headline = `${filerName}が減配を発表`;
      tradingImplication = "業績悪化シグナル。売却検討。";
    }
  }
  
  // 発表タイミング判定
  const submitHour = new Date(submitDateTime).getHours();
  let announcementTiming: "BEFORE_MARKET" | "DURING_MARKET" | "AFTER_MARKET";
  if (submitHour < 9) {
    announcementTiming = "BEFORE_MARKET";
  } else if (submitHour < 15) {
    announcementTiming = "DURING_MARKET";
  } else {
    announcementTiming = "AFTER_MARKET";
  }
  
  return {
    companyName: filerName,
    secCode,
    docId,
    submitDate: submitDateTime,
    revisionType,
    revisions: [], // XBRLから詳細を取得する場合に使用
    reason: "詳細は開示書類を参照",
    dividendRevision: null,
    summary: {
      headline,
      impact,
      keyPoints: [
        `発表タイミング: ${announcementTiming === "BEFORE_MARKET" ? "寄り前" : announcementTiming === "AFTER_MARKET" ? "引け後" : "場中"}`,
        `書類: ${docDescription}`,
      ],
      tradingImplication,
    },
    meta: {
      fiscalYear: "",
      fiscalPeriod: "",
      announcementTiming,
    },
  };
}

/**
 * 日次の業績修正をスキャン
 */
export function scanDailyRevisions(
  documents: Array<{
    docDescription: string;
    filerName: string;
    secCode: string | null;
    docID: string;
    submitDateTime: string;
    docTypeCode: string;
  }>
): EarningsRevision[] {
  const revisions: EarningsRevision[] = [];
  
  for (const doc of documents) {
    // 臨時報告書（180）をチェック
    if (doc.docTypeCode === "180" || doc.docTypeCode === "190") {
      const revision = detectEarningsRevision(
        doc.docDescription,
        doc.filerName,
        doc.secCode,
        doc.docID,
        doc.submitDateTime
      );
      if (revision) {
        revisions.push(revision);
      }
    }
  }
  
  // インパクト順にソート（VERY_NEGATIVE/VERY_POSITIVE を優先）
  revisions.sort((a, b) => {
    const impactOrder = {
      "VERY_NEGATIVE": 0,
      "VERY_POSITIVE": 1,
      "NEGATIVE": 2,
      "POSITIVE": 3,
      "NEUTRAL": 4,
    };
    return impactOrder[a.summary.impact] - impactOrder[b.summary.impact];
  });
  
  return revisions;
}
