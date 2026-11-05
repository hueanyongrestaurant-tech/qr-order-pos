// ─── ปุ่มช่วงของกราฟยอดขาย (หน้าสถิติ แท็บยอดขาย): วัน / สัปดาห์ / เดือน / ปี ───
// วัน = ช่วงที่เลือกเอง (แท่งละวัน แบบเดิม) | สัปดาห์ = 12 สัปดาห์ล่าสุด (เริ่มวันจันทร์)
// เดือน = 12 เดือนล่าสุด | ปี = ตั้งแต่ปีของออเดอร์แรกถึงปีนี้
// ปุ่มเหล่านี้ตั้งช่วงวันที่ให้เอง → การ์ดสรุป/เมนูที่ขายได้ใช้ช่วงเดียวกัน (ดึงผ่าน cache รายวันเดิม)
// ตรรกะล้วน ไม่แตะ Firestore — ทดสอบใน tests/rules/statsPeriods.test.mjs

import type { Language } from "./types";
import { formatDateInput } from "./utils";

export type RevenuePeriod = "day" | "week" | "month" | "year";
export const WEEKS_SHOWN = 12;
export const MONTHS_SHOWN = 12;

const keyToDate = (key: string) => new Date(`${key}T00:00:00`);

// วันจันทร์ของสัปดาห์ที่ d อยู่ (เวลา 00:00 ตามเครื่อง)
export { analysisWindowStart } from "./utils";

export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sinceMonday = (out.getDay() + 6) % 7; // อาทิตย์ = 6
  out.setDate(out.getDate() - sinceMonday);
  return out;
}

// ช่วงวันที่ (YYYY-MM-DD ทั้งสองฝั่ง) ของปุ่ม สัปดาห์/เดือน/ปี — ปลายช่วง = วันนี้เสมอ
// firstDay = วันแรกที่มีออเดอร์ (null = ยังไม่มีออเดอร์เลย → ปีนี้ปีเดียว)
export function periodRange(period: Exclude<RevenuePeriod, "day">, today: Date, firstDay: string | null): { start: string; end: string } {
  const end = formatDateInput(today);
  if (period === "week") {
    const s = weekStart(today);
    s.setDate(s.getDate() - 7 * (WEEKS_SHOWN - 1));
    return { start: formatDateInput(s), end };
  }
  if (period === "month") {
    return { start: formatDateInput(new Date(today.getFullYear(), today.getMonth() - (MONTHS_SHOWN - 1), 1)), end };
  }
  const firstYear = firstDay ? Math.min(keyToDate(firstDay).getFullYear(), today.getFullYear()) : today.getFullYear();
  return { start: formatDateInput(new Date(firstYear, 0, 1)), end };
}

export interface RevenueBucket {
  key: string; // วันแรกของช่วง (YYYY-MM-DD)
  label: string;
  revenue: number;
}

function weekLabel(monday: Date, lang: Language): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const locale = lang === "en" ? "en-US" : "th-TH";
  const mon = (d: Date) => d.toLocaleDateString(locale, { month: "short" });
  const sameMonth = monday.getMonth() === sunday.getMonth();
  if (lang === "en") {
    return sameMonth
      ? `${mon(monday)} ${monday.getDate()}–${sunday.getDate()}`
      : `${mon(monday)} ${monday.getDate()} – ${mon(sunday)} ${sunday.getDate()}`;
  }
  return sameMonth
    ? `${monday.getDate()}–${sunday.getDate()} ${mon(sunday)}`
    : `${monday.getDate()} ${mon(monday)} – ${sunday.getDate()} ${mon(sunday)}`;
}

// "พ.ย. 69" / "Nov 26"
export function monthLabel(first: Date, lang: Language): string {
  return first.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { month: "short", year: "2-digit" });
}

// "2569" / "2026"
export function yearLabel(year: number, lang: Language): string {
  return String(lang === "en" ? year : year + 543);
}

// แท่งของกราฟ — ครบทุกช่วงตั้งแต่ startKey ถึง endKey แม้ช่วงนั้นไม่มียอดขาย
// sales = { at: เวลาออเดอร์ (createdAt — แบบเดียวกับกราฟรายวัน), amount }
export function revenueBuckets(
  period: Exclude<RevenuePeriod, "day">,
  sales: { at: Date; amount: number }[],
  startKey: string,
  endKey: string,
  lang: Language,
): RevenueBucket[] {
  const startOf = (d: Date): Date =>
    period === "week" ? weekStart(d)
      : period === "month" ? new Date(d.getFullYear(), d.getMonth(), 1)
        : new Date(d.getFullYear(), 0, 1);
  const next = (d: Date): Date =>
    period === "week" ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
      : period === "month" ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
        : new Date(d.getFullYear() + 1, 0, 1);
  const label = (d: Date) =>
    period === "week" ? weekLabel(d, lang) : period === "month" ? monthLabel(d, lang) : yearLabel(d.getFullYear(), lang);

  const buckets: RevenueBucket[] = [];
  const index = new Map<string, number>();
  const last = keyToDate(endKey);
  for (let c = startOf(keyToDate(startKey)); c <= last && buckets.length < 1000; c = next(c)) {
    const key = formatDateInput(c);
    index.set(key, buckets.length);
    buckets.push({ key, label: label(c), revenue: 0 });
  }
  sales.forEach(({ at, amount }) => {
    const i = index.get(formatDateInput(startOf(at)));
    if (i !== undefined) buckets[i].revenue += amount;
  });
  return buckets;
}
