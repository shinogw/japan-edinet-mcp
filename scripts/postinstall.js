#!/usr/bin/env node

/**
 * Post-install script for japan-edinet-mcp
 * Shows setup instructions after npm install
 */

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    japan-edinet-mcp                           ║
║        Japanese Stock Financial Data MCP Server               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  🚀 Quick Start:                                              ║
║                                                               ║
║  1. Get EDINET API Key:                                       ║
║     https://api.edinet-fsa.go.jp/api/auth/index.aspx?mode=1   ║
║                                                               ║
║  2. Set environment variable:                                 ║
║     export EDINET_API_KEY=your_api_key                        ║
║                                                               ║
║  3. Run the server:                                           ║
║     npx japan-edinet-mcp                                      ║
║                                                               ║
║  📖 Documentation:                                            ║
║     https://github.com/shinogw/japan-edinet-mcp               ║
║                                                               ║
║  🛠 Available Tools (10):                                      ║
║     • analyze_financials - 財務分析                           ║
║     • get_investment_recommendation - 投資推奨                ║
║     • detect_earnings_revisions - 業績修正検出                ║
║     • detect_large_shareholders - 大量保有検出                ║
║     • detect_material_events - 重要事実検出                   ║
║     ... and more                                              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
