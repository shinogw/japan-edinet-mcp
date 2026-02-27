/**
 * 臨時報告書（重要事実）検出エンジン
 * M&A、代表者異動、訴訟、災害等の重要事実を自動検出
 */

export type MaterialEventType = 
  | "MA_ACQUISITION"      // M&A（買収）
  | "MA_MERGER"           // M&A（合併）
  | "MA_DIVESTITURE"      // 事業売却
  | "MANAGEMENT_CHANGE"   // 代表者異動
  | "LAWSUIT"             // 訴訟
  | "DISASTER"            // 災害
  | "DIVIDEND"            // 配当
  | "SHARE_BUYBACK"       // 自社株買い
  | "CAPITAL_INCREASE"    // 増資
  | "STOCK_SPLIT"         // 株式分割
  | "DELISTING"           // 上場廃止
  | "SUBSIDIARY"          // 子会社関連
  | "BUSINESS_ALLIANCE"   // 業務提携
  | "NEW_PRODUCT"         // 新製品・新サービス
  | "REGULATORY"          // 規制・行政処分
  | "OTHER";              // その他

export interface MaterialEvent {
  // 基本情報
  companyName: string;
  secCode: string | null;
  docId: string;
  submitDate: string;
  
  // イベント情報
  eventType: MaterialEventType;
  eventTitle: string;
  
  // 影響分析
  impact: {
    level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNCERTAIN";
    estimatedPriceImpact: string;
  };
  
  // AIサマリー
  summary: {
    headline: string;
    keyPoints: string[];
    tradingImplication: string;
    timeframe: "IMMEDIATE" | "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM";
  };
}

/**
 * イベントタイプを判定するキーワードマッピング
 */
const EVENT_KEYWORDS: Record<MaterialEventType, string[]> = {
  "MA_ACQUISITION": ["買収", "取得", "子会社化", "株式取得", "TOB", "公開買付"],
  "MA_MERGER": ["合併", "経営統合", "吸収合併"],
  "MA_DIVESTITURE": ["売却", "譲渡", "事業譲渡", "株式譲渡"],
  "MANAGEMENT_CHANGE": ["代表取締役", "社長", "CEO", "異動", "退任", "就任", "辞任"],
  "LAWSUIT": ["訴訟", "提訴", "判決", "和解", "賠償"],
  "DISASTER": ["災害", "地震", "火災", "事故", "被害"],
  "DIVIDEND": ["配当", "増配", "減配", "無配", "復配", "記念配当"],
  "SHARE_BUYBACK": ["自己株式", "自社株買", "取得枠"],
  "CAPITAL_INCREASE": ["増資", "新株", "第三者割当", "公募"],
  "STOCK_SPLIT": ["株式分割", "併合"],
  "DELISTING": ["上場廃止", "非公開化", "MBO"],
  "SUBSIDIARY": ["子会社", "関連会社", "グループ会社"],
  "BUSINESS_ALLIANCE": ["提携", "アライアンス", "協業", "共同開発"],
  "NEW_PRODUCT": ["新製品", "新サービス", "新規事業", "ローンチ"],
  "REGULATORY": ["行政処分", "業務停止", "課徴金", "是正勧告"],
  "OTHER": [],
};

/**
 * イベントタイプごとの影響評価
 */
const EVENT_IMPACT: Record<MaterialEventType, {
  level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  defaultDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNCERTAIN";
  priceImpact: string;
  timeframe: "IMMEDIATE" | "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM";
}> = {
  "MA_ACQUISITION": { level: "HIGH", defaultDirection: "UNCERTAIN", priceImpact: "±5-20%", timeframe: "IMMEDIATE" },
  "MA_MERGER": { level: "CRITICAL", defaultDirection: "UNCERTAIN", priceImpact: "±10-30%", timeframe: "IMMEDIATE" },
  "MA_DIVESTITURE": { level: "HIGH", defaultDirection: "UNCERTAIN", priceImpact: "±5-15%", timeframe: "SHORT_TERM" },
  "MANAGEMENT_CHANGE": { level: "MEDIUM", defaultDirection: "UNCERTAIN", priceImpact: "±2-10%", timeframe: "SHORT_TERM" },
  "LAWSUIT": { level: "HIGH", defaultDirection: "NEGATIVE", priceImpact: "-5-20%", timeframe: "IMMEDIATE" },
  "DISASTER": { level: "HIGH", defaultDirection: "NEGATIVE", priceImpact: "-5-30%", timeframe: "IMMEDIATE" },
  "DIVIDEND": { level: "MEDIUM", defaultDirection: "POSITIVE", priceImpact: "±2-5%", timeframe: "SHORT_TERM" },
  "SHARE_BUYBACK": { level: "MEDIUM", defaultDirection: "POSITIVE", priceImpact: "+2-10%", timeframe: "SHORT_TERM" },
  "CAPITAL_INCREASE": { level: "HIGH", defaultDirection: "NEGATIVE", priceImpact: "-5-15% (希薄化)", timeframe: "IMMEDIATE" },
  "STOCK_SPLIT": { level: "LOW", defaultDirection: "NEUTRAL", priceImpact: "±1-3%", timeframe: "SHORT_TERM" },
  "DELISTING": { level: "CRITICAL", defaultDirection: "UNCERTAIN", priceImpact: "TOB価格に収束", timeframe: "IMMEDIATE" },
  "SUBSIDIARY": { level: "MEDIUM", defaultDirection: "UNCERTAIN", priceImpact: "±3-10%", timeframe: "SHORT_TERM" },
  "BUSINESS_ALLIANCE": { level: "MEDIUM", defaultDirection: "POSITIVE", priceImpact: "+2-10%", timeframe: "SHORT_TERM" },
  "NEW_PRODUCT": { level: "LOW", defaultDirection: "POSITIVE", priceImpact: "+1-5%", timeframe: "MEDIUM_TERM" },
  "REGULATORY": { level: "HIGH", defaultDirection: "NEGATIVE", priceImpact: "-5-20%", timeframe: "IMMEDIATE" },
  "OTHER": { level: "LOW", defaultDirection: "NEUTRAL", priceImpact: "±1-3%", timeframe: "SHORT_TERM" },
};

/**
 * 臨時報告書から重要事実を検出
 */
export function detectMaterialEvent(
  docDescription: string,
  filerName: string,
  secCode: string | null,
  docId: string,
  submitDateTime: string
): MaterialEvent | null {
  
  // イベントタイプを判定
  let eventType: MaterialEventType = "OTHER";
  let matchedKeywords: string[] = [];
  
  for (const [type, keywords] of Object.entries(EVENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (docDescription.includes(keyword)) {
        eventType = type as MaterialEventType;
        matchedKeywords.push(keyword);
        break;
      }
    }
    if (eventType !== "OTHER") break;
  }
  
  // OTHERで特に重要でなければスキップ
  if (eventType === "OTHER" && !docDescription.includes("重要")) {
    return null;
  }
  
  const impactInfo = EVENT_IMPACT[eventType];
  
  // トレーディング含意を生成
  let tradingImplication = "";
  switch (eventType) {
    case "MA_ACQUISITION":
    case "MA_MERGER":
      tradingImplication = "M&A発表は株価に大きく影響。詳細確認後に判断を。";
      break;
    case "MANAGEMENT_CHANGE":
      tradingImplication = "経営陣変更は中長期の企業価値に影響。新経営陣の実績を確認。";
      break;
    case "LAWSUIT":
      tradingImplication = "訴訟リスクは不確実性要因。賠償額・勝訴確率を確認。";
      break;
    case "SHARE_BUYBACK":
      tradingImplication = "自社株買いは株主還元シグナル。買付期間・規模を確認。";
      break;
    case "CAPITAL_INCREASE":
      tradingImplication = "増資は短期的に株価下落要因（希薄化）。資金使途を確認。";
      break;
    case "DELISTING":
      tradingImplication = "上場廃止・MBOは買付価格に収束。プレミアムを確認。";
      break;
    default:
      tradingImplication = "詳細を確認して判断を。";
  }
  
  return {
    companyName: filerName,
    secCode,
    docId,
    submitDate: submitDateTime,
    eventType,
    eventTitle: docDescription,
    impact: {
      level: impactInfo.level,
      direction: impactInfo.defaultDirection,
      estimatedPriceImpact: impactInfo.priceImpact,
    },
    summary: {
      headline: `${filerName}: ${matchedKeywords.join("・") || eventType}`,
      keyPoints: [
        `イベント種別: ${eventType}`,
        `影響度: ${impactInfo.level}`,
        `想定株価影響: ${impactInfo.priceImpact}`,
      ],
      tradingImplication,
      timeframe: impactInfo.timeframe,
    },
  };
}

/**
 * 日次の重要事実をスキャン
 */
export function scanDailyMaterialEvents(
  documents: Array<{
    docDescription: string;
    filerName: string;
    secCode: string | null;
    docID: string;
    submitDateTime: string;
    docTypeCode: string;
  }>
): MaterialEvent[] {
  const events: MaterialEvent[] = [];
  
  for (const doc of documents) {
    // 臨時報告書（180, 190）をチェック
    if (doc.docTypeCode === "180" || doc.docTypeCode === "190") {
      const event = detectMaterialEvent(
        doc.docDescription,
        doc.filerName,
        doc.secCode,
        doc.docID,
        doc.submitDateTime
      );
      if (event) {
        events.push(event);
      }
    }
  }
  
  // 影響度順にソート（CRITICAL > HIGH > MEDIUM > LOW）
  const levelOrder = { "CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3 };
  events.sort((a, b) => levelOrder[a.impact.level] - levelOrder[b.impact.level]);
  
  return events;
}
