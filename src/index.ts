#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";

import { getEdinetClient, Document } from "./api/edinet.js";

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
