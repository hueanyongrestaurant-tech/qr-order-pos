// เมนูกระดาษ A4: แยกชุด / ราคาตามตัวเลือก / จัดหน้า (src/app/printMenu.ts) ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrintMenu, packMenu, printPrice } from "./printMenu";
import { BUILTIN_GROUP_IDS } from "../../src/app/menuOptions";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const menu = (id, price, groups = [], extra = {}) => ({
  id, categoryId: "food", name: { th: `เมนู ${id}`, en: `Menu ${id}` }, description: { th: "", en: "" }, photo: "", price, ...noBuiltins, customGroups: groups, ...extra,
});
const group = (id, choices, extra = {}) => ({
  id, nameTh: id, nameEn: id, type: "single", required: true, quickToggle: false,
  choices: choices.map(([cid, labelTh, priceDelta]) => ({ id: cid, labelTh, labelEn: cid, priceDelta })), ...extra,
});
const meat = group("meat", [["pork", "หมู", 0], ["chicken", "ไก่", 0], ["sea", "ทะเล", 20]]);
const spice = group("spice", [["s0", "ไม่เผ็ด", 0], ["s1", "เผ็ด", 0]]);
const egg = group("egg", [["egg", "ไข่ดาว", 15]], { type: "multi", required: false });

test("printPrice: one price; free required choices don't split it", () => {
  assert.deepEqual(printPrice(menu("a", 89, [spice])), { price: 89, variants: [], extras: [] });
});

test("printPrice: priced choices become 'หมู/ไก่ 79 · ทะเล 99' and paid extras a small line", () => {
  assert.deepEqual(printPrice(menu("a", 79, [spice, egg, meat])), {
    price: null,
    variants: [{ label: "หมู/ไก่", price: 79 }, { label: "ทะเล", price: 99 }],
    extras: ["ไข่ดาว +15"],
  });
});

test("printPrice: second priced required group → extra line; single-choice delta adds to base; plates/cutlery left out", () => {
  const size = group("size", [["r", "ธรรมดา", 0], ["sp", "พิเศษ", 25]]);
  const only = group("only", [["x", "กระปุก", 35]]);
  const addOns = group(BUILTIN_GROUP_IDS.addOns, [["extra-plate", "จานเปล่าเพิ่ม", 10]], { type: "multi", required: false });
  assert.deepEqual(printPrice(menu("a", 0, [only, meat, size, addOns])), {
    price: null,
    variants: [{ label: "หมู/ไก่", price: 35 }, { label: "ทะเล", price: 55 }],
    extras: ["พิเศษ +25"],
  });
});

test("printPrice: legacy built-in options are read through normalizeMenuItem", () => {
  const legacy = { ...menu("n", 69), hasPortion: true, portionPriceDelta: 15, customGroups: undefined };
  assert.deepEqual(printPrice(legacy).variants.map((v) => v.price), [69, 84]);
});

test("buildPrintMenu: hidden categories/items left out, sold-out kept, drinks + souvenirs on the drinks set, sorted by order", () => {
  const categories = [
    { id: "food", nameTh: "อาหารพื้นเมือง", nameEn: "Local", order: 2 },
    { id: "drink", nameTh: "เครื่องดื่ม", nameEn: "Drinks", order: 0 },
    { id: "gift", nameTh: "ของฝาก", nameEn: "Souvenirs", order: 9 },
    { id: "old", nameTh: "หมวดเก่า", nameEn: "Old", order: 1, active: false },
    { id: "empty", nameTh: "ว่าง", nameEn: "Empty", order: 3 },
  ];
  const items = [
    menu("b", 50, [], { order: 2 }), menu("a", 50, [], { order: 1, soldOut: true }), menu("h", 50, [], { active: false }),
    menu("tea", 55, [], { categoryId: "drink" }), menu("ginger", 60, [], { categoryId: "gift" }), menu("x", 10, [], { categoryId: "old" }),
    menu("hidden", 10, [], { categoryId: "empty", active: false }),
  ];
  const out = buildPrintMenu(categories, items);
  assert.deepEqual(out.food.map((s) => [s.id, s.items.map((i) => i.id)]), [["food", ["a", "b"]]]);
  assert.deepEqual(out.drinks.map((s) => s.id), ["drink", "gift"]);
});

test("packMenu: whole sections when they fit, splits big ones with (ต่อ), never leaves a heading alone", () => {
  const sec = (n, h = 10) => ({ heading: 20, items: Array(n).fill(h) });
  // คอลัมน์สูง 100: หมวด 5 รายการ (70) แล้วหมวด 2 รายการ (40) ไม่พอที่เหลือ 30 (ใส่ได้แค่หัว + 1) → ขึ้นคอลัมน์ใหม่ทั้งหมวด
  assert.deepEqual(packMenu([sec(5), sec(2)], () => 100, 2), [[
    [{ section: 0, from: 0, to: 5, cont: false }],
    [{ section: 1, from: 0, to: 2, cont: false }],
  ]]);
  // หมวดใหญ่กว่าคอลัมน์ → แบ่ง ต่อคอลัมน์/หน้าถัดไป (หน้าแรกเตี้ยกว่า)
  const pages = packMenu([sec(20)], (p) => (p === 0 ? 80 : 100), 2);
  assert.deepEqual(pages.map((p) => p.map((c) => c.map((x) => [x.from, x.to, x.cont]))), [
    [[[0, 6, false]], [[6, 12, true]]],
    [[[12, 20, true]]],
  ]);
  // ที่เหลือพอแค่หัวหมวด + 1 รายการ → ไม่แบ่ง ขึ้นคอลัมน์ใหม่
  const tail = packMenu([sec(7), sec(12)], () => 100, 2);
  assert.deepEqual(tail[0][0].map((x) => x.section), [0]);
  // ไม่มีหน้า/คอลัมน์ว่างท้าย
  assert.equal(packMenu([sec(1)], () => 100, 2)[0].length, 1);
});
