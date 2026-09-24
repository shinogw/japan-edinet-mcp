/**
 * J-Quants API クライアント（V2）
 * JPX公式の株価・財務データAPI
 * Standard Plan: 当日株価取得可能
 */

const JQUANTS_BASE_URL = "https://api.jquants.com/v2";

function getApiKey(): string {
  const key = process.env.JQUANTS_API_KEY;
  if (!key) {
    throw new Error("JQUANTS_API_KEY environment variable is not set");
  }
  return key;
}

function toJQuantsCode(secCode: string): string {
  // J-Quantsは5桁コード（末尾0）を使用
  const code = secCode.replace(/\D/g, "");
  return code.length === 4 ? code + "0" : code;
}

interface JQuantsDailyQuote {
  Date: string;
  Code: string;
  O: number | null;    // Open
  H: number | null;    // High
  L: number | null;    // Low
  C: number | null;    // Close
  Vo: number | null;   // Volume
  Va: number | null;   // Turnover Value
  AdjO: number | null; // Adjusted Open
  AdjH: number | null; // Adjusted High
  AdjL: number | null; // Adjusted Low
  AdjC: number | null; // Adjusted Close
  AdjVo: number | null; // Adjusted Volume
}

export interface StockQuote {
  code: string;
  date: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface StockInfo {
  code: string;
  date: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  dividendYield: number | null;
  sharesOutstanding: number | null;
}

/**
 * J-Quants APIにリクエストを送信
 */
async function jquantsFetch(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${JQUANTS_BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      "x-api-key": getApiKey(),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`J-Quants API error (${response.status}): ${body}`);
  }

  return response.json();
}

/**
 * 直近の株価を取得
 */
export async function getLatestQuote(secCode: string): Promise<StockQuote | null> {
  const code = toJQuantsCode(secCode);

  try {
    // 直近5営業日を検索して最新を返す
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);

    const data = await jquantsFetch("/equities/bars/daily", {
      code,
      from: from.toISOString().split("T")[0].replace(/-/g, ""),
      to: to.toISOString().split("T")[0].replace(/-/g, ""),
    });

    const quotes: JQuantsDailyQuote[] = data.data || data.daily_quotes || [];
    if (quotes.length === 0) return null;

    // 最新日のデータ
    const latest = quotes[quotes.length - 1];
    const price = latest.AdjC ?? latest.C;
    if (!price) return null;

    return {
      code: latest.Code,
      date: latest.Date,
      price,
      open: latest.AdjO ?? latest.O,
      high: latest.AdjH ?? latest.H,
      low: latest.AdjL ?? latest.L,
      volume: latest.AdjVo ?? latest.Vo,
    };
  } catch (error) {
    console.error(`J-Quants: Failed to get quote for ${secCode}:`, error);
    return null;
  }
}

/**
 * 株価 + 財務指標（PER/PBR/時価総額）を統合取得
 * EDINETのEPS/BPSと組み合わせてPER/PBRを算出
 */
export async function getStockInfo(
  secCode: string,
  opts?: { eps?: number | null; bps?: number | null; sharesOutstanding?: number | null }
): Promise<StockInfo | null> {
  const quote = await getLatestQuote(secCode);
  if (!quote) return null;

  const eps = opts?.eps ?? null;
  const bps = opts?.bps ?? null;
  const sharesOutstanding = opts?.sharesOutstanding ?? null;

  // PER = 株価 ÷ EPS
  const per = eps && eps > 0 ? Math.round((quote.price / eps) * 100) / 100 : null;

  // PBR = 株価 ÷ BPS
  const pbr = bps && bps > 0 ? Math.round((quote.price / bps) * 100) / 100 : null;

  // 時価総額 = 株価 × 発行済株式数
  const marketCap = sharesOutstanding ? quote.price * sharesOutstanding : null;

  // 配当利回りはJ-Quantsからは直接取れないのでnull
  const dividendYield = null;

  return {
    code: quote.code,
    date: quote.date,
    price: quote.price,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    marketCap,
    per,
    pbr,
    eps,
    bps,
    dividendYield,
    sharesOutstanding,
  };
}
