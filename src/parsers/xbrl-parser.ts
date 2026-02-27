/**
 * XBRL実パーサー
 * EDINETからダウンロードしたZIPファイルを解析
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { 
  FinancialStatements, 
  createEmptyFinancialStatements,
  calculateMetrics,
  generateSummary
} from "./xbrl.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

/**
 * XBRLタグから値を抽出するためのマッピング
 */
const VALUE_EXTRACTORS: Record<string, { path: string; field: keyof any }[]> = {
  // 損益計算書
  "jppfs_cor:NetSales": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:OperatingRevenue1": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:GrossProfit": [{ path: "incomeStatement", field: "grossProfit" }],
  "jppfs_cor:OperatingIncome": [{ path: "incomeStatement", field: "operatingIncome" }],
  "jppfs_cor:OrdinaryIncome": [{ path: "incomeStatement", field: "ordinaryIncome" }],
  "jppfs_cor:ProfitLoss": [{ path: "incomeStatement", field: "netIncome" }],
  "jppfs_cor:ProfitLossAttributableToOwnersOfParent": [{ path: "incomeStatement", field: "netIncome" }],
  
  // 貸借対照表
  "jppfs_cor:Assets": [{ path: "balanceSheet", field: "totalAssets" }],
  "jppfs_cor:CurrentAssets": [{ path: "balanceSheet", field: "currentAssets" }],
  "jppfs_cor:CashAndDeposits": [{ path: "balanceSheet", field: "cashAndDeposits" }],
  "jppfs_cor:NoncurrentAssets": [{ path: "balanceSheet", field: "nonCurrentAssets" }],
  "jppfs_cor:Liabilities": [{ path: "balanceSheet", field: "totalLiabilities" }],
  "jppfs_cor:CurrentLiabilities": [{ path: "balanceSheet", field: "currentLiabilities" }],
  "jppfs_cor:NoncurrentLiabilities": [{ path: "balanceSheet", field: "nonCurrentLiabilities" }],
  "jppfs_cor:NetAssets": [{ path: "balanceSheet", field: "netAssets" }],
  "jppfs_cor:ShareholdersEquity": [{ path: "balanceSheet", field: "shareholdersEquity" }],
  
  // キャッシュフロー
  "jppfs_cor:NetCashProvidedByUsedInOperatingActivities": [{ path: "cashFlow", field: "operatingCF" }],
  "jppfs_cor:NetCashProvidedByUsedInInvestingActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:NetCashProvidedByUsedInFinancingActivities": [{ path: "cashFlow", field: "financingCF" }],
};

/**
 * ZIPファイルからXBRLを解析
 */
export async function parseXbrlFromZip(zipBuffer: ArrayBuffer): Promise<FinancialStatements> {
  const fs = createEmptyFinancialStatements();
  
  try {
    const zip = await JSZip.loadAsync(zipBuffer);
    
    // XBRLファイルを探す（通常はXBRL/PublicDoc/以下）
    const xbrlFiles: string[] = [];
    zip.forEach((relativePath, file) => {
      if (relativePath.endsWith(".xbrl") || relativePath.endsWith(".xml")) {
        if (relativePath.includes("PublicDoc") || relativePath.includes("XBRL")) {
          xbrlFiles.push(relativePath);
        }
      }
    });

    if (xbrlFiles.length === 0) {
      console.error("No XBRL files found in ZIP");
      return fs;
    }

    // メインのXBRLファイルを解析
    for (const xbrlPath of xbrlFiles) {
      const file = zip.file(xbrlPath);
      if (!file) continue;

      const content = await file.async("string");
      const parsed = parser.parse(content);

      // XBRLのルート要素を探す
      const root = parsed["xbrli:xbrl"] || parsed["xbrl"] || parsed;
      if (!root) continue;

      // 各要素を解析
      for (const [tagName, extractors] of Object.entries(VALUE_EXTRACTORS)) {
        const shortTag = tagName.split(":")[1];
        const value = root[tagName] || root[shortTag];
        
        if (value !== undefined) {
          const numValue = extractNumericValue(value);
          if (numValue !== null) {
            for (const extractor of extractors) {
              const pathKey = extractor.path as "balanceSheet" | "incomeStatement" | "cashFlow";
              const target = fs[pathKey] as Record<string, number | null>;
              const fieldKey = extractor.field as string;
              if (target && target[fieldKey] === null) {
                target[fieldKey] = numValue;
              }
            }
          }
        }
      }

      // 会社名を取得
      const companyName = extractTextValue(root, ["jpdei_cor:FilerNameInJapaneseDEI", "FilerNameInJapaneseDEI"]);
      if (companyName) fs.companyName = companyName;

      // 証券コードを取得
      const secCode = extractTextValue(root, ["jpdei_cor:SecurityCodeDEI", "SecurityCodeDEI"]);
      if (secCode) fs.secCode = secCode;

      // 会計期間を取得
      const periodEnd = extractTextValue(root, ["jpdei_cor:CurrentFiscalYearEndDateDEI", "CurrentFiscalYearEndDateDEI"]);
      if (periodEnd) fs.fiscalYear = periodEnd.substring(0, 4);
    }

    // 指標を計算
    calculateMetrics(fs);
    
    // サマリーを生成
    generateSummary(fs);

  } catch (error) {
    console.error("Error parsing XBRL:", error);
  }

  return fs;
}

/**
 * 数値を抽出
 */
function extractNumericValue(value: any): number | null {
  if (typeof value === "number") {
    return value;
  }
  
  if (typeof value === "string") {
    const num = parseFloat(value.replace(/,/g, ""));
    return isNaN(num) ? null : num;
  }
  
  if (typeof value === "object") {
    // XBRL要素の場合、#textを取得
    const text = value["#text"] || value["_text"] || value["$"];
    if (text) {
      const num = parseFloat(String(text).replace(/,/g, ""));
      return isNaN(num) ? null : num;
    }
    
    // 配列の場合、最初の要素を使用
    if (Array.isArray(value) && value.length > 0) {
      return extractNumericValue(value[0]);
    }
  }
  
  return null;
}

/**
 * テキスト値を抽出
 */
function extractTextValue(root: any, possibleTags: string[]): string | null {
  for (const tag of possibleTags) {
    const value = root[tag];
    if (value) {
      if (typeof value === "string") return value;
      if (value["#text"]) return value["#text"];
      if (Array.isArray(value) && value.length > 0) {
        return typeof value[0] === "string" ? value[0] : value[0]["#text"];
      }
    }
  }
  return null;
}

/**
 * 財務データを整形して出力
 */
export function formatFinancialOutput(fs: FinancialStatements): object {
  // 金額を億円単位に変換するヘルパー
  const toOku = (val: number | null): string | null => {
    if (val === null) return null;
    return `${(val / 100000000).toFixed(1)}億円`;
  };

  return {
    company: {
      name: fs.companyName,
      secCode: fs.secCode,
      fiscalYear: fs.fiscalYear,
      reportType: fs.reportType,
    },
    
    incomeStatement: {
      revenue: toOku(fs.incomeStatement.revenue),
      operatingIncome: toOku(fs.incomeStatement.operatingIncome),
      ordinaryIncome: toOku(fs.incomeStatement.ordinaryIncome),
      netIncome: toOku(fs.incomeStatement.netIncome),
    },
    
    balanceSheet: {
      totalAssets: toOku(fs.balanceSheet.totalAssets),
      netAssets: toOku(fs.balanceSheet.netAssets),
      shareholdersEquity: toOku(fs.balanceSheet.shareholdersEquity),
    },
    
    cashFlow: {
      operatingCF: toOku(fs.cashFlow.operatingCF),
      investingCF: toOku(fs.cashFlow.investingCF),
      financingCF: toOku(fs.cashFlow.financingCF),
      freeCashFlow: toOku(fs.cashFlow.freeCashFlow),
    },
    
    metrics: {
      roe: fs.metrics.roe ? `${fs.metrics.roe}%` : null,
      roa: fs.metrics.roa ? `${fs.metrics.roa}%` : null,
      operatingMargin: fs.metrics.operatingMargin ? `${fs.metrics.operatingMargin}%` : null,
      netMargin: fs.metrics.netMargin ? `${fs.metrics.netMargin}%` : null,
      debtToEquity: fs.metrics.debtToEquity,
      currentRatio: fs.metrics.currentRatio,
    },
    
    aiSummary: fs.summary,
    
    rawData: fs, // 元データも含める
  };
}
