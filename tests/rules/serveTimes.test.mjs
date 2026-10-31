// เวลาสั่ง → เสิร์ฟ (statsInsights.serveSummary) + บันทึกเวลาเสิร์ฟทีละชุด (utils.serveLogAppend/Trim) ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveSummary, serveTimes } from "../../src/app/statsInsights";
import { serveLogAppend, serveLogTrim } from "../../src/app/utils";
import { ADDON_CATEGORY_ID } from "../../src/app/constants";

const categories = [
  { id: "food", nameTh: "อาหารพื้นเมือง", nameEn: "", order: 0 },
  { id: "drink", nameTh: "เครื่องดื่ม", nameEn: "", order: 1 },
  { id: "gift", nameTh: "ของฝาก", nameEn: "", order: 2 },
];
const item = (id, categoryId) => ({ id, categoryId, name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price: 50 });
const T0 = new Date("2026-10-25T12:00:00");
const at = (min) => new Date(T0.getTime() + min * 60000);
const line = (cartId, it, quantity, extra = {}) => ({ cartId, item: it, quantity, spiceLevel: 0, addEgg: false, addOns: [], ...extra });
const order = (items, extra = {}) => ({ id: Math.random().toString(36), tableNumber: "1-1", status: "paid", timestamp: T0, items, ...extra });

test("serveLog: append batches, trim keeps the first units (undo removes the latest)", () => {
  let log = serveLogAppend(undefined, 2, at(5));
  log = serveLogAppend(log, 3, at(9));
  assert.deepEqual(log.map((b) => b.n), [2, 3]);
  assert.deepEqual(serveLogTrim(log, 4).map((b) => [b.n, b.at]), [[2, at(5)], [2, at(9)]]);
  assert.deepEqual(serveLogTrim(log, 0), []);
  assert.equal(serveLogAppend([{ n: "x" }, null], 1, at(1)).length, 1, "junk entries dropped");
});

test("serveTimes: per batch from serveLog; old orders use servedAt for the last batch only", () => {
  const rice = item("rice", "food");
  const withLog = order([line("a", rice, 3)], { serveLog: { a: [{ n: 1, at: at(4) }, { n: 5, at: at(10) }] } });
  assert.deepEqual(serveTimes(withLog, withLog.items[0]), { batches: [{ n: 1, at: at(4) }, { n: 2, at: at(10) }], missing: 0 }, "capped at quantity");
  const old = order([line("a", rice, 3)], { servedAt: { a: at(12) }, servedUnits: { a: { last: 1 } } });
  assert.deepEqual(serveTimes(old, old.items[0]), { batches: [{ n: 1, at: at(12) }], missing: 2 });
  const none = order([line("a", rice, 2)]);
  assert.deepEqual(serveTimes(none, none.items[0]), { batches: [], missing: 2 });
});

test("serveSummary: average per piece, food/drink × dine-in/takeaway, exclusions", () => {
  const rice = item("rice", "food");
  const tea = item("tea", "drink");
  const ginger = item("ginger", "gift");
  const bag = item("bag", ADDON_CATEGORY_ID);
  const orders = [
    // 2 ชิ้นที่ 10 นาที + 1 ชิ้นที่ 16 นาที → อาหารทานที่ร้านเฉลี่ย 12 นาที | ยกเลิก/ของฝาก/Add-on ไม่นับ
    order([
      line("a", rice, 3), line("b", tea, 1), line("v", rice, 4, { voided: true }), line("g", ginger, 1), line("x", bag, 1),
    ], {
      serveLog: {
        a: [{ n: 2, at: at(10) }, { n: 1, at: at(16) }], b: [{ n: 1, at: at(3) }],
        v: [{ n: 4, at: at(1) }], g: [{ n: 1, at: at(1) }], x: [{ n: 1, at: at(1) }],
      },
    }),
    // ค่าผิดปกติ: เสิร์ฟก่อนสั่ง + เกิน 3 ชม.
    order([line("c", rice, 2)], { serveLog: { c: [{ n: 1, at: at(-2) }, { n: 1, at: at(200) }] } }),
    // กลับบ้าน
    order([line("d", rice, 1)], { isTakeaway: true, serveLog: { d: [{ n: 1, at: at(20) }] } }),
    // บิลย้อนหลังไม่นับ
    order([line("e", rice, 5)], { backfilled: true, serveLog: { e: [{ n: 5, at: at(1) }] } }),
    // ไม่มีเวลาเสิร์ฟ (ออเดอร์เก่า)
    order([line("f", tea, 2)], { timestamp: new Date("2026-10-20T12:00:00") }),
  ];
  const s = serveSummary(orders, categories);
  assert.deepEqual(s.food.dineIn, { avgMinutes: 12, minMinutes: 10, maxMinutes: 16, pieces: 3 });
  assert.deepEqual(s.food.takeaway, { avgMinutes: 20, minMinutes: 20, maxMinutes: 20, pieces: 1 });
  assert.deepEqual(s.drink.dineIn, { avgMinutes: 3, minMinutes: 3, maxMinutes: 3, pieces: 1 });
  assert.deepEqual(s.drink.takeaway, { avgMinutes: null, minMinutes: null, maxMinutes: null, pieces: 0 });
  assert.equal(s.outliers, 2);
  assert.equal(s.missing, 2);
  assert.deepEqual(s.trackedSince, T0);
});

test("serveSummary: category uses the menu's current category", () => {
  const moved = item("tea", "drink");
  const o = order([line("a", moved, 1)], { serveLog: { a: [{ n: 1, at: at(6) }] } });
  const s = serveSummary([o], categories, new Map([["tea", { ...moved, categoryId: "food" }]]));
  assert.equal(s.food.dineIn.pieces, 1);
});
