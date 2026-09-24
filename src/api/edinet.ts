/**
 * EDINET API クライアント
 */

const EDINET_API_BASE = "https://api.edinet-fsa.go.jp/api/v2";

export interface DocumentListParams {
  date: string; // YYYY-MM-DD
  type?: "1" | "2"; // 1: メタデータのみ, 2: 書類一覧
}

export interface Document {
  seqNumber: number;
  docID: string;
  edinetCode: string;
  secCode: string | null;
  JCN: string;
  filerName: string;
  fundCode: string | null;
  ordinanceCode: string;
  formCode: string;
  docTypeCode: string;
  periodStart: string | null;
  periodEnd: string | null;
  submitDateTime: string;
  docDescription: string;
  issuerEdinetCode: string | null;
  subjectEdinetCode: string | null;
  subsidiaryEdinetCode: string | null;
  currentReportReason: string | null;
  parentDocID: string | null;
  opeDateTime: string | null;
  withdrawalStatus: string;
  docInfoEditStatus: string;
  disclosureStatus: string;
  xbrlFlag: string;
  pdfFlag: string;
  attachDocFlag: string;
  englishDocFlag: string;
  csvFlag: string;
  legalStatus: string;
}

export interface DocumentListResponse {
  metadata: {
    title: string;
    parameter: {
      date: string;
      type: string;
    };
    resultset: {
      count: number;
    };
    processDateTime: string;
    status: string;
    message: string;
  };
  results: Document[];
}

export class EdinetClient {
  private apiKey: string;
  // 過去日の書類一覧はほぼ不変なのでプロセス内キャッシュ（当日分はキャッシュしない）
  private listCache = new Map<string, DocumentListResponse>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * 指定日の書類一覧を取得
   */
  async getDocumentList(params: DocumentListParams): Promise<DocumentListResponse> {
    const cacheKey = `${params.date}:${params.type || "2"}`;
    const cached = this.listCache.get(cacheKey);
    if (cached) return cached;

    const url = new URL(`${EDINET_API_BASE}/documents.json`);
    url.searchParams.set("date", params.date);
    url.searchParams.set("type", params.type || "2");
    url.searchParams.set("Subscription-Key", this.apiKey);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`EDINET API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as DocumentListResponse;
    const today = new Date().toISOString().split("T")[0];
    if (params.date < today && Array.isArray(data.results)) {
      this.listCache.set(cacheKey, data);
    }
    return data;
  }

  /**
   * 書類を取得（ZIP形式）
   */
  async getDocument(docId: string, type: "1" | "2" | "3" | "4" | "5" = "1"): Promise<ArrayBuffer> {
    // type: 1=XBRL, 2=PDF, 3=代替書面, 4=英文ファイル, 5=CSV
    const url = new URL(`${EDINET_API_BASE}/documents/${docId}`);
    url.searchParams.set("type", type);
    url.searchParams.set("Subscription-Key", this.apiKey);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`EDINET API error: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * 企業コードで書類を検索
   */
  async searchByCompany(
    edinetCode: string,
    fromDate: string,
    toDate: string
  ): Promise<Document[]> {
    const results: Document[] = [];
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    // 日付範囲をループして検索
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      try {
        const response = await this.getDocumentList({ date: dateStr, type: "2" });
        const filtered = response.results.filter(
          (doc) => doc.edinetCode === edinetCode
        );
        results.push(...filtered);
      } catch (error) {
        // 日付にデータがない場合はスキップ
        console.error(`Error fetching ${dateStr}:`, error);
      }
    }

    return results;
  }

  /**
   * 証券コードで書類を検索
   */
  async searchBySecCode(
    secCode: string,
    fromDate: string,
    toDate: string
  ): Promise<Document[]> {
    const results: Document[] = [];
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      try {
        const response = await this.getDocumentList({ date: dateStr, type: "2" });
        const filtered = response.results.filter(
          (doc) => doc.secCode === secCode || doc.secCode === secCode + "0"
        );
        results.push(...filtered);
      } catch (error) {
        console.error(`Error fetching ${dateStr}:`, error);
      }
    }

    // 呼び出し側は reportDocs[0] を最新として扱うため、新しい順に並べる
    return results.sort((a, b) => b.submitDateTime.localeCompare(a.submitDateTime));
  }

  /**
   * 指定書類種別の最新書類を、今日から遡って探す（見つかった時点で終了）
   * docTypeCode: 120=有価証券報告書, 140=四半期報告書, 160=半期報告書
   */
  async findLatestFilings(
    secCode: string,
    docTypeCodes: string[],
    maxDays = 400,
    limit = 1
  ): Promise<Document[]> {
    const code = secCode.length === 4 ? secCode + "0" : secCode;
    const found: Document[] = [];
    const d = new Date();
    for (let i = 0; i <= maxDays && found.length < limit; i++) {
      const dateStr = d.toISOString().split("T")[0];
      try {
        const response = await this.getDocumentList({ date: dateStr, type: "2" });
        const hits = response.results
          .filter((doc) => doc.secCode === code && docTypeCodes.includes(doc.docTypeCode) && doc.xbrlFlag === "1")
          .sort((a, b) => b.submitDateTime.localeCompare(a.submitDateTime));
        found.push(...hits);
      } catch (error) {
        console.error(`Error fetching ${dateStr}:`, error);
      }
      d.setDate(d.getDate() - 1);
    }
    return found.slice(0, limit);
  }
}

// シングルトンインスタンス用
let clientInstance: EdinetClient | null = null;

export function getEdinetClient(): EdinetClient {
  if (!clientInstance) {
    const apiKey = process.env.EDINET_API_KEY;
    if (!apiKey) {
      throw new Error("EDINET_API_KEY environment variable is not set");
    }
    clientInstance = new EdinetClient(apiKey);
  }
  return clientInstance;
}
