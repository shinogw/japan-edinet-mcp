/**
 * 大量保有報告書検出エンジン
 * 5%ルール（大量保有報告制度）に基づく報告を検出
 */

export interface LargeShareholderReport {
  // 基本情報
  targetCompany: string;
  targetSecCode: string | null;
  docId: string;
  submitDate: string;
  
  // 保有者情報
  holder: {
    name: string;
    type: "INDIVIDUAL" | "INSTITUTION" | "FUND" | "CORPORATE" | "UNKNOWN";
  };
  
  // 保有状況
  holding: {
    previousRatio: number | null;
    currentRatio: number | null;
    changeRatio: number | null;
    shares: number | null;
  };
  
  // 報告種類
  reportType: "INITIAL" | "CHANGE" | "CORRECTION";
  
  // 保有目的
  purpose: {
    stated: string;
    category: "PURE_INVESTMENT" | "POLICY_HOLDING" | "MANAGEMENT_PARTICIPATION" | "ACTIVIST" | "UNKNOWN";
  };
  
  // AIサマリー
  summary: {
    headline: string;
    signal: "BULLISH" | "BEARISH" | "NEUTRAL" | "WATCH";
    keyPoints: string[];
    tradingImplication: string;
  };
}

/**
 * 大量保有報告書を解析
 */
export function detectLargeShareholderReport(
  docDescription: string,
  filerName: string,
  subjectCompany: string | null,
  secCode: string | null,
  docId: string,
  submitDateTime: string,
  docTypeCode: string
): LargeShareholderReport | null {
  
  // 大量保有報告書かチェック（docTypeCode: 350=大量保有, 360=変更報告）
  if (docTypeCode !== "350" && docTypeCode !== "360") {
    return null;
  }
  
  // 報告種類を判定
  let reportType: "INITIAL" | "CHANGE" | "CORRECTION" = "CHANGE";
  if (docTypeCode === "350" && !docDescription.includes("変更")) {
    reportType = "INITIAL";
  }
  if (docDescription.includes("訂正")) {
    reportType = "CORRECTION";
  }
  
  // 保有者タイプを推定
  let holderType: "INDIVIDUAL" | "INSTITUTION" | "FUND" | "CORPORATE" | "UNKNOWN" = "UNKNOWN";
  const filerLower = filerName.toLowerCase();
  
  if (filerName.includes("ファンド") || filerName.includes("投資") || 
      filerLower.includes("fund") || filerLower.includes("capital") ||
      filerLower.includes("partners") || filerLower.includes("management")) {
    holderType = "FUND";
  } else if (filerName.includes("銀行") || filerName.includes("信託") ||
             filerName.includes("証券") || filerName.includes("保険") ||
             filerName.includes("アセット")) {
    holderType = "INSTITUTION";
  } else if (filerName.includes("株式会社") || filerName.includes("有限会社")) {
    holderType = "CORPORATE";
  }
  
  // シグナルと含意を生成
  let signal: "BULLISH" | "BEARISH" | "NEUTRAL" | "WATCH" = "WATCH";
  let headline = "";
  let tradingImplication = "";
  const keyPoints: string[] = [];
  
  if (reportType === "INITIAL") {
    signal = "WATCH";
    headline = `${filerName}が${subjectCompany || "対象企業"}の株式を5%以上取得`;
    tradingImplication = "新規の大株主出現。今後の動向を注視。";
    keyPoints.push("新規の5%以上保有者として登場");
  } else {
    headline = `${filerName}が${subjectCompany || "対象企業"}の保有比率を変更`;
    tradingImplication = "保有比率の変動を確認。目的の変更がないかチェック。";
  }
  
  // 有名アクティビストかチェック
  const knownActivists = [
    "オアシス", "エフィッシモ", "ストラテジック", "村上", "旧村上",
    "シルチェスター", "ダルトン", "バリューアクト", "サード・ポイント"
  ];
  
  for (const activist of knownActivists) {
    if (filerName.includes(activist)) {
      signal = "BULLISH";
      keyPoints.push(`⚠️ 有名アクティビスト（${activist}系）の動き`);
      tradingImplication = "アクティビスト介入の可能性。株主還元強化や経営改革期待で株価上昇要因。";
      break;
    }
  }
  
  // 機関投資家の場合
  if (holderType === "INSTITUTION") {
    keyPoints.push("機関投資家による保有");
  }
  
  keyPoints.push(`報告種類: ${reportType === "INITIAL" ? "新規" : reportType === "CHANGE" ? "変更" : "訂正"}`);
  
  return {
    targetCompany: subjectCompany || "不明",
    targetSecCode: secCode,
    docId,
    submitDate: submitDateTime,
    holder: {
      name: filerName,
      type: holderType,
    },
    holding: {
      previousRatio: null,
      currentRatio: null,
      changeRatio: null,
      shares: null,
    },
    reportType,
    purpose: {
      stated: "開示書類を参照",
      category: "UNKNOWN",
    },
    summary: {
      headline,
      signal,
      keyPoints,
      tradingImplication,
    },
  };
}

/**
 * 日次の大量保有報告をスキャン
 */
export function scanDailyLargeShareholderReports(
  documents: Array<{
    docDescription: string;
    filerName: string;
    secCode: string | null;
    docID: string;
    submitDateTime: string;
    docTypeCode: string;
    subjectEdinetCode: string | null;
  }>
): LargeShareholderReport[] {
  const reports: LargeShareholderReport[] = [];
  
  for (const doc of documents) {
    const report = detectLargeShareholderReport(
      doc.docDescription,
      doc.filerName,
      null, // subjectCompanyは別途取得が必要
      doc.secCode,
      doc.docID,
      doc.submitDateTime,
      doc.docTypeCode
    );
    if (report) {
      reports.push(report);
    }
  }
  
  // シグナル順にソート（BULLISH優先）
  reports.sort((a, b) => {
    const signalOrder = { "BULLISH": 0, "WATCH": 1, "NEUTRAL": 2, "BEARISH": 3 };
    return signalOrder[a.summary.signal] - signalOrder[b.summary.signal];
  });
  
  return reports;
}
