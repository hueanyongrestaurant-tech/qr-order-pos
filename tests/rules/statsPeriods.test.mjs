// ปุ่ม วัน/สัปดาห์/เดือน/ปี ของกราฟยอดขาย (src/app/statsPeriods.ts) — ตรรกะล้วน ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisWindowStart, periodRange, revenueBuckets, weekStart } from "../../src/app/statsPeriods";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test("weekStart: Monday-based, Sunday belongs to the week before", () => {
  assert.equal(weekStart(at(2026, 11, 5)).toDateString(), at(2026, 11, 2).toDateString()); // พฤ → จ. 2 พ.ย.
  assert.equal(weekStart(at(2026, 11, 2, 0)).toDateString(), at(2026, 11, 2).toDateString()); // จันทร์เอง
  assert.equal(weekStart(at(2026, 11, 8, 23)).toDateString(), at(2026, 11, 2).toDateString()); // อาทิตย์
  assert.equal(weekStart(at(2026, 11, 1)).toDateString(), at(2026, 10, 26).toDateString()); // ข้ามเดือน
});

test("periodRange: week = 12 weeks from a Monday, month = 12 months from the 1st, year = from first order's year", () => {
  const today = at(2026, 11, 5);
  assert.deepEqual(periodRange("week", today, null), { start: "2026-08-17", end: "2026-11-05" });
  assert.deepEqual(periodRange("month", today, null), { start: "2025-12-01", end: "2026-11-05" });
  assert.deepEqual(periodRange("month", at(2026, 1, 31), null), { start: "2025-02-01", end: "2026-01-31" });
  assert.deepEqual(periodRange("year", today, "2025-08-14"), { start: "2025-01-01", end: "2026-11-05" });
  assert.deepEqual(periodRange("year", today, null), { start: "2026-01-01", end: "2026-11-05" });
});

test("revenueBuckets week: 12 bars, Monday keys, labels, sums per week incl. Sunday night", () => {
  const { start, end } = periodRange("week", at(2026, 11, 5), null);
  const b = revenueBuckets("week", [
    { at: at(2026, 11, 3), amount: 100 },
    { at: at(2026, 11, 8, 23), amount: 50 }, // อาทิตย์ 8 พ.ย. = สัปดาห์ 2–8
    { at: at(2026, 11, 1, 22), amount: 70 }, // อาทิตย์ 1 พ.ย. = สัปดาห์ 26 ต.ค.–1 พ.ย.
    { at: at(2026, 8, 16), amount: 999 }, // ก่อนช่วง — ไม่นับ
  ], start, end, "th");
  assert.equal(b.length, 12);
  assert.equal(b[0].key, "2026-08-17");
  assert.deepEqual(b.at(-1), { key: "2026-11-02", label: "2–8 พ.ย.", revenue: 150 });
  assert.deepEqual(b.at(-2), { key: "2026-10-26", label: "26 ต.ค. – 1 พ.ย.", revenue: 70 });
  assert.equal(b.reduce((s, x) => s + x.revenue, 0), 220);
  const en = revenueBuckets("week", [], start, end, "en");
  assert.equal(en.at(-1).label, "Nov 2–8");
  assert.equal(en.at(-2).label, "Oct 26 – Nov 1");
});

test("revenueBuckets month: 12 bars incl. empty months, Thai short month + BE year", () => {
  const { start, end } = periodRange("month", at(2026, 11, 5), null);
  const b = revenueBuckets("month", [
    { at: at(2026, 11, 1, 0), amount: 10 },
    { at: at(2026, 10, 31, 23), amount: 20 },
    { at: at(2026, 10, 1), amount: 5 },
  ], start, end, "th");
  assert.equal(b.length, 12);
  assert.deepEqual(b[0], { key: "2025-12-01", label: "ธ.ค. 68", revenue: 0 });
  assert.deepEqual(b.at(-1), { key: "2026-11-01", label: "พ.ย. 69", revenue: 10 });
  assert.deepEqual(b.at(-2), { key: "2026-10-01", label: "ต.ค. 69", revenue: 25 });
  assert.equal(revenueBuckets("month", [], start, end, "en").at(-1).label, "Nov 26");
});

test("revenueBuckets year: one bar per year from the first order's year", () => {
  const { start, end } = periodRange("year", at(2026, 11, 5), "2025-12-30");
  const b = revenueBuckets("year", [{ at: at(2025, 12, 31), amount: 300 }, { at: at(2026, 1, 1), amount: 40 }], start, end, "th");
  assert.deepEqual(b, [
    { key: "2025-01-01", label: "2568", revenue: 300 },
    { key: "2026-01-01", label: "2569", revenue: 40 },
  ]);
  assert.deepEqual(revenueBuckets("year", [], start, end, "en").map((x) => x.label), ["2025", "2026"]);
});

test("analysisWindowStart: last 12 months, never further back", () => {
  assert.equal(analysisWindowStart(new Date("2026-11-06T10:00:00")), "2025-11-07");
  assert.equal(analysisWindowStart(new Date("2026-01-01T00:05:00")), "2025-01-02");
  assert.equal(analysisWindowStart(new Date("2028-02-29T12:00:00")), "2027-03-02");
  assert.equal(analysisWindowStart(new Date("2026-12-31T23:00:00")), "2026-01-01");
});
