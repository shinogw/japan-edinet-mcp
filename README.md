# japan-edinet-mcp

日本株決算データMCPサーバー。EDINET連携で有価証券報告書・決算短信をAIエージェントに提供。

## 機能（予定）

| ツール | 説明 |
|--------|------|
| `get_company_filings` | 企業の開示書類一覧を取得 |
| `get_financial_statements` | 財務諸表（BS/PL/CF）を取得 |
| `get_segment_info` | セグメント情報を取得 |
| `search_disclosures` | 開示書類を検索 |
| `get_xbrl_data` | XBRLデータを構造化して取得 |

## 価格プラン（予定）

- **個人プラン**: $99/月
- **プロプラン**: $180/月
- **企業プラン**: $500/月

## 開発状況

🚧 開発中

## セットアップ

```bash
npm install
npm run build
```

## 環境変数

```
EDINET_API_KEY=your_api_key_here
```

## ライセンス

MIT
