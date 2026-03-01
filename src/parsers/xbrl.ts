/**
 * XBRL解析エンジン
 * EDINETのXBRLデータから財務諸表を構造化
 */

export interface FinancialStatements {
  // 基本情報
  companyName: string;
  secCode: string | null;
  fiscalYear: string;
  fiscalPeriod: string;
  reportType: string;
  submitDate: string;
  
  // 日本特化: 会計基準情報
  accountingInfo: {
    standard: "JGAAP" | "IFRS" | "US-GAAP" | "UNKNOWN";
    consolidation: "連結" | "単体" | "UNKNOWN";
    industry: string | null;  // 業種
    fiscalYearEndMonth: number | null;  // 決算月（3=3月決算）
  };
  
  // 貸借対照表 (Balance Sheet)
  balanceSheet: {
    // 資産
    totalAssets: number | null;
    currentAssets: number | null;
    cashAndDeposits: number | null;
    accountsReceivable: number | null;
    inventories: number | null;
    nonCurrentAssets: number | null;
    tangibleAssets: number | null;
    intangibleAssets: number | null;
    investments: number | null;           // 投資その他の資産（広義）
    investmentSecurities: number | null;   // 投資有価証券
    investmentProperty: number | null;     // 投資不動産
    securities: number | null;             // 有価証券（流動資産）
    treasuryShares: number | null;         // 自己株式（マイナス値）
    
    // 負債
    totalLiabilities: number | null;
    currentLiabilities: number | null;
    accountsPayable: number | null;
    shortTermDebt: number | null;
    nonCurrentLiabilities: number | null;
    longTermDebt: number | null;
    
    // 純資産
    netAssets: number | null;
    shareholdersEquity: number | null;
    retainedEarnings: number | null;
  };
  
  // 損益計算書 (Profit & Loss)
  incomeStatement: {
    revenue: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    ordinaryIncome: number | null;
    netIncome: number | null;
    eps: number | null; // 1株当たり当期純利益
    
    // コスト・費用
    costOfSales: number | null;
    sellingExpenses: number | null;
    adminExpenses: number | null;
  };
  
  // キャッシュフロー計算書 (Cash Flow)
  cashFlow: {
    operatingCF: number | null;
    investingCF: number | null;
    financingCF: number | null;
    freeCashFlow: number | null;
    cashEndOfPeriod: number | null;
  };
  
  // 主要指標
  metrics: {
    roe: number | null; // 自己資本利益率
    roa: number | null; // 総資産利益率
    operatingMargin: number | null; // 営業利益率
    netMargin: number | null; // 純利益率
    debtToEquity: number | null; // D/Eレシオ
    currentRatio: number | null; // 流動比率
    quickRatio: number | null; // 当座比率
  };
  
  // 配当情報
  dividend: {
    annualDividendPerShare: number | null; // 年間配当金（1株当たり）
    interimDividendPerShare: number | null; // 中間配当金
    finalDividendPerShare: number | null; // 期末配当金
    dividendYield: number | null; // 配当利回り（%）
    payoutRatio: number | null; // 配当性向（%）
    totalDividendPaid: number | null; // 配当金支払総額
  };
  
  // AI向けサマリー
  summary: {
    highlights: string[];
    risks: string[];
    outlook: string;
  };
}

/**
 * XBRLタグと財務項目のマッピング
 */
const XBRL_TAG_MAP: Record<string, string> = {
  // 資産
  "jppfs_cor:Assets": "totalAssets",
  "jppfs_cor:CurrentAssets": "currentAssets",
  "jppfs_cor:CashAndDeposits": "cashAndDeposits",
  "jppfs_cor:NotesAndAccountsReceivableTrade": "accountsReceivable",
  "jppfs_cor:Inventories": "inventories",
  "jppfs_cor:NoncurrentAssets": "nonCurrentAssets",
  "jppfs_cor:PropertyPlantAndEquipment": "tangibleAssets",
  "jppfs_cor:IntangibleAssets": "intangibleAssets",
  "jppfs_cor:InvestmentsAndOtherAssets": "investments",
  
  // 負債
  "jppfs_cor:Liabilities": "totalLiabilities",
  "jppfs_cor:CurrentLiabilities": "currentLiabilities",
  "jppfs_cor:NotesAndAccountsPayableTrade": "accountsPayable",
  "jppfs_cor:ShortTermLoansPayable": "shortTermDebt",
  "jppfs_cor:NoncurrentLiabilities": "nonCurrentLiabilities",
  "jppfs_cor:LongTermLoansPayable": "longTermDebt",
  
  // 純資産
  "jppfs_cor:NetAssets": "netAssets",
  "jppfs_cor:ShareholdersEquity": "shareholdersEquity",
  "jppfs_cor:RetainedEarnings": "retainedEarnings",
  
  // 損益
  "jppfs_cor:NetSales": "revenue",
  "jppfs_cor:GrossProfit": "grossProfit",
  "jppfs_cor:OperatingIncome": "operatingIncome",
  "jppfs_cor:OrdinaryIncome": "ordinaryIncome",
  "jppfs_cor:ProfitLoss": "netIncome",
  "jppfs_cor:BasicEarningsLossPerShare": "eps",
  "jppfs_cor:CostOfSales": "costOfSales",
  "jppfs_cor:SellingGeneralAndAdministrativeExpenses": "sellingExpenses",
  
  // キャッシュフロー
  "jppfs_cor:NetCashProvidedByUsedInOperatingActivities": "operatingCF",
  "jppfs_cor:NetCashProvidedByUsedInInvestingActivities": "investingCF",
  "jppfs_cor:NetCashProvidedByUsedInFinancingActivities": "financingCF",
  "jppfs_cor:CashAndCashEquivalents": "cashEndOfPeriod",
};

/**
 * 財務指標を計算
 */
export function calculateMetrics(fs: FinancialStatements): void {
  const bs = fs.balanceSheet;
  const is = fs.incomeStatement;
  
  // ROE = 当期純利益 / 自己資本
  if (is.netIncome && bs.shareholdersEquity && bs.shareholdersEquity > 0) {
    fs.metrics.roe = Math.round((is.netIncome / bs.shareholdersEquity) * 10000) / 100;
  }
  
  // ROA = 当期純利益 / 総資産
  if (is.netIncome && bs.totalAssets && bs.totalAssets > 0) {
    fs.metrics.roa = Math.round((is.netIncome / bs.totalAssets) * 10000) / 100;
  }
  
  // 営業利益率 = 営業利益 / 売上高
  if (is.operatingIncome && is.revenue && is.revenue > 0) {
    fs.metrics.operatingMargin = Math.round((is.operatingIncome / is.revenue) * 10000) / 100;
  }
  
  // 純利益率 = 当期純利益 / 売上高
  if (is.netIncome && is.revenue && is.revenue > 0) {
    fs.metrics.netMargin = Math.round((is.netIncome / is.revenue) * 10000) / 100;
  }
  
  // D/Eレシオ = 有利子負債 / 自己資本
  const totalDebt = (bs.shortTermDebt || 0) + (bs.longTermDebt || 0);
  if (totalDebt > 0 && bs.shareholdersEquity && bs.shareholdersEquity > 0) {
    fs.metrics.debtToEquity = Math.round((totalDebt / bs.shareholdersEquity) * 100) / 100;
  }
  
  // 流動比率 = 流動資産 / 流動負債
  if (bs.currentAssets && bs.currentLiabilities && bs.currentLiabilities > 0) {
    fs.metrics.currentRatio = Math.round((bs.currentAssets / bs.currentLiabilities) * 100) / 100;
  }
  
  // フリーキャッシュフロー = 営業CF + 投資CF
  if (fs.cashFlow.operatingCF !== null && fs.cashFlow.investingCF !== null) {
    fs.cashFlow.freeCashFlow = fs.cashFlow.operatingCF + fs.cashFlow.investingCF;
  }
  
  // 配当性向 = 年間配当 / EPS * 100
  if (fs.dividend.annualDividendPerShare !== null && fs.incomeStatement.eps !== null && fs.incomeStatement.eps > 0) {
    fs.dividend.payoutRatio = Math.round((fs.dividend.annualDividendPerShare / fs.incomeStatement.eps) * 10000) / 100;
  }
}

/**
 * AIサマリーを生成
 */
export function generateSummary(fs: FinancialStatements): void {
  const highlights: string[] = [];
  const risks: string[] = [];
  
  // ハイライト分析
  if (fs.metrics.roe !== null) {
    if (fs.metrics.roe >= 15) {
      highlights.push(`ROE ${fs.metrics.roe}%と高収益性（優良基準15%超）`);
    } else if (fs.metrics.roe >= 8) {
      highlights.push(`ROE ${fs.metrics.roe}%と安定した収益性`);
    }
  }
  
  if (fs.metrics.operatingMargin !== null) {
    if (fs.metrics.operatingMargin >= 20) {
      highlights.push(`営業利益率 ${fs.metrics.operatingMargin}%と高い収益力`);
    } else if (fs.metrics.operatingMargin >= 10) {
      highlights.push(`営業利益率 ${fs.metrics.operatingMargin}%と堅調`);
    }
  }
  
  if (fs.cashFlow.freeCashFlow !== null && fs.cashFlow.freeCashFlow > 0) {
    const fcfBillions = Math.round(fs.cashFlow.freeCashFlow / 100000000) / 10;
    highlights.push(`フリーCF ${fcfBillions}億円とキャッシュ創出力あり`);
  }
  
  // リスク分析
  if (fs.metrics.roe !== null && fs.metrics.roe < 5) {
    risks.push(`ROE ${fs.metrics.roe}%と低収益性`);
  }
  
  if (fs.metrics.debtToEquity !== null && fs.metrics.debtToEquity > 2) {
    risks.push(`D/Eレシオ ${fs.metrics.debtToEquity}と高レバレッジ`);
  }
  
  if (fs.metrics.currentRatio !== null && fs.metrics.currentRatio < 1) {
    risks.push(`流動比率 ${fs.metrics.currentRatio}と短期流動性懸念`);
  }
  
  if (fs.cashFlow.operatingCF !== null && fs.cashFlow.operatingCF < 0) {
    risks.push(`営業CFがマイナスで本業からの現金創出に課題`);
  }
  
  // 総合評価
  let outlook = "";
  if (highlights.length >= 2 && risks.length === 0) {
    outlook = "財務健全性が高く、成長投資余力あり。ポジティブ評価。";
  } else if (highlights.length >= 1 && risks.length <= 1) {
    outlook = "総じて安定した財務状況。中立評価。";
  } else if (risks.length >= 2) {
    outlook = "財務面でいくつかの課題あり。慎重な評価が必要。";
  } else {
    outlook = "詳細な分析が必要。";
  }
  
  fs.summary = {
    highlights: highlights.length > 0 ? highlights : ["特筆すべきハイライトなし"],
    risks: risks.length > 0 ? risks : ["顕著なリスク要因なし"],
    outlook,
  };
}

/**
 * 空の財務諸表オブジェクトを作成
 */
export function createEmptyFinancialStatements(): FinancialStatements {
  return {
    companyName: "",
    secCode: null,
    fiscalYear: "",
    fiscalPeriod: "",
    reportType: "",
    submitDate: "",
    accountingInfo: {
      standard: "UNKNOWN",
      consolidation: "UNKNOWN",
      industry: null,
      fiscalYearEndMonth: null,
    },
    balanceSheet: {
      totalAssets: null,
      currentAssets: null,
      cashAndDeposits: null,
      accountsReceivable: null,
      inventories: null,
      nonCurrentAssets: null,
      tangibleAssets: null,
      intangibleAssets: null,
      investments: null,
      investmentSecurities: null,
      investmentProperty: null,
      securities: null,
      treasuryShares: null,
      totalLiabilities: null,
      currentLiabilities: null,
      accountsPayable: null,
      shortTermDebt: null,
      nonCurrentLiabilities: null,
      longTermDebt: null,
      netAssets: null,
      shareholdersEquity: null,
      retainedEarnings: null,
    },
    incomeStatement: {
      revenue: null,
      grossProfit: null,
      operatingIncome: null,
      ordinaryIncome: null,
      netIncome: null,
      eps: null,
      costOfSales: null,
      sellingExpenses: null,
      adminExpenses: null,
    },
    cashFlow: {
      operatingCF: null,
      investingCF: null,
      financingCF: null,
      freeCashFlow: null,
      cashEndOfPeriod: null,
    },
    metrics: {
      roe: null,
      roa: null,
      operatingMargin: null,
      netMargin: null,
      debtToEquity: null,
      currentRatio: null,
      quickRatio: null,
    },
    dividend: {
      annualDividendPerShare: null,
      interimDividendPerShare: null,
      finalDividendPerShare: null,
      dividendYield: null,
      payoutRatio: null,
      totalDividendPaid: null,
    },
    summary: {
      highlights: [],
      risks: [],
      outlook: "",
    },
  };
}
