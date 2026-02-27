#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";

import { getEdinetClient, Document } from "./api/edinet.js";
import { 
  FinancialStatements, 
  createEmptyFinancialStatements, 
  calculateMetrics, 
  generateSummary 
} from "./parsers/xbrl.js";
import { parseXbrlFromZip, formatFinancialOutput } from "./parsers/xbrl-parser.js";
import { generateInvestmentRecommendation, InvestmentRecommendation } from "./analysis/investment-recommendation.js";
import { scanDailyRevisions, EarningsRevision } from "./analysis/earnings-revision.js";
import { scanDailyLargeShareholderReports, LargeShareholderReport } from "./analysis/large-shareholder.js";

// Load environment variables
config();

// Create server instance
const server = new Server(
  {
    name: "japan-edinet-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Document type mapping
const DOC_TYPE_MAP: Record<string, string> = {
  "120": "有価証券報告書",
  "130": "訂正有価証券報告書",
  "140": "四半期報告書",
  "150": "訂正四半期報告書",
  "160": "半期報告書",
  "170": "訂正半期報告書",
  "180": "臨時報告書",
  "190": "訂正臨時報告書",
  "030": "有価証券届出書",
  "040": "訂正有価証券届出書",
  "350": "大量保有報告書",
  "360": "訂正大量保有報告書",
};

// Helper function to format document
function formatDocument(doc: Document): object {
  return {
    docId: doc.docID,
    filerName: doc.filerName,
    secCode: doc.secCode,
    edinetCode: doc.edinetCode,
    docType: DOC_TYPE_MAP[doc.docTypeCode] || doc.docDescription,
    docDescription: doc.docDescription,
    submitDateTime: doc.submitDateTime,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    hasXbrl: doc.xbrlFlag === "1",
    hasPdf: doc.pdfFlag === "1",
    hasCsv: doc.csvFlag === "1",
  };
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "health_check",
        description: "サーバーの稼働状況とEDINET API接続を確認します",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_daily_filings",
        description: "指定日に提出された開示書類の一覧を取得します",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "取得する日付（YYYY-MM-DD形式）。指定しない場合は前営業日",
            },
            docType: {
              type: "string",
              description: "書類タイプでフィルタ（例: 有価証券報告書、四半期報告書）",
            },
          },
          required: [],
        },
      },
      {
        name: "get_company_filings",
        description: "特定企業の開示書類を検索します。証券コードまたはEDINETコードで検索可能",
        inputSchema: {
          type: "object",
          properties: {
            secCode: {
              type: "string",
              description: "証券コード（4桁、例: 7203）",
            },
            edinetCode: {
              type: "string",
              description: "EDINETコード（例: E02144）",
            },
            companyName: {
              type: "string",
              description: "企業名（部分一致検索）",
            },
            fromDate: {
              type: "string",
              description: "検索開始日（YYYY-MM-DD形式）",
            },
            toDate: {
              type: "string",
              description: "検索終了日（YYYY-MM-DD形式）",
            },
          },
          required: [],
        },
      },
      {
        name: "search_disclosures",
        description: "開示書類をキーワードや条件で検索します",
        inputSchema: {
          type: "object",
          properties: {
            keyword: {
              type: "string",
              description: "企業名や書類名で検索するキーワード",
            },
            docType: {
              type: "string",
              description: "書類タイプ（有価証券報告書、四半期報告書、臨時報告書など）",
            },
            fromDate: {
              type: "string",
              description: "検索開始日（YYYY-MM-DD形式）",
            },
            toDate: {
              type: "string",
              description: "検索終了日（YYYY-MM-DD形式）",
            },
            limit: {
              type: "number",
              description: "取得件数上限（デフォルト: 50）",
            },
          },
          required: [],
        },
      },
      {
        name: "analyze_financials",
        description: "企業の財務諸表を分析し、投資判断に役立つ情報を提供します。BS/PL/CFの主要指標、ROE/ROA等の収益性指標、リスク分析、AI向けサマリーを生成します。",
        inputSchema: {
          type: "object",
          properties: {
            secCode: {
              type: "string",
              description: "証券コード（4桁、例: 7203）",
            },
            companyName: {
              type: "string",
              description: "企業名（部分一致検索）",
            },
            period: {
              type: "string",
              description: "分析期間（latest=最新、annual=通期、quarterly=四半期）",
            },
          },
          required: [],
        },
      },
      {
        name: "compare_companies",
        description: "複数企業の財務指標を比較分析します。同業他社比較や投資判断に活用できます。",
        inputSchema: {
          type: "object",
          properties: {
            secCodes: {
              type: "array",
              items: { type: "string" },
              description: "比較する証券コードの配列（例: [\"7203\", \"7267\", \"7201\"]）",
            },
            metrics: {
              type: "array",
              items: { type: "string" },
              description: "比較する指標（例: [\"roe\", \"operatingMargin\", \"revenue\"]）",
            },
          },
          required: ["secCodes"],
        },
      },
      {
        name: "get_investment_recommendation",
        description: "【投資助言業登録に基づく】企業の財務データを分析し、投資推奨レーティング（STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL）を生成します。ROE・ROA・営業利益率・D/Eレシオ等を総合評価し、法的根拠付きの投資判断を提供します。AIエージェントが自分で分析すると約50,000トークン消費しますが、このMCPなら1回のAPI呼び出しで完了します。",
        inputSchema: {
          type: "object",
          properties: {
            secCode: {
              type: "string",
              description: "証券コード（4桁、例: 7203）",
            },
            companyName: {
              type: "string",
              description: "企業名（部分一致検索）",
            },
          },
          required: [],
        },
      },
      {
        name: "detect_earnings_revisions",
        description: "【株価に直接影響】指定日の業績予想修正（上方修正・下方修正）を検出します。修正方向、発表タイミング（寄り前/場中/引け後）、トレーディング含意を自動分析。AIエージェントが全開示書類を読むと100万トークン以上消費しますが、このMCPなら重要な修正のみ抽出します。",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "検出する日付（YYYY-MM-DD形式）。指定しない場合は今日",
            },
          },
          required: [],
        },
      },
      {
        name: "detect_large_shareholders",
        description: "【アクティビスト検出】指定日の大量保有報告書（5%ルール）を検出します。有名アクティビスト（オアシス、エフィッシモ等）の動きを自動識別し、投資シグナルを生成。新規の大株主出現や保有比率変更をリアルタイムで把握できます。",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "検出する日付（YYYY-MM-DD形式）。指定しない場合は今日",
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const client = getEdinetClient();

    switch (name) {
      case "health_check": {
        // Test API connection with today's date
        const today = new Date().toISOString().split("T")[0];
        const response = await client.getDocumentList({ date: today, type: "1" });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ok",
                server: "japan-edinet-mcp",
                version: "0.1.0",
                edinetApiStatus: response.metadata.status,
                edinetMessage: response.metadata.message,
                timestamp: new Date().toISOString(),
              }, null, 2),
            },
          ],
        };
      }

      case "get_daily_filings": {
        const { date, docType } = args as { date?: string; docType?: string };
        
        // Default to yesterday if no date specified
        const targetDate = date || (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          return d.toISOString().split("T")[0];
        })();

        const response = await client.getDocumentList({ date: targetDate, type: "2" });
        
        let results = response.results;
        
        // Filter by document type if specified
        if (docType) {
          results = results.filter(
            (doc) => 
              doc.docDescription.includes(docType) ||
              (DOC_TYPE_MAP[doc.docTypeCode] && DOC_TYPE_MAP[doc.docTypeCode].includes(docType))
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                date: targetDate,
                totalCount: response.metadata.resultset.count,
                filteredCount: results.length,
                documents: results.slice(0, 100).map(formatDocument),
              }, null, 2),
            },
          ],
        };
      }

      case "get_company_filings": {
        const { secCode, edinetCode, companyName, fromDate, toDate } = args as {
          secCode?: string;
          edinetCode?: string;
          companyName?: string;
          fromDate?: string;
          toDate?: string;
        };

        // Default date range: last 30 days
        const endDate = toDate || new Date().toISOString().split("T")[0];
        const startDate = fromDate || (() => {
          const d = new Date();
          d.setDate(d.getDate() - 30);
          return d.toISOString().split("T")[0];
        })();

        // Search by secCode or edinetCode
        let results: Document[] = [];
        
        if (secCode) {
          results = await client.searchBySecCode(secCode, startDate, endDate);
        } else if (edinetCode) {
          results = await client.searchByCompany(edinetCode, startDate, endDate);
        } else if (companyName) {
          // Search recent days and filter by company name
          const d = new Date(endDate);
          for (let i = 0; i < 7 && results.length < 50; i++) {
            const dateStr = d.toISOString().split("T")[0];
            try {
              const response = await client.getDocumentList({ date: dateStr, type: "2" });
              const filtered = response.results.filter(
                (doc) => doc.filerName.includes(companyName)
              );
              results.push(...filtered);
            } catch (error) {
              // Skip errors
            }
            d.setDate(d.getDate() - 1);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query: { secCode, edinetCode, companyName, fromDate: startDate, toDate: endDate },
                count: results.length,
                documents: results.map(formatDocument),
              }, null, 2),
            },
          ],
        };
      }

      case "search_disclosures": {
        const { keyword, docType, fromDate, toDate, limit = 50 } = args as {
          keyword?: string;
          docType?: string;
          fromDate?: string;
          toDate?: string;
          limit?: number;
        };

        const endDate = toDate || new Date().toISOString().split("T")[0];
        const startDate = fromDate || (() => {
          const d = new Date();
          d.setDate(d.getDate() - 7);
          return d.toISOString().split("T")[0];
        })();

        const results: Document[] = [];
        const d = new Date(endDate);
        const start = new Date(startDate);

        while (d >= start && results.length < limit) {
          const dateStr = d.toISOString().split("T")[0];
          try {
            const response = await client.getDocumentList({ date: dateStr, type: "2" });
            let filtered = response.results;

            if (keyword) {
              filtered = filtered.filter(
                (doc) => 
                  doc.filerName.includes(keyword) ||
                  doc.docDescription.includes(keyword)
              );
            }

            if (docType) {
              filtered = filtered.filter(
                (doc) => 
                  doc.docDescription.includes(docType) ||
                  (DOC_TYPE_MAP[doc.docTypeCode] && DOC_TYPE_MAP[doc.docTypeCode].includes(docType))
              );
            }

            results.push(...filtered);
          } catch (error) {
            // Skip errors
          }
          d.setDate(d.getDate() - 1);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query: { keyword, docType, fromDate: startDate, toDate: endDate },
                count: Math.min(results.length, limit),
                documents: results.slice(0, limit).map(formatDocument),
              }, null, 2),
            },
          ],
        };
      }

      case "analyze_financials": {
        const { secCode, companyName, period = "latest" } = args as {
          secCode?: string;
          companyName?: string;
          period?: string;
        };

        // Find the company's latest filing
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = (() => {
          const d = new Date();
          d.setDate(d.getDate() - 90); // Last 90 days
          return d.toISOString().split("T")[0];
        })();

        let documents: Document[] = [];
        
        if (secCode) {
          documents = await client.searchBySecCode(secCode, startDate, endDate);
        } else if (companyName) {
          const d = new Date(endDate);
          for (let i = 0; i < 30 && documents.length < 10; i++) {
            const dateStr = d.toISOString().split("T")[0];
            try {
              const response = await client.getDocumentList({ date: dateStr, type: "2" });
              const filtered = response.results.filter(
                (doc) => doc.filerName.includes(companyName)
              );
              documents.push(...filtered);
            } catch (error) {
              // Skip errors
            }
            d.setDate(d.getDate() - 1);
          }
        }

        // Filter for annual or quarterly reports
        const reportDocs = documents.filter(
          (doc) => 
            doc.docTypeCode === "120" || // 有価証券報告書
            doc.docTypeCode === "140" || // 四半期報告書
            doc.docTypeCode === "160"    // 半期報告書
        );

        if (reportDocs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "No financial reports found",
                  message: "指定された企業の財務報告書が見つかりません。証券コードまたは企業名を確認してください。",
                  query: { secCode, companyName, period },
                }, null, 2),
              },
            ],
          };
        }

        // Use the latest report
        const latestDoc = reportDocs[0];
        
        // Create mock financial statements (in production, parse actual XBRL)
        const fs = createEmptyFinancialStatements();
        fs.companyName = latestDoc.filerName;
        fs.secCode = latestDoc.secCode;
        fs.fiscalYear = latestDoc.periodEnd?.substring(0, 4) || "";
        fs.fiscalPeriod = latestDoc.periodStart && latestDoc.periodEnd 
          ? `${latestDoc.periodStart} - ${latestDoc.periodEnd}` 
          : "";
        fs.reportType = DOC_TYPE_MAP[latestDoc.docTypeCode] || latestDoc.docDescription;
        fs.submitDate = latestDoc.submitDateTime;

        // Download and parse XBRL
        let financialData: object | null = null;
        try {
          if (latestDoc.xbrlFlag === "1") {
            const xbrlZip = await client.getDocument(latestDoc.docID, "1");
            const parsedFs = await parseXbrlFromZip(xbrlZip);
            
            // Update basic info
            parsedFs.companyName = parsedFs.companyName || latestDoc.filerName;
            parsedFs.secCode = parsedFs.secCode || latestDoc.secCode;
            parsedFs.reportType = DOC_TYPE_MAP[latestDoc.docTypeCode] || latestDoc.docDescription;
            parsedFs.submitDate = latestDoc.submitDateTime;
            parsedFs.fiscalPeriod = latestDoc.periodStart && latestDoc.periodEnd 
              ? `${latestDoc.periodStart} - ${latestDoc.periodEnd}` 
              : "";
            
            financialData = formatFinancialOutput(parsedFs);
          }
        } catch (parseError) {
          console.error("XBRL parse error:", parseError);
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: financialData ? "success" : "partial",
                message: financialData 
                  ? "財務データを取得・解析しました。"
                  : "財務報告書を検出しましたが、XBRLデータの解析に一部失敗しました。",
                document: formatDocument(latestDoc),
                financialAnalysis: financialData,
                availableDocuments: reportDocs.slice(0, 5).map(formatDocument),
              }, null, 2),
            },
          ],
        };
      }

      case "compare_companies": {
        const { secCodes, metrics = ["roe", "operatingMargin", "revenue"] } = args as {
          secCodes: string[];
          metrics?: string[];
        };

        if (!secCodes || secCodes.length < 2) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Invalid input",
                  message: "比較には2つ以上の証券コードが必要です。",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Find latest filings for each company
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = (() => {
          const d = new Date();
          d.setDate(d.getDate() - 90);
          return d.toISOString().split("T")[0];
        })();

        const companyData: Array<{
          secCode: string;
          companyName: string;
          latestReport: object | null;
          reportDate: string | null;
        }> = [];

        for (const code of secCodes) {
          const documents = await client.searchBySecCode(code, startDate, endDate);
          const reportDocs = documents.filter(
            (doc) => 
              doc.docTypeCode === "120" || 
              doc.docTypeCode === "140" || 
              doc.docTypeCode === "160"
          );

          if (reportDocs.length > 0) {
            companyData.push({
              secCode: code,
              companyName: reportDocs[0].filerName,
              latestReport: formatDocument(reportDocs[0]),
              reportDate: reportDocs[0].submitDateTime,
            });
          } else {
            companyData.push({
              secCode: code,
              companyName: "未取得",
              latestReport: null,
              reportDate: null,
            });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "partial",
                message: "企業情報を取得しました。完全な比較分析は次期バージョンで実装予定です。",
                companies: companyData,
                requestedMetrics: metrics,
                nextSteps: [
                  "XBRL解析による財務データ取得",
                  "指標の自動計算と比較",
                  "業界平均との比較",
                ],
              }, null, 2),
            },
          ],
        };
      }

      case "detect_earnings_revisions": {
        const { date } = args as { date?: string };
        
        const targetDate = date || new Date().toISOString().split("T")[0];
        
        try {
          const response = await client.getDocumentList({ date: targetDate, type: "2" });
          const revisions = scanDailyRevisions(response.results);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  tokenSaved: "~1,000,000 tokens (vs reading all disclosures)",
                  date: targetDate,
                  totalDocuments: response.metadata.resultset.count,
                  revisionsFound: revisions.length,
                  revisions: revisions.map((r) => ({
                    company: r.companyName,
                    secCode: r.secCode,
                    type: r.revisionType,
                    headline: r.summary.headline,
                    impact: r.summary.impact,
                    timing: r.meta.announcementTiming,
                    tradingImplication: r.summary.tradingImplication,
                    docId: r.docId,
                  })),
                  summary: revisions.length > 0
                    ? `${targetDate}に${revisions.length}件の業績予想修正を検出`
                    : `${targetDate}に業績予想修正はありませんでした`,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Failed to detect revisions",
                  message: error instanceof Error ? error.message : String(error),
                  date: targetDate,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      case "detect_large_shareholders": {
        const { date } = args as { date?: string };
        
        const targetDate = date || new Date().toISOString().split("T")[0];
        
        try {
          const response = await client.getDocumentList({ date: targetDate, type: "2" });
          const reports = scanDailyLargeShareholderReports(response.results);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  tokenSaved: "~500,000 tokens (vs reading all 5% reports)",
                  date: targetDate,
                  totalDocuments: response.metadata.resultset.count,
                  reportsFound: reports.length,
                  reports: reports.map((r) => ({
                    targetCompany: r.targetCompany,
                    targetSecCode: r.targetSecCode,
                    holder: r.holder.name,
                    holderType: r.holder.type,
                    reportType: r.reportType,
                    signal: r.summary.signal,
                    headline: r.summary.headline,
                    keyPoints: r.summary.keyPoints,
                    tradingImplication: r.summary.tradingImplication,
                    docId: r.docId,
                  })),
                  activistAlerts: reports.filter((r) => r.summary.signal === "BULLISH").length,
                  summary: reports.length > 0
                    ? `${targetDate}に${reports.length}件の大量保有報告を検出（アクティビスト関連: ${reports.filter((r) => r.summary.signal === "BULLISH").length}件）`
                    : `${targetDate}に大量保有報告はありませんでした`,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Failed to detect large shareholders",
                  message: error instanceof Error ? error.message : String(error),
                  date: targetDate,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      case "get_investment_recommendation": {
        const { secCode, companyName } = args as {
          secCode?: string;
          companyName?: string;
        };

        if (!secCode && !companyName) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Invalid input",
                  message: "証券コード（secCode）または企業名（companyName）を指定してください。",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Find the company's latest filing
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = (() => {
          const d = new Date();
          d.setDate(d.getDate() - 180); // Last 180 days for annual reports
          return d.toISOString().split("T")[0];
        })();

        let documents: Document[] = [];
        
        if (secCode) {
          documents = await client.searchBySecCode(secCode, startDate, endDate);
        } else if (companyName) {
          const d = new Date(endDate);
          for (let i = 0; i < 60 && documents.length < 10; i++) {
            const dateStr = d.toISOString().split("T")[0];
            try {
              const response = await client.getDocumentList({ date: dateStr, type: "2" });
              const filtered = response.results.filter(
                (doc) => doc.filerName.includes(companyName!)
              );
              documents.push(...filtered);
            } catch (error) {
              // Skip errors
            }
            d.setDate(d.getDate() - 1);
          }
        }

        // Filter for annual or quarterly reports with XBRL
        const reportDocs = documents.filter(
          (doc) => 
            (doc.docTypeCode === "120" || doc.docTypeCode === "140" || doc.docTypeCode === "160") &&
            doc.xbrlFlag === "1"
        );

        if (reportDocs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "No financial reports found",
                  message: "指定された企業の財務報告書が見つかりません。証券コードまたは企業名を確認してください。",
                  query: { secCode, companyName },
                  tokenSaved: "N/A",
                }, null, 2),
              },
            ],
          };
        }

        const latestDoc = reportDocs[0];
        
        // Download and parse XBRL
        let recommendation: InvestmentRecommendation | null = null;
        try {
          const xbrlZip = await client.getDocument(latestDoc.docID, "1");
          const parsedFs = await parseXbrlFromZip(xbrlZip);
          
          // Update basic info
          parsedFs.companyName = parsedFs.companyName || latestDoc.filerName;
          parsedFs.secCode = parsedFs.secCode || latestDoc.secCode;
          parsedFs.reportType = DOC_TYPE_MAP[latestDoc.docTypeCode] || latestDoc.docDescription;
          parsedFs.submitDate = latestDoc.submitDateTime;
          parsedFs.fiscalPeriod = latestDoc.periodStart && latestDoc.periodEnd 
            ? `${latestDoc.periodStart} - ${latestDoc.periodEnd}` 
            : "";
          
          // Generate investment recommendation
          recommendation = generateInvestmentRecommendation(parsedFs);
          
        } catch (parseError) {
          console.error("XBRL parse error:", parseError);
        }
        
        if (!recommendation) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Analysis failed",
                  message: "財務データの解析に失敗しました。",
                  document: formatDocument(latestDoc),
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                tokenSaved: "~50,000 tokens",
                company: {
                  name: latestDoc.filerName,
                  secCode: latestDoc.secCode,
                  reportType: DOC_TYPE_MAP[latestDoc.docTypeCode] || latestDoc.docDescription,
                  reportDate: latestDoc.submitDateTime,
                },
                recommendation: recommendation.recommendation,
                confidence: recommendation.confidence,
                rationale: recommendation.rationale,
                risks: recommendation.risks,
                legal: recommendation.legal,
                meta: recommendation.meta,
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Unknown tool",
                message: `Tool '${name}' is not supported`,
              }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Internal error",
            message: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  console.error("Starting japan-edinet-mcp server...");
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("japan-edinet-mcp server started");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
