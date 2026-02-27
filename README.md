# japan-edinet-mcp

🇯🇵 日本株決算データMCPサーバー

EDINET（金融庁の電子開示システム）と連携し、AIエージェントに日本企業の財務データを提供します。

## ✨ 特徴

- **EDINET完全連携**: 有価証券報告書、四半期報告書、臨時報告書を自動取得
- **XBRL自動解析**: 財務諸表（BS/PL/CF）を構造化データに変換
- **財務指標自動計算**: ROE、ROA、営業利益率、D/Eレシオ等
- **AIサマリー生成**: 投資判断に役立つハイライト・リスク分析
- **同業他社比較**: 複数企業の財務指標を比較

## 🛠 提供ツール

| ツール | 説明 |
|--------|------|
| `health_check` | サーバー稼働確認 |
| `get_daily_filings` | 指定日の開示書類一覧 |
| `get_company_filings` | 企業別の開示書類検索 |
| `search_disclosures` | キーワード・条件検索 |
| `analyze_financials` | **財務諸表の詳細分析** |
| `compare_companies` | **複数企業の比較分析** |

## 📊 analyze_financials の出力例

```json
{
  "company": {
    "name": "トヨタ自動車株式会社",
    "secCode": "7203",
    "fiscalYear": "2024"
  },
  "incomeStatement": {
    "revenue": "372,345.2億円",
    "operatingIncome": "28,562.1億円",
    "netIncome": "23,489.5億円"
  },
  "metrics": {
    "roe": "15.2%",
    "operatingMargin": "7.7%"
  },
  "aiSummary": {
    "highlights": [
      "ROE 15.2%と高収益性（優良基準15%超）",
      "フリーCF 1.5兆円とキャッシュ創出力あり"
    ],
    "risks": ["顕著なリスク要因なし"],
    "outlook": "財務健全性が高く、成長投資余力あり。ポジティブ評価。"
  }
}
```

## 🚀 クイックスタート

### 1. インストール

```bash
git clone https://github.com/shinogw/japan-edinet-mcp.git
cd japan-edinet-mcp
npm install
```

### 2. EDINET APIキー取得

1. [EDINET API登録ページ](https://api.edinet-fsa.go.jp/api/auth/index.aspx?mode=1)にアクセス
2. ユーザー登録してAPIキーを発行

### 3. 環境設定

```bash
cp .env.example .env
# .envにEDINET_API_KEYを設定
```

### 4. ビルド・起動

```bash
npm run build
npm start
```

### 5. Claude Desktopに設定

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "japan-edinet": {
      "command": "node",
      "args": ["/path/to/japan-edinet-mcp/dist/index.js"],
      "env": {
        "EDINET_API_KEY": "your_api_key"
      }
    }
  }
}
```

## 💬 使用例

### 企業の財務分析

```
トヨタ自動車（7203）の最新決算を分析して
```

### 同業他社比較

```
トヨタ、ホンダ、日産の財務指標を比較して
```

### 最新の開示書類を確認

```
今日の有価証券報告書の一覧を教えて
```

## 💰 価格プラン（予定）

| プラン | 価格 | 機能 |
|--------|------|------|
| Basic | $99/月 | 基本データアクセス |
| Professional | $180/月 | AI分析機能 |
| Enterprise | $500/月 | 投資推奨機能 |

## 📁 プロジェクト構造

```
japan-edinet-mcp/
├── src/
│   ├── index.ts          # MCPサーバーメイン
│   ├── api/
│   │   └── edinet.ts     # EDINET APIクライアント
│   └── parsers/
│       ├── xbrl.ts       # 財務諸表データ構造
│       └── xbrl-parser.ts # XBRL解析エンジン
├── dist/                  # ビルド出力
└── package.json
```

## 🔒 法的情報

- **投資助言業登録**: 本サービスは投資助言業登録に基づいて運営されます
- **免責事項**: 提供されるデータは投資判断の参考情報であり、投資成果を保証するものではありません

## 📝 ライセンス

MIT

## 🤝 コントリビュート

Issue、Pull Request歓迎します。

---

Built with ❤️ by [shinogw](https://github.com/shinogw)
