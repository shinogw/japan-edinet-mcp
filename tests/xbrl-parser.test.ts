/**
 * XBRLパーサーの回帰テスト
 * フィクスチャは scripts/make-fixture.mjs で実書類から生成（値は各社の開示と照合済み）
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { parseXbrlFromZip } from "../src/parsers/xbrl-parser.js";
import { buildTrendAnalysis } from "../src/analysis/trend-analysis.js";

async function loadFixture(docId: string) {
  const zip = new JSZip();
  zip.file(`XBRL/PublicDoc/${docId}.xbrl`, readFileSync(`tests/fixtures/${docId}.xbrl`, "utf8"));
  return parseXbrlFromZip(await zip.generateAsync({ type: "arraybuffer" }));
}

describe("7068 フィードフォースG 有価証券報告書（JGAAP・連結・5月決算）", async () => {
  const fs = await loadFixture("S100YYE5");

  it("当期EPSに過年度（Prior4Year）や単体の値が混入しない", () => {
    expect(fs.periodType).toBe("annual");
    expect(fs.incomeStatement.eps).toBe(59.58);
    expect(fs.priorPeriod.eps).toBe(39.69);
    expect(fs.trailing.eps).toBe(59.58);
  });

  it("PL・BSの当期値", () => {
    expect(fs.incomeStatement.revenue).toBe(4_912_000_000);
    expect(fs.incomeStatement.operatingIncome).toBe(1_981_000_000);
    expect(fs.incomeStatement.netIncome).toBe(1_445_000_000);
    expect(fs.valuation.bps).toBe(153.85);
  });

  it("株式数は提出日時点の発行済株式数", () => {
    expect(fs.shares.issued).toBe(23_943_258);
    expect(fs.shares.outstanding).toBe(23_943_258);
  });

  it("配当性向とフリーCFの億円表記", () => {
    expect(fs.dividend.annualDividendPerShare).toBe(15);
    expect(fs.dividend.payoutRatio).toBe(25.18);
    expect(fs.summary.highlights).toContain("フリーCF 13.7億円とキャッシュ創出力あり");
  });

  it("主要な経営指標等の推移を5期分取得", () => {
    expect(fs.history.map((h) => h.periodEnd)).toEqual([
      "2022-05-31", "2023-05-31", "2024-05-31", "2025-05-31", "2026-05-31",
    ]);
    expect(fs.history.map((h) => h.eps)).toEqual([23.2, 4.34, 18.23, 39.69, 59.58]);
    expect(fs.history[4].roe).toBe(41.9);
    expect(fs.history[0].revenue).toBe(3_005_000_000);
  });

  it("トレンド分析は実データに基づく", () => {
    const t = buildTrendAnalysis("フィードフォースグループ", "70680", fs.history);
    expect(t.revenue.trend).toBe("GROWTH");
    expect(t.revenue.cagr).toBe(13.07);
    expect(t.netIncome.trend).toBe("VOLATILE");
    expect(t.overallTrend).toBe("EXPANDING");
  });
});

describe("3921 ネオジャパン 半期報告書（JGAAP・連結・1月決算）", async () => {
  const fs = await loadFixture("S100Z1HQ");

  it("半期と判定し、TTM EPSを算出", () => {
    expect(fs.periodType).toBe("interim");
    expect(fs.incomeStatement.eps).toBe(67.59);
    expect(fs.priorPeriod.eps).toBe(63.53);
    expect(fs.priorFullYear.eps).toBe(129.18);
    expect(fs.trailing.eps).toBe(133.24); // 129.18 − 63.53 + 67.59
  });

  it("ROEはTTM純利益ベース（半期純利益のままにしない）", () => {
    expect(fs.priorFullYear.netIncome).toBe(1_809_529_000);
    expect(fs.metrics.roe).toBe(23.7);
  });

  it("自己株式を控除した株式数とBPS推定", () => {
    expect(fs.shares.issued).toBe(14_087_600);
    expect(fs.shares.treasury).toBe(69_700);
    expect(fs.shares.outstanding).toBe(14_017_900);
    expect(fs.valuation.bps).toBe(573.04);
  });

  it("半期報告書には5期推移が無い", () => {
    expect(fs.history).toEqual([]);
  });
});

describe("7203 トヨタ 有価証券報告書（IFRS・連結）", async () => {
  const fs = await loadFixture("S100Y8NY");

  it("IFRS（jpigp_cor）の連結値を取得し、単体JGAAPのEPSを混ぜない", () => {
    expect(fs.accountingInfo.standard).toBe("IFRS");
    expect(fs.incomeStatement.eps).toBe(295.25);
    expect(fs.incomeStatement.operatingIncome).toBe(3_766_216_000_000);
    expect(fs.incomeStatement.netIncome).toBe(3_848_098_000_000);
  });

  it("会社独自タグの売上を推移表から補完", () => {
    expect(fs.incomeStatement.revenue).toBe(50_684_952_000_000);
    expect(fs.history).toHaveLength(5);
    expect(fs.history.every((h) => h.revenue !== null)).toBe(true);
  });
});
