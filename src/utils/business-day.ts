/**
 * 営業日ユーティリティ
 * 土日祝日を考慮して直近の営業日を取得
 */

// 日本の祝日（2024-2026年）
// 実際の運用では毎年更新するか、外部APIを使う
const JAPANESE_HOLIDAYS: Set<string> = new Set([
  // 2024年
  "2024-01-01", "2024-01-08", "2024-02-11", "2024-02-12", "2024-02-23",
  "2024-03-20", "2024-04-29", "2024-05-03", "2024-05-04", "2024-05-05",
  "2024-05-06", "2024-07-15", "2024-08-11", "2024-08-12", "2024-09-16",
  "2024-09-22", "2024-09-23", "2024-10-14", "2024-11-03", "2024-11-04",
  "2024-11-23", "2024-12-23",
  
  // 2025年
  "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24",
  "2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05",
  "2025-05-06", "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-23",
  "2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24",
  
  // 2026年
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20",
  "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
  "2026-10-12", "2026-11-03", "2026-11-23",
]);

/**
 * 指定日が営業日かどうかを判定
 */
export function isBusinessDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  
  // 土曜日(6)または日曜日(0)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  
  // 祝日チェック
  const dateStr = date.toISOString().split("T")[0];
  if (JAPANESE_HOLIDAYS.has(dateStr)) {
    return false;
  }
  
  return true;
}

/**
 * 直近の営業日を取得
 * @param date 基準日（デフォルトは今日）
 * @param direction "past" で過去方向、"future" で未来方向
 */
export function getLatestBusinessDay(
  date: Date = new Date(),
  direction: "past" | "future" = "past"
): Date {
  const result = new Date(date);
  const maxIterations = 10; // 無限ループ防止
  
  for (let i = 0; i < maxIterations; i++) {
    if (isBusinessDay(result)) {
      return result;
    }
    
    if (direction === "past") {
      result.setDate(result.getDate() - 1);
    } else {
      result.setDate(result.getDate() + 1);
    }
  }
  
  // 見つからない場合は元の日付を返す
  return date;
}

/**
 * 日付文字列から直近の営業日を取得
 * @param dateStr YYYY-MM-DD形式の日付文字列（省略時は今日）
 * @returns { date: string, isOriginalBusinessDay: boolean, originalDate: string }
 */
export function resolveToBusinessDay(dateStr?: string): {
  date: string;
  isOriginalBusinessDay: boolean;
  originalDate: string;
  message: string;
} {
  const originalDate = dateStr || new Date().toISOString().split("T")[0];
  const original = new Date(originalDate + "T00:00:00");
  
  if (isBusinessDay(original)) {
    return {
      date: originalDate,
      isOriginalBusinessDay: true,
      originalDate,
      message: "",
    };
  }
  
  const businessDay = getLatestBusinessDay(original, "past");
  const businessDayStr = businessDay.toISOString().split("T")[0];
  
  // 何日前かを計算
  const diffDays = Math.round((original.getTime() - businessDay.getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    date: businessDayStr,
    isOriginalBusinessDay: false,
    originalDate,
    message: `${originalDate}は非営業日のため、直近の営業日（${businessDayStr}、${diffDays}日前）のデータを取得しました。`,
  };
}
