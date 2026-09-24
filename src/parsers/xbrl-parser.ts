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
  generateSummary,
  HistoryEntry,
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
  // ========== 損益計算書 ==========
  // 売上高（複数のタグパターンに対応）
  "jppfs_cor:NetSales": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:OperatingRevenue1": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:OperatingRevenue2": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:RevenueIFRS": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:Revenue": [{ path: "incomeStatement", field: "revenue" }],
  "jppfs_cor:NetSalesOfCompletedConstructionContracts": [{ path: "incomeStatement", field: "revenue" }],
  
  // 売上総利益
  "jppfs_cor:GrossProfit": [{ path: "incomeStatement", field: "grossProfit" }],
  "jppfs_cor:GrossProfitOnSales": [{ path: "incomeStatement", field: "grossProfit" }],
  
  // 営業利益
  "jppfs_cor:OperatingIncome": [{ path: "incomeStatement", field: "operatingIncome" }],
  "jppfs_cor:OperatingProfit": [{ path: "incomeStatement", field: "operatingIncome" }],
  "jppfs_cor:OperatingIncomeIFRS": [{ path: "incomeStatement", field: "operatingIncome" }],
  
  // 経常利益
  "jppfs_cor:OrdinaryIncome": [{ path: "incomeStatement", field: "ordinaryIncome" }],
  "jppfs_cor:OrdinaryProfit": [{ path: "incomeStatement", field: "ordinaryIncome" }],
  
  // 当期純利益
  "jppfs_cor:ProfitLoss": [{ path: "incomeStatement", field: "netIncome" }],
  "jppfs_cor:ProfitLossAttributableToOwnersOfParent": [{ path: "incomeStatement", field: "netIncome" }],
  "jppfs_cor:NetIncome": [{ path: "incomeStatement", field: "netIncome" }],
  "jppfs_cor:NetIncomeIFRS": [{ path: "incomeStatement", field: "netIncome" }],
  "jppfs_cor:ProfitAttributableToOwnersOfParent": [{ path: "incomeStatement", field: "netIncome" }],
  
  // EPS（1株当たり当期純利益）
  "jppfs_cor:BasicEarningsLossPerShare": [{ path: "incomeStatement", field: "eps" }],
  "jppfs_cor:BasicEarningsPerShare": [{ path: "incomeStatement", field: "eps" }],
  "jppfs_cor:BasicEarningsLossPerShareIFRS": [{ path: "incomeStatement", field: "eps" }],
  
  // 売上原価
  "jppfs_cor:CostOfSales": [{ path: "incomeStatement", field: "costOfSales" }],
  "jppfs_cor:CostOfGoodsSold": [{ path: "incomeStatement", field: "costOfSales" }],
  
  // 販管費
  "jppfs_cor:SellingGeneralAndAdministrativeExpenses": [{ path: "incomeStatement", field: "sellingExpenses" }],
  "jppfs_cor:SGA": [{ path: "incomeStatement", field: "sellingExpenses" }],
  
  // ========== 貸借対照表 ==========
  // 資産
  "jppfs_cor:Assets": [{ path: "balanceSheet", field: "totalAssets" }],
  "jppfs_cor:TotalAssets": [{ path: "balanceSheet", field: "totalAssets" }],
  "jppfs_cor:TotalAssetsIFRS": [{ path: "balanceSheet", field: "totalAssets" }],
  
  "jppfs_cor:CurrentAssets": [{ path: "balanceSheet", field: "currentAssets" }],
  "jppfs_cor:CashAndDeposits": [{ path: "balanceSheet", field: "cashAndDeposits" }],
  "jppfs_cor:CashAndCashEquivalents": [{ path: "balanceSheet", field: "cashAndDeposits" }],
  "jppfs_cor:CashAndCashEquivalentsIFRS": [{ path: "balanceSheet", field: "cashAndDeposits" }],
  
  "jppfs_cor:NotesAndAccountsReceivableTrade": [{ path: "balanceSheet", field: "accountsReceivable" }],
  "jppfs_cor:TradeAndOtherReceivables": [{ path: "balanceSheet", field: "accountsReceivable" }],
  
  "jppfs_cor:Inventories": [{ path: "balanceSheet", field: "inventories" }],
  "jppfs_cor:InventoriesIFRS": [{ path: "balanceSheet", field: "inventories" }],
  
  "jppfs_cor:NoncurrentAssets": [{ path: "balanceSheet", field: "nonCurrentAssets" }],
  "jppfs_cor:NonCurrentAssets": [{ path: "balanceSheet", field: "nonCurrentAssets" }],
  
  "jppfs_cor:PropertyPlantAndEquipment": [{ path: "balanceSheet", field: "tangibleAssets" }],
  "jppfs_cor:PropertyPlantAndEquipmentIFRS": [{ path: "balanceSheet", field: "tangibleAssets" }],
  
  "jppfs_cor:IntangibleAssets": [{ path: "balanceSheet", field: "intangibleAssets" }],
  "jppfs_cor:IntangibleAssetsIFRS": [{ path: "balanceSheet", field: "intangibleAssets" }],
  
  "jppfs_cor:InvestmentsAndOtherAssets": [{ path: "balanceSheet", field: "investments" }],
  
  // 投資有価証券（清原式NC用）
  "jppfs_cor:InvestmentSecurities": [{ path: "balanceSheet", field: "investmentSecurities" }],
  "jppfs_cor:SecuritiesInvestment": [{ path: "balanceSheet", field: "investmentSecurities" }],
  
  // 投資不動産
  "jppfs_cor:InvestmentProperty": [{ path: "balanceSheet", field: "investmentProperty" }],
  "jppfs_cor:RealEstateForInvestment": [{ path: "balanceSheet", field: "investmentProperty" }],
  
  // 有価証券（流動資産）
  "jppfs_cor:Securities": [{ path: "balanceSheet", field: "securities" }],
  "jppfs_cor:MarketableSecurities": [{ path: "balanceSheet", field: "securities" }],
  
  // 自己株式
  "jppfs_cor:TreasuryShares": [{ path: "balanceSheet", field: "treasuryShares" }],
  "jppfs_cor:TreasuryStock": [{ path: "balanceSheet", field: "treasuryShares" }],
  
  // 負債
  "jppfs_cor:Liabilities": [{ path: "balanceSheet", field: "totalLiabilities" }],
  "jppfs_cor:TotalLiabilities": [{ path: "balanceSheet", field: "totalLiabilities" }],
  "jppfs_cor:TotalLiabilitiesIFRS": [{ path: "balanceSheet", field: "totalLiabilities" }],
  
  "jppfs_cor:CurrentLiabilities": [{ path: "balanceSheet", field: "currentLiabilities" }],
  "jppfs_cor:NotesAndAccountsPayableTrade": [{ path: "balanceSheet", field: "accountsPayable" }],
  "jppfs_cor:TradeAndOtherPayables": [{ path: "balanceSheet", field: "accountsPayable" }],
  
  "jppfs_cor:ShortTermLoansPayable": [{ path: "balanceSheet", field: "shortTermDebt" }],
  "jppfs_cor:ShortTermBorrowings": [{ path: "balanceSheet", field: "shortTermDebt" }],
  
  "jppfs_cor:NoncurrentLiabilities": [{ path: "balanceSheet", field: "nonCurrentLiabilities" }],
  "jppfs_cor:NonCurrentLiabilities": [{ path: "balanceSheet", field: "nonCurrentLiabilities" }],
  
  "jppfs_cor:LongTermLoansPayable": [{ path: "balanceSheet", field: "longTermDebt" }],
  "jppfs_cor:LongTermBorrowings": [{ path: "balanceSheet", field: "longTermDebt" }],
  "jppfs_cor:BondsPayable": [{ path: "balanceSheet", field: "longTermDebt" }],
  
  // 純資産
  "jppfs_cor:NetAssets": [{ path: "balanceSheet", field: "netAssets" }],
  "jppfs_cor:TotalEquity": [{ path: "balanceSheet", field: "netAssets" }],
  "jppfs_cor:TotalEquityIFRS": [{ path: "balanceSheet", field: "netAssets" }],
  
  "jppfs_cor:ShareholdersEquity": [{ path: "balanceSheet", field: "shareholdersEquity" }],
  "jppfs_cor:EquityAttributableToOwnersOfParent": [{ path: "balanceSheet", field: "shareholdersEquity" }],
  
  "jppfs_cor:RetainedEarnings": [{ path: "balanceSheet", field: "retainedEarnings" }],
  "jppfs_cor:RetainedEarningsIFRS": [{ path: "balanceSheet", field: "retainedEarnings" }],
  
  // ========== キャッシュフロー計算書 ==========
  // 営業キャッシュフロー
  "jppfs_cor:NetCashProvidedByUsedInOperatingActivities": [{ path: "cashFlow", field: "operatingCF" }],
  "jppfs_cor:CashFlowsFromUsedInOperatingActivities": [{ path: "cashFlow", field: "operatingCF" }],
  "jppfs_cor:CashFlowsFromOperatingActivities": [{ path: "cashFlow", field: "operatingCF" }],
  "jppfs_cor:CashFlowsFromUsedInOperatingActivitiesIFRS": [{ path: "cashFlow", field: "operatingCF" }],
  
  // 投資キャッシュフロー
  "jppfs_cor:NetCashProvidedByUsedInInvestingActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:NetCashProvidedByUsedInInvestmentActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:CashFlowsFromUsedInInvestingActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:CashFlowsFromUsedInInvestmentActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:CashFlowsFromInvestingActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:CashFlowsFromInvestmentActivities": [{ path: "cashFlow", field: "investingCF" }],
  "jppfs_cor:CashFlowsFromUsedInInvestingActivitiesIFRS": [{ path: "cashFlow", field: "investingCF" }],
  
  // 財務キャッシュフロー
  "jppfs_cor:NetCashProvidedByUsedInFinancingActivities": [{ path: "cashFlow", field: "financingCF" }],
  "jppfs_cor:CashFlowsFromUsedInFinancingActivities": [{ path: "cashFlow", field: "financingCF" }],
  "jppfs_cor:CashFlowsFromFinancingActivities": [{ path: "cashFlow", field: "financingCF" }],
  "jppfs_cor:CashFlowsFromUsedInFinancingActivitiesIFRS": [{ path: "cashFlow", field: "financingCF" }],
  
  // 期末現金残高
  "jppfs_cor:CashAndCashEquivalentsAtEndOfPeriod": [{ path: "cashFlow", field: "cashEndOfPeriod" }],
  "jppfs_cor:CashAndCashEquivalentsAtEnd": [{ path: "cashFlow", field: "cashEndOfPeriod" }],
  
  // ========== 配当情報 ==========
  // 1株当たり配当金
  "jppfs_cor:DividendPerShare": [{ path: "dividend", field: "annualDividendPerShare" }],
  "jppfs_cor:DividendPaidPerShare": [{ path: "dividend", field: "annualDividendPerShare" }],
  "jppfs_cor:AnnualDividendPerShare": [{ path: "dividend", field: "annualDividendPerShare" }],
  "jppfs_cor:TotalDividendPaidPerShare": [{ path: "dividend", field: "annualDividendPerShare" }],
  
  // 中間配当
  "jppfs_cor:InterimDividendPerShare": [{ path: "dividend", field: "interimDividendPerShare" }],
  "jppfs_cor:InterimDividendPaidPerShare": [{ path: "dividend", field: "interimDividendPerShare" }],
  
  // 期末配当
  "jppfs_cor:FinalDividendPerShare": [{ path: "dividend", field: "finalDividendPerShare" }],
  "jppfs_cor:YearEndDividendPerShare": [{ path: "dividend", field: "finalDividendPerShare" }],
  "jppfs_cor:FinalDividendPaidPerShare": [{ path: "dividend", field: "finalDividendPerShare" }],
  
  // 配当金支払総額
  "jppfs_cor:DividendsPaid": [{ path: "dividend", field: "totalDividendPaid" }],
  "jppfs_cor:DividendsPaidToOwnersOfParent": [{ path: "dividend", field: "totalDividendPaid" }],
  "jppfs_cor:CashDividendsPaid": [{ path: "dividend", field: "totalDividendPaid" }],
  
  // ========== EPS追加タグ ==========
  "jppfs_cor:NetIncomePerShare": [{ path: "incomeStatement", field: "eps" }],
  "jppfs_cor:EarningsPerShare": [{ path: "incomeStatement", field: "eps" }],
  "jpdei_cor:BasicEarningsLossPerShareDEI": [{ path: "incomeStatement", field: "eps" }],
  
  // jpcrp_cor プレフィックス（有価証券報告書の経理の状況）
  "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults": [{ path: "incomeStatement", field: "eps" }],
  "jpcrp_cor:DilutedEarningsPerShareSummaryOfBusinessResults": [{ path: "incomeStatement", field: "eps" }],
  
  // 配当金（jpcrp_cor）
  "jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults": [{ path: "dividend", field: "annualDividendPerShare" }],
  "jpcrp_cor:AnnualDividendPerShareSummaryOfBusinessResults": [{ path: "dividend", field: "annualDividendPerShare" }],
  "jpcrp_cor:InterimDividendPaidPerShareSummaryOfBusinessResults": [{ path: "dividend", field: "interimDividendPerShare" }],
  "jpcrp_cor:YearEndDividendPerShareSummaryOfBusinessResults": [{ path: "dividend", field: "finalDividendPerShare" }],
  
  // 配当金支払（キャッシュフロー計算書から）
  "jppfs_cor:CashDividendsPaidFinCF": [{ path: "dividend", field: "totalDividendPaid" }],
  "jppfs_cor:DividendsPaidFinCF": [{ path: "dividend", field: "totalDividendPaid" }],

  // ========== バリュエーション指標（主要な経営指標等の推移） ==========
  // PER（株価収益率）
  "jpcrp_cor:PriceEarningsRatioSummaryOfBusinessResults": [{ path: "valuation", field: "per" }],
  "jpcrp_cor:PriceEarningsRatio": [{ path: "valuation", field: "per" }],

  // PBR（株価純資産倍率）
  "jpcrp_cor:PriceBookValueRatioSummaryOfBusinessResults": [{ path: "valuation", field: "pbr" }],
  "jpcrp_cor:PriceBookValueRatio": [{ path: "valuation", field: "pbr" }],

  // BPS（1株当たり純資産）
  "jpcrp_cor:BookValuePerShareSummaryOfBusinessResults": [{ path: "valuation", field: "bps" }],
  "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults": [{ path: "valuation", field: "bps" }],
  "jpcrp_cor:NetAssetsPerShare": [{ path: "valuation", field: "bps" }],
  "jppfs_cor:NetAssetsPerShare": [{ path: "valuation", field: "bps" }],

  // ========== IFRS（jpigp_cor名前空間。IFRS適用会社の本表はこちら） ==========
  "jpigp_cor:RevenueIFRS": [{ path: "incomeStatement", field: "revenue" }],
  "jpigp_cor:NetSalesIFRS": [{ path: "incomeStatement", field: "revenue" }],
  "jpigp_cor:SalesRevenuesIFRS": [{ path: "incomeStatement", field: "revenue" }],
  "jpigp_cor:GrossProfitIFRS": [{ path: "incomeStatement", field: "grossProfit" }],
  "jpigp_cor:OperatingProfitLossIFRS": [{ path: "incomeStatement", field: "operatingIncome" }],
  "jpigp_cor:ProfitLossBeforeTaxIFRS": [{ path: "incomeStatement", field: "ordinaryIncome" }],
  "jpigp_cor:ProfitLossAttributableToOwnersOfParentIFRS": [{ path: "incomeStatement", field: "netIncome" }],
  "jpigp_cor:BasicEarningsLossPerShareIFRS": [{ path: "incomeStatement", field: "eps" }],
  "jpigp_cor:BasicAndDilutedEarningsLossPerShareIFRS": [{ path: "incomeStatement", field: "eps" }],
  "jpigp_cor:CostOfSalesIFRS": [{ path: "incomeStatement", field: "costOfSales" }],
  "jpigp_cor:AssetsIFRS": [{ path: "balanceSheet", field: "totalAssets" }],
  "jpigp_cor:CurrentAssetsIFRS": [{ path: "balanceSheet", field: "currentAssets" }],
  "jpigp_cor:CashAndCashEquivalentsIFRS": [{ path: "balanceSheet", field: "cashAndDeposits" }],
  "jpigp_cor:InventoriesIFRS": [{ path: "balanceSheet", field: "inventories" }],
  "jpigp_cor:PropertyPlantAndEquipmentIFRS": [{ path: "balanceSheet", field: "tangibleAssets" }],
  "jpigp_cor:IntangibleAssetsIFRS": [{ path: "balanceSheet", field: "intangibleAssets" }],
  "jpigp_cor:NonCurrentAssetsIFRS": [{ path: "balanceSheet", field: "nonCurrentAssets" }],
  "jpigp_cor:LiabilitiesIFRS": [{ path: "balanceSheet", field: "totalLiabilities" }],
  "jpigp_cor:CurrentLiabilitiesIFRS": [{ path: "balanceSheet", field: "currentLiabilities" }],
  "jpigp_cor:NonCurrentLiabilitiesIFRS": [{ path: "balanceSheet", field: "nonCurrentLiabilities" }],
  "jpigp_cor:EquityIFRS": [{ path: "balanceSheet", field: "netAssets" }],
  "jpigp_cor:EquityAttributableToOwnersOfParentIFRS": [{ path: "balanceSheet", field: "shareholdersEquity" }],
  "jpigp_cor:RetainedEarningsIFRS": [{ path: "balanceSheet", field: "retainedEarnings" }],
  "jpigp_cor:NetCashProvidedByUsedInOperatingActivitiesIFRS": [{ path: "cashFlow", field: "operatingCF" }],
  "jpigp_cor:NetCashProvidedByUsedInInvestingActivitiesIFRS": [{ path: "cashFlow", field: "investingCF" }],
  "jpigp_cor:NetCashProvidedByUsedInFinancingActivitiesIFRS": [{ path: "cashFlow", field: "financingCF" }],
  "jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults": [{ path: "incomeStatement", field: "eps" }],
  "jpcrp_cor:EquityAttributableToOwnersOfParentPerShareIFRSSummaryOfBusinessResults": [{ path: "valuation", field: "bps" }],
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

    const facts = new Map<string, Fact[]>();
    const contextEnds = new Map<string, string>();

    // メインのXBRLファイルを解析
    for (const xbrlPath of xbrlFiles) {
      const file = zip.file(xbrlPath);
      if (!file) continue;

      const content = await file.async("string");
      const parsed = parser.parse(content);

      // XBRLのルート要素を探す
      const root = parsed["xbrli:xbrl"] || parsed["xbrl"] || parsed;
      if (!root) continue;

      // 事実（値＋コンテキスト）を収集。解決は全ファイル読了後にまとめて行う
      collectFacts(root, facts);
      collectContextEnds(root, contextEnds);

      // 会社名を取得
      const companyName = extractTextValue(root, ["jpdei_cor:FilerNameInJapaneseDEI", "FilerNameInJapaneseDEI"]);
      if (companyName) fs.companyName = companyName;

      // 証券コードを取得
      const secCode = extractTextValue(root, ["jpdei_cor:SecurityCodeDEI", "SecurityCodeDEI"]);
      if (secCode) fs.secCode = secCode;

      // 会計期間を取得
      const periodEnd = extractTextValue(root, ["jpdei_cor:CurrentFiscalYearEndDateDEI", "CurrentFiscalYearEndDateDEI"]);
      if (periodEnd) {
        fs.fiscalYear = periodEnd.substring(0, 4);
        // 決算月を抽出（例: 2025-03-31 → 3）
        const match = periodEnd.match(/-(\d{2})-/);
        if (match) {
          fs.accountingInfo.fiscalYearEndMonth = parseInt(match[1], 10);
        }
      }

      // ===== 日本特化: 会計基準の自動判定 =====
      
      // 会計基準（JGAAP/IFRS/US-GAAP）
      const accountingStd = extractTextValue(root, ["jpdei_cor:AccountingStandardsDEI", "AccountingStandardsDEI"]);
      if (accountingStd) {
        if (accountingStd.includes("Japan") || accountingStd.includes("日本")) {
          fs.accountingInfo.standard = "JGAAP";
        } else if (accountingStd.includes("IFRS") || accountingStd.includes("国際")) {
          fs.accountingInfo.standard = "IFRS";
        } else if (accountingStd.includes("US") || accountingStd.includes("米国")) {
          fs.accountingInfo.standard = "US-GAAP";
        }
      }

      // 連結/単体の判定
      const isConsolidated = extractTextValue(root, [
        "jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI",
        "WhetherConsolidatedFinancialStatementsArePreparedDEI"
      ]);
      if (isConsolidated) {
        const consolidatedStr = String(isConsolidated).toLowerCase();
        if (consolidatedStr === "true" || consolidatedStr.includes("連結") || consolidatedStr.includes("yes")) {
          fs.accountingInfo.consolidation = "連結";
        } else if (consolidatedStr === "false" || consolidatedStr.includes("単体") || consolidatedStr.includes("no")) {
          fs.accountingInfo.consolidation = "単体";
        }
      }

      // 業種コードから業種を判定（簡易版）
      const industryCode = extractTextValue(root, [
        "jpdei_cor:IndustryCodeWhenConsolidatedFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI"
      ]);
      if (industryCode) {
        fs.accountingInfo.industry = detectIndustry(industryCode);
      }
    }

    resolveFacts(fs, facts, contextEnds);

    // 指標を計算
    calculateMetrics(fs);
    
    // サマリーを生成
    generateSummary(fs);

  } catch (error) {
    console.error("Error parsing XBRL:", error);
  }

  return fs;
}

// ========== コンテキスト解決 ==========

interface Fact {
  ctx: string;
  value: number;
}

// 会社独自タグの売上（例: トヨタ OperatingRevenuesIFRSKeyFinancialData）をまとめる擬似タグ
const CUSTOM_REVENUE_TAG = "__customRevenueSummary";
const CUSTOM_REVENUE_RE = /^jpcrp\d+-\w+_E\d+-\d+:\w*(?:Revenues?|NetSales)\w*(?:SummaryOfBusinessResults|KeyFinancialData)$/;

// 主要な経営指標等の推移（有報の5期分）
const HISTORY_TAGS: Record<keyof Omit<HistoryEntry, "periodEnd">, string[]> = {
  revenue: [
    "jpcrp_cor:NetSalesSummaryOfBusinessResults",
    "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults",
    "jpcrp_cor:RevenuesUSGAAPSummaryOfBusinessResults",
    "jpcrp_cor:OperatingRevenue1SummaryOfBusinessResults",
    "jpcrp_cor:OperatingRevenue2SummaryOfBusinessResults",
    "jpcrp_cor:NetSalesOfCompletedConstructionContractsSummaryOfBusinessResults",
    CUSTOM_REVENUE_TAG,
  ],
  ordinaryIncome: [
    "jpcrp_cor:OrdinaryIncomeLossSummaryOfBusinessResults",
    "jpcrp_cor:ProfitLossBeforeTaxIFRSSummaryOfBusinessResults",
    "jpcrp_cor:ProfitLossBeforeTaxUSGAAPSummaryOfBusinessResults",
  ],
  netIncome: [
    "jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
    "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
    "jpcrp_cor:NetIncomeLossAttributableToOwnersOfParentUSGAAPSummaryOfBusinessResults",
    "jpcrp_cor:NetIncomeLossSummaryOfBusinessResults",
  ],
  eps: [
    "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults",
    "jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults",
    "jpcrp_cor:BasicEarningsLossPerShareUSGAAPSummaryOfBusinessResults",
  ],
  bps: [
    "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults",
    "jpcrp_cor:EquityAttributableToOwnersOfParentPerShareIFRSSummaryOfBusinessResults",
  ],
  roe: [
    "jpcrp_cor:RateOfReturnOnEquitySummaryOfBusinessResults",
    "jpcrp_cor:RateOfReturnOnEquityIFRSSummaryOfBusinessResults",
    "jpcrp_cor:RateOfReturnOnEquityUSGAAPSummaryOfBusinessResults",
  ],
  totalAssets: [
    "jpcrp_cor:TotalAssetsSummaryOfBusinessResults",
    "jpcrp_cor:TotalAssetsIFRSSummaryOfBusinessResults",
    "jpcrp_cor:TotalAssetsUSGAAPSummaryOfBusinessResults",
  ],
  netAssets: [
    "jpcrp_cor:NetAssetsSummaryOfBusinessResults",
    "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
  ],
  operatingCF: [
    "jpcrp_cor:NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults",
  ],
  dividendPerShare: ["jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults"],
  sharesIssued: ["jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults"],
};

// 親会社単位でしか開示されない項目（単体コンテキストへのフォールバックを許可）
const PARENT_ONLY_HISTORY_FIELDS = new Set(["dividendPerShare", "sharesIssued"]);

const SHARES_ISSUED_TAGS = [
  "jpcrp_cor:NumberOfIssuedSharesAsOfFilingDateIssuedSharesTotalNumberOfSharesEtc",
  "jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults",
];
const TREASURY_SHARES_TAGS = [
  "jpcrp_cor:TotalNumberOfSharesHeldTreasurySharesEtc",
  "jpcrp_cor:NumberOfSharesHeldInOwnNameTreasurySharesEtc",
];

const NON_CONSOLIDATED = "_NonConsolidatedMember";

const PERIOD_CONTEXTS = {
  annual: { duration: "CurrentYearDuration", instant: "CurrentYearInstant", priorDuration: "Prior1YearDuration" },
  interim: { duration: "InterimDuration", instant: "InterimInstant", priorDuration: "Prior1InterimDuration" },
  quarterly: { duration: "CurrentYTDDuration", instant: "CurrentQuarterInstant", priorDuration: "Prior1YTDDuration" },
} as const;

function toNumber(item: any): number | null {
  const raw = item !== null && typeof item === "object" ? item["#text"] : item;
  if (raw === undefined || raw === null || raw === "") return null;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

function collectFacts(root: any, facts: Map<string, Fact[]>): void {
  const tags = new Set<string>([
    ...Object.keys(VALUE_EXTRACTORS),
    ...Object.values(HISTORY_TAGS).flat(),
    ...SHARES_ISSUED_TAGS,
    ...TREASURY_SHARES_TAGS,
  ]);
  const push = (key: string, raw: any) => {
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      const ctx = item?.["@_contextRef"];
      const value = toNumber(item);
      if (!ctx || value === null) continue;
      if (!facts.has(key)) facts.set(key, []);
      facts.get(key)!.push({ ctx, value });
    }
  };
  for (const tag of tags) {
    if (root[tag] !== undefined) push(tag, root[tag]);
  }
  for (const key of Object.keys(root)) {
    if (CUSTOM_REVENUE_RE.test(key)) push(CUSTOM_REVENUE_TAG, root[key]);
  }
}

function collectContextEnds(root: any, contextEnds: Map<string, string>): void {
  const raw = root["xbrli:context"];
  if (!raw) return;
  for (const c of Array.isArray(raw) ? raw : [raw]) {
    const period = c?.["xbrli:period"];
    const end = period?.["xbrli:endDate"] ?? period?.["xbrli:instant"];
    if (c?.["@_id"] && end) contextEnds.set(c["@_id"], String(end));
  }
}

/** 指定コンテキスト（完全一致、優先順）の値を取得 */
function pick(facts: Map<string, Fact[]>, tag: string, ctxs: string[]): number | null {
  const list = facts.get(tag);
  if (!list) return null;
  for (const ctx of ctxs) {
    const hit = list.find((f) => f.ctx === ctx);
    if (hit) return hit.value;
  }
  return null;
}

function detectPeriodType(facts: Map<string, Fact[]>): FinancialStatements["periodType"] {
  const ctxs = new Set<string>();
  for (const list of facts.values()) for (const f of list) ctxs.add(f.ctx);
  if (ctxs.has("InterimDuration")) return "interim";
  if (ctxs.has("CurrentYTDDuration")) return "quarterly";
  return "annual";
}

/**
 * 収集した事実をフィールドに割り当てる。
 * 当期は連結の当期コンテキストのみ採用し、無ければ単体（_NonConsolidatedMember）で補完。
 * Prior2〜4期やセグメント等のメンバー付きコンテキストは当期値に混入させない。
 */
function resolveFacts(fs: FinancialStatements, facts: Map<string, Fact[]>, contextEnds: Map<string, string>): void {
  fs.periodType = detectPeriodType(facts);
  const pc = PERIOD_CONTEXTS[fs.periodType];

  const assign = (ctxs: string[], target: (path: string) => Record<string, number | null> | null, pathFilter?: string) => {
    for (const [tag, extractors] of Object.entries(VALUE_EXTRACTORS)) {
      const value = pick(facts, tag, ctxs);
      if (value === null) continue;
      for (const extractor of extractors) {
        if (pathFilter && extractor.path !== pathFilter) continue;
        const obj = target(extractor.path);
        const field = extractor.field as string;
        if (obj && field in obj && obj[field] === null) obj[field] = value;
      }
    }
  };

  // 連結決算会社は単体値を混ぜない（配当は親会社単位なので例外）
  const consolidated = fs.accountingInfo.consolidation === "連結";
  const current = (path: string) => (fs as any)[path] as Record<string, number | null>;
  const currentCtxs = [pc.duration, pc.instant];
  assign(currentCtxs, current);
  assign(currentCtxs.map((c) => c + NON_CONSOLIDATED), current, consolidated ? "dividend" : undefined);

  // 前年同期（成長率用）
  const prior = () => fs.priorPeriod as Record<string, number | null>;
  assign([pc.priorDuration], prior, "incomeStatement");
  if (!consolidated) assign([pc.priorDuration + NON_CONSOLIDATED], prior, "incomeStatement");

  // 前期通期（半期・四半期のTTM用）
  if (fs.periodType !== "annual") {
    const fy = () => fs.priorFullYear as Record<string, number | null>;
    assign(["Prior1YearDuration"], fy, "incomeStatement");
    if (!consolidated) assign(["Prior1YearDuration" + NON_CONSOLIDATED], fy, "incomeStatement");
    // 半期・四半期のPLには前期通期が無いため、主要な経営指標等の推移から補完
    for (const field of ["revenue", "netIncome", "eps"] as const) {
      for (const tag of HISTORY_TAGS[field]) {
        fs.priorFullYear[field] ??= pick(facts, tag, ["Prior1YearDuration"]);
      }
    }
  }

  // 株式数
  const shareCtxs = ["FilingDateInstant", pc.instant, pc.instant + NON_CONSOLIDATED];
  for (const tag of SHARES_ISSUED_TAGS) {
    fs.shares.issued ??= pick(facts, tag, shareCtxs);
  }
  for (const tag of TREASURY_SHARES_TAGS) {
    fs.shares.treasury ??= pick(facts, tag, [pc.instant, "FilingDateInstant", pc.instant + NON_CONSOLIDATED]);
  }

  // 5期推移（有報のみ）
  if (fs.periodType === "annual") {
    const history: HistoryEntry[] = [];
    for (let n = 4; n >= 0; n--) {
      const dur = n === 0 ? "CurrentYearDuration" : `Prior${n}YearDuration`;
      const inst = n === 0 ? "CurrentYearInstant" : `Prior${n}YearInstant`;
      const entry: HistoryEntry = {
        periodEnd: contextEnds.get(dur) ?? contextEnds.get(inst) ?? null,
        revenue: null, ordinaryIncome: null, netIncome: null, eps: null, bps: null, roe: null,
        totalAssets: null, netAssets: null, operatingCF: null, dividendPerShare: null, sharesIssued: null,
      };
      for (const [field, tags] of Object.entries(HISTORY_TAGS) as [keyof typeof HISTORY_TAGS, string[]][]) {
        const ctxs = PARENT_ONLY_HISTORY_FIELDS.has(field)
          ? [dur, inst, dur + NON_CONSOLIDATED, inst + NON_CONSOLIDATED]
          : [dur, inst];
        for (const tag of tags) {
          const v = pick(facts, tag, ctxs);
          if (v !== null) { entry[field] = v; break; }
        }
      }
      // ROEは比率（0.392）で開示されるため%に変換
      if (entry.roe !== null) entry.roe = Math.round(entry.roe * 10000) / 100;
      const hasData = Object.entries(entry).some(([k, v]) => k !== "periodEnd" && v !== null);
      if (hasData) history.push(entry);
    }
    fs.history = history;

    // 本表が会社独自タグで取れなかった場合は推移表の当期値で補完
    const latest = history[history.length - 1];
    if (latest && latest.periodEnd === (contextEnds.get("CurrentYearDuration") ?? latest.periodEnd)) {
      fs.incomeStatement.revenue ??= latest.revenue;
      fs.incomeStatement.netIncome ??= latest.netIncome;
      fs.incomeStatement.eps ??= latest.eps;
      fs.balanceSheet.totalAssets ??= latest.totalAssets;
      fs.valuation.bps ??= latest.bps;
    }
  }
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
 * 業種コードから業種名を判定
 */
function detectIndustry(code: string): string | null {
  const industryMap: Record<string, string> = {
    // 金融業
    "CNA": "銀行業",
    "CNB": "証券業",
    "CNC": "保険業",
    "CND": "その他金融業",
    // 製造業
    "CMA": "食品",
    "CMB": "繊維",
    "CMC": "パルプ・紙",
    "CMD": "化学",
    "CME": "医薬品",
    "CMF": "石油・石炭",
    "CMG": "ゴム",
    "CMH": "ガラス・土石",
    "CMI": "鉄鋼",
    "CMJ": "非鉄金属",
    "CMK": "金属製品",
    "CML": "機械",
    "CMM": "電気機器",
    "CMN": "輸送用機器",
    "CMO": "精密機器",
    "CMP": "その他製造業",
    // サービス業
    "CSA": "建設業",
    "CSB": "不動産業",
    "CSC": "陸運業",
    "CSD": "海運業",
    "CSE": "空運業",
    "CSF": "倉庫・運輸",
    "CSG": "情報・通信",
    "CSH": "電気・ガス",
    "CSI": "小売業",
    "CSJ": "卸売業",
    "CSK": "サービス業",
  };
  
  return industryMap[code] || null;
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

  // ======== 判断支援: シグナル評価 ========
  const evaluateMetricSignal = (
    value: number | null,
    benchmarks: { excellent: number; good: number; poor: number },
    reverse: boolean = false
  ): { signal: "POSITIVE" | "NEUTRAL" | "NEGATIVE"; context: string } | null => {
    if (value === null) return null;
    if (reverse) {
      if (value <= benchmarks.excellent) return { signal: "POSITIVE", context: "低負債で健全" };
      if (value <= benchmarks.good) return { signal: "NEUTRAL", context: "標準的な水準" };
      return { signal: "NEGATIVE", context: "高めの水準" };
    }
    if (value >= benchmarks.excellent) return { signal: "POSITIVE", context: "業界平均を大きく上回る" };
    if (value >= benchmarks.good) return { signal: "NEUTRAL", context: "業界平均並み" };
    return { signal: "NEGATIVE", context: "業界平均を下回る" };
  };

  // 健全性スコア計算
  const calculateHealthScore = (): { score: number; grade: string } => {
    let totalScore = 0;
    let count = 0;

    if (fs.metrics.roe !== null) {
      totalScore += Math.min(25, Math.max(0, fs.metrics.roe * 1.5));
      count++;
    }
    if (fs.metrics.roa !== null) {
      totalScore += Math.min(20, Math.max(0, fs.metrics.roa * 2));
      count++;
    }
    if (fs.metrics.operatingMargin !== null) {
      totalScore += Math.min(20, Math.max(0, fs.metrics.operatingMargin * 1.2));
      count++;
    }
    if (fs.metrics.currentRatio !== null) {
      totalScore += Math.min(15, Math.max(0, fs.metrics.currentRatio * 7.5));
      count++;
    }
    if (fs.metrics.debtToEquity !== null) {
      totalScore += Math.min(20, Math.max(0, 20 - fs.metrics.debtToEquity * 10));
      count++;
    }

    if (count === 0) return { score: 50, grade: "データ不足" };
    
    const score = Math.round((totalScore / (count * 20)) * 100);
    let grade: string;
    if (score >= 80) grade = "A (優良)";
    else if (score >= 60) grade = "B (良好)";
    else if (score >= 40) grade = "C (標準)";
    else if (score >= 20) grade = "D (注意)";
    else grade = "E (懸念)";

    return { score, grade };
  };

  const healthScore = calculateHealthScore();
  const roeSignal = evaluateMetricSignal(fs.metrics.roe, { excellent: 15, good: 10, poor: 5 });
  const roaSignal = evaluateMetricSignal(fs.metrics.roa, { excellent: 8, good: 5, poor: 2 });
  const marginSignal = evaluateMetricSignal(fs.metrics.operatingMargin, { excellent: 15, good: 8, poor: 3 });
  const debtSignal = evaluateMetricSignal(fs.metrics.debtToEquity, { excellent: 0.5, good: 1.0, poor: 2.0 }, true);

  // 総合シグナル判定
  const signals = [roeSignal, roaSignal, marginSignal, debtSignal].filter(s => s !== null);
  const positiveCount = signals.filter(s => s?.signal === "POSITIVE").length;
  const negativeCount = signals.filter(s => s?.signal === "NEGATIVE").length;
  
  let overallSignal: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  if (positiveCount >= 2 && negativeCount === 0) overallSignal = "POSITIVE";
  else if (negativeCount >= 2) overallSignal = "NEGATIVE";
  else overallSignal = "NEUTRAL";

  return {
    // ======== 判断サマリー（トークン効率重視） ========
    judgmentSummary: {
      healthScore: healthScore.score,
      healthGrade: healthScore.grade,
      overallSignal,
      per: fs.valuation.per ? `${fs.valuation.per.toFixed(1)}倍` : null,
      pbr: fs.valuation.pbr ? `${fs.valuation.pbr.toFixed(2)}倍` : null,
      revenueGrowth: fs.growth.revenueGrowth !== null ? `${fs.growth.revenueGrowth > 0 ? "+" : ""}${fs.growth.revenueGrowth.toFixed(1)}%` : null,
      epsGrowth: fs.growth.epsGrowth !== null ? `${fs.growth.epsGrowth > 0 ? "+" : ""}${fs.growth.epsGrowth.toFixed(1)}%` : null,
      keyHighlights: fs.summary.highlights.slice(0, 3),
      concerns: fs.summary.risks.slice(0, 3),
      actionHint: overallSignal === "POSITIVE"
        ? "詳細分析の価値あり"
        : overallSignal === "NEGATIVE"
          ? "慎重な追加調査が必要"
          : "リスク要因の詳細確認を推奨",
    },

    // ======== シグナル付き指標 ========
    signalMetrics: {
      roe: {
        value: fs.metrics.roe ? `${fs.metrics.roe}%` : null,
        signal: roeSignal?.signal ?? null,
        context: roeSignal?.context ?? null,
      },
      roa: {
        value: fs.metrics.roa ? `${fs.metrics.roa}%` : null,
        signal: roaSignal?.signal ?? null,
        context: roaSignal?.context ?? null,
      },
      operatingMargin: {
        value: fs.metrics.operatingMargin ? `${fs.metrics.operatingMargin}%` : null,
        signal: marginSignal?.signal ?? null,
        context: marginSignal?.context ?? null,
      },
      debtToEquity: {
        value: fs.metrics.debtToEquity,
        signal: debtSignal?.signal ?? null,
        context: debtSignal?.context ?? null,
      },
    },

    // ======== 基本情報 ========
    company: {
      name: fs.companyName,
      secCode: fs.secCode,
      fiscalYear: fs.fiscalYear,
      reportType: fs.reportType,
    },
    
    // ======== 日本特化: 会計基準情報 ========
    accountingInfo: {
      standard: fs.accountingInfo.standard,
      standardLabel: fs.accountingInfo.standard === "JGAAP" ? "日本基準" 
        : fs.accountingInfo.standard === "IFRS" ? "国際会計基準"
        : fs.accountingInfo.standard === "US-GAAP" ? "米国基準"
        : "不明",
      consolidation: fs.accountingInfo.consolidation,
      industry: fs.accountingInfo.industry,
      fiscalYearEndMonth: fs.accountingInfo.fiscalYearEndMonth 
        ? `${fs.accountingInfo.fiscalYearEndMonth}月決算` 
        : null,
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
    
    // ======== バリュエーション（EDINET報告値） ========
    valuation: {
      per: fs.valuation.per ? `${fs.valuation.per.toFixed(1)}倍` : null,
      pbr: fs.valuation.pbr ? `${fs.valuation.pbr.toFixed(2)}倍` : null,
      bps: fs.valuation.bps ? `¥${fs.valuation.bps.toFixed(1)}` : null,
      marketCap: toOku(fs.valuation.marketCap),
      epsBasis: fs.periodType === "annual" ? "通期実績EPS" : "TTM EPS（前期通期 − 前年同期累計 + 当期累計）",
      ttmEps: fs.trailing.eps,
      sharesOutstanding: fs.shares.outstanding,
      note: "PER/PBR/時価総額はJ-Quants株価で再計算（取得できない場合は有報記載値）",
    },

    // ======== 成長率（前期比） ========
    growth: {
      revenueGrowth: fs.growth.revenueGrowth !== null ? `${fs.growth.revenueGrowth > 0 ? "+" : ""}${fs.growth.revenueGrowth.toFixed(1)}%` : null,
      operatingIncomeGrowth: fs.growth.operatingIncomeGrowth !== null ? `${fs.growth.operatingIncomeGrowth > 0 ? "+" : ""}${fs.growth.operatingIncomeGrowth.toFixed(1)}%` : null,
      netIncomeGrowth: fs.growth.netIncomeGrowth !== null ? `${fs.growth.netIncomeGrowth > 0 ? "+" : ""}${fs.growth.netIncomeGrowth.toFixed(1)}%` : null,
      epsGrowth: fs.growth.epsGrowth !== null ? `${fs.growth.epsGrowth > 0 ? "+" : ""}${fs.growth.epsGrowth.toFixed(1)}%` : null,
    },

    aiSummary: fs.summary,

    dividend: {
      annualDividendPerShare: fs.dividend.annualDividendPerShare ? `¥${fs.dividend.annualDividendPerShare}` : null,
      interimDividendPerShare: fs.dividend.interimDividendPerShare ? `¥${fs.dividend.interimDividendPerShare}` : null,
      finalDividendPerShare: fs.dividend.finalDividendPerShare ? `¥${fs.dividend.finalDividendPerShare}` : null,
      payoutRatio: fs.dividend.payoutRatio ? `${fs.dividend.payoutRatio}%` : null,
      totalDividendPaid: toOku(fs.dividend.totalDividendPaid),
    },
    
    rawData: fs, // 元データも含める
  };
}
