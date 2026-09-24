/**
 * テスト用XBRLフィクスチャ生成
 * EDINETから書類を取得し、コンテキスト・DEI・数値ファクトだけを残した軽量XBRLを tests/fixtures/<docID>.xbrl に保存する
 *
 * 使い方: node scripts/make-fixture.mjs <docID> [<docID> ...]（.env の EDINET_API_KEY を使用）
 */
import "dotenv/config";
import JSZip from "jszip";
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("tests/fixtures", { recursive: true });

for (const docId of process.argv.slice(2)) {
  const res = await fetch(
    `https://api.edinet-fsa.go.jp/api/v2/documents/${docId}?type=1&Subscription-Key=${process.env.EDINET_API_KEY}`
  );
  if (!res.ok) throw new Error(`${docId}: HTTP ${res.status}`);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const path = Object.keys(zip.files).find((p) => p.includes("PublicDoc") && p.endsWith(".xbrl"));
  if (!path) throw new Error(`${docId}: .xbrl not found`);
  const xml = await zip.file(path).async("string");

  const root = xml.match(/<xbrli:xbrl[^>]*>/)[0];
  const contexts = xml.match(/<xbrli:context\b[\s\S]*?<\/xbrli:context>/g) ?? [];
  // 数値ファクト（contextRef付き・短い値）とDEIのみ残す。TextBlock等の長文は除外
  const facts = (xml.match(/<([\w-]+:\w+)\b[^>]*contextRef="[^"]+"[^>]*>[^<]{0,60}<\/\1>/g) ?? [])
    .filter((f) => !/TextBlock/.test(f));

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    root,
    ...contexts,
    ...facts,
    "</xbrli:xbrl>",
  ].join("\n");
  writeFileSync(`tests/fixtures/${docId}.xbrl`, out);
  console.log(`${docId}: ${contexts.length} contexts, ${facts.length} facts, ${(out.length / 1024).toFixed(0)}KB`);
}
