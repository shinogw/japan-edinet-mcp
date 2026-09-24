#!/bin/bash
# japan-edinet-mcp 起動ラッパー
# dotenv は process.cwd() の .env を読むため、cwd を固定する必要がある
cd "$(dirname "$0")" || exit 1
exec node dist/index.js
