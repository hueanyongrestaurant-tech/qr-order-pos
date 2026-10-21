// สถิติ: เมนูขายดี / ตัวเลือกยอดนิยม / แถวเมนูที่ขายได้ — ชื่อปัจจุบันตาม id (src/app/statsInsights.ts) ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  menuLookup, popularChoices, selectionKey, selectionLabels, topItems,
} from "../../src/app/statsInsights";
import { normalizeMenuItem } from "../../src/app/menuOptions";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const meatGroup = (labels = { pork: "หมู", chicken: "ไก่", beef: "เนื้อ" }) => ({
  id: "meat", nameTh: "เนื้อสัตว์", nameEn: "Meat", type: "single", required: true, quickToggle: true,
  choices: Object.entries(labels).map(([id, labelTh]) => ({ id, labelTh, labelEn: id, priceDelta: 0 })),
});
const sizeGroup = {
  id: "size", nameTh: "ขนาด", nameEn: "Size", type: "single", required: true, quickToggle: false,
  choices: [{ id: "reg", labelTh: "ธรรมดา", labelEn: "Regular", priceDelta: 0 }, { id: "sp", labelTh: "พิเศษ", labelEn: "Special", priceDelta: 20 }],
};
const eggGroup = {
  id: "egg", nameTh: "เพิ่ม", nameEn: "Extra", type: "multi", required: false, quickToggle: false,
  choices: [{ id: "egg", labelTh: "ไข่ดาว", labelEn: "Egg", priceDelta: 15 }, { id: "rice", labelTh: "ข้าว", labelEn: "Rice", priceDelta: 10 }],
};
const menu = (id, th, groups, extra = {}) => ({
  id, categoryId: "food", name: { th, en: th }, description: { th: "", en: "" }, photo: "", price: 80, ...noBuiltins, customGroups: groups, ...extra,
});
const line = (item, quantity, sel, extra = {}) => ({ cartId: Math.random().toString(36), item, quantity, spiceLevel: 0, customSelections: sel, ...extra });
const order = (day, items) => ({ id: day + Math.random(), tableNumber: "1-1", status: "paid", timestamp: new Date(`${day}T12:00:00`), items });

// ข้าวซอย: ชื่อตอนสั่งเดือนก่อนเป็นชื่อเก่า เปลี่ยนชื่อ + ชื่อตัวเลือกภายหลัง (id เดิม)
const oldKhaoSoi = menu("ks", "ข้าวซอย", [meatGroup({ pork: "หมู", chicken: "ไก่" })]);
const nowKhaoSoi = menu("ks", "ข้าวซอยไข่ออนเซ็น (ไก่/หมู/เนื้อ)", [meatGroup({ pork: "หมูนุ่ม", chicken: "ไก่", beef: "เนื้อ" }), sizeGroup]);
const drink = menu("tea", "ชาไทย", [], { categoryId: "drinks" });
const orders = [
  order("2026-09-01", [line(oldKhaoSoi, 3, { meat: ["pork"] }), line(oldKhaoSoi, 2, { meat: ["chicken"] })]),
  order("2026-10-20", [
    line(nowKhaoSoi, 4, { meat: ["chicken"], size: ["reg"] }),
    line(nowKhaoSoi, 1, { meat: ["beef"], size: ["sp"] }),
    line(nowKhaoSoi, 9, { meat: ["pork"], size: ["reg"] }, { voided: true }),
    line(drink, 30, {}),
  ]),
];

test("topItems: same id across a rename counts as one item, shown with today's name", () => {
  const [top] = topItems(orders, 1, new Set(["drinks"]), menuLookup([nowKhaoSoi, drink]));
  assert.deepEqual([top.id, top.nameTh, top.qty], ["ks", "ข้าวซอยไข่ออนเซ็น (ไก่/หมู/เนื้อ)", 10]);
});

test("topItems: deleted menu falls back to the name in its latest order, not the oldest", () => {
  const [top] = topItems(orders, 1, new Set(["drinks"]), menuLookup([]));
  assert.equal(top.nameTh, "ข้าวซอยไข่ออนเซ็น (ไก่/หมู/เนื้อ)");
});

test("topItems: category skip uses the menu's current category", () => {
  const moved = { ...drink, categoryId: "food" };
  assert.equal(topItems(orders, 1, new Set(["drinks"]), menuLookup([nowKhaoSoi, moved]))[0].id, "tea");
});

test("popularChoices: share per choice with current labels; voided lines ignored", () => {
  const shares = popularChoices(orders, "ks", menuLookup([nowKhaoSoi]));
  assert.equal(shares[0].nameTh, "เนื้อสัตว์");
  assert.deepEqual(shares[0].choices.map((c) => [c.labelTh, c.pct]), [["ไก่", 60], ["หมูนุ่ม", 30], ["เนื้อ", 10]]);
  // ขนาดเลือกแค่ 5 จากทั้งหมด 10 (ครึ่งหนึ่งพอดี) → ขึ้นเป็นบรรทัดที่ 2
  assert.deepEqual(shares[1].choices.map((c) => [c.labelTh, c.pct]), [["ธรรมดา", 80], ["พิเศษ", 20]]);
});

test("popularChoices: groups with one choice only, multi-choice second groups and >3 choices", () => {
  const m = menu("x", "x", [meatGroup({ a: "a", b: "b", c: "c", d: "d", e: "e" }), eggGroup]);
  const os = [order("2026-10-01", [
    line(m, 4, { meat: ["a"], egg: ["egg"] }), line(m, 3, { meat: ["b"], egg: ["egg", "rice"] }), line(m, 1, { meat: ["c"] }),
    line(m, 1, { meat: ["d"] }), line(m, 1, { meat: ["e"] }),
  ])];
  const shares = popularChoices(os, "x", menuLookup([m]));
  assert.equal(shares.length, 1, "multi-choice extras group is never the 2nd line");
  assert.deepEqual(shares[0].choices.map((c) => [c.labelTh, c.pct]), [["a", 40], ["b", 30], ["c", 10], ["อื่นๆ", 20]]);
  const plain = menu("p", "p", [meatGroup()]);
  assert.deepEqual(popularChoices([order("2026-10-01", [line(plain, 5, { meat: ["pork"] })])], "p", menuLookup([plain])), [], "everyone picked the same → nothing to show");
});

test("items-sold rows: keyed by ids, so renamed choices and legacy lines merge; labels are current", () => {
  const a = line(oldKhaoSoi, 1, { meat: ["pork"] });
  const b = line(nowKhaoSoi, 1, { meat: ["pork"] });
  assert.equal(selectionKey(a), selectionKey(b));
  assert.deepEqual(selectionLabels(a, nowKhaoSoi, "th"), ["หมูนุ่ม"]);
  // แบบเดิม (ci.meat) กับแบบแปลงแล้วได้ key เดียวกัน
  const legacy = { ...menu("l", "l", []), hasMeatChoice: true, meatPriceDeltas: { pork: 0, chicken: 0, beef: 10 } };
  const legacyLine = { cartId: "c", item: legacy, quantity: 1, spiceLevel: 0, meat: "chicken" };
  const converted = line(normalizeMenuItem(legacy), 1, { "builtin-meat": ["chicken"] });
  assert.equal(selectionKey(legacyLine), selectionKey(converted));
  assert.deepEqual(selectionLabels(legacyLine, normalizeMenuItem(legacy), "th"), selectionLabels(converted, normalizeMenuItem(legacy), "th"));
  assert.deepEqual(selectionLabels(b, undefined, "th"), ["หมูนุ่ม"], "deleted menu → label from the order");
});
