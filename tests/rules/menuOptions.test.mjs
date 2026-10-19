// ตัวเลือกเมนูแบบใหม่ (customGroups อย่างเดียว) — โค้ดจริงใน src/app/menuOptions.ts + utils.ts ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  choiceLabels, closedSelectedChoices, hasLegacyOptions, isQuickToggleGroup, normalizeMenuItem, requiredGroupAllClosed, setChoiceClosed,
} from "../../src/app/menuOptions";
import { cartItemTotal, isCartItemUnavailable, itemPrice, menuAvailability, withLiveAvailability } from "../../src/app/utils";
import { kitchenOptionSummary } from "../../src/app/staff/ticket";

const base = { categoryId: "c", name: { th: "เมนู", en: "Menu" }, description: { th: "", en: "" }, photo: "", price: 89 };
const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };

// ข้าวซอยไข่ออนเซ็น ตามข้อมูลจริง: เนื้อในตัว (เนื้อ +10 หมดอยู่) + กลุ่มขนาดจานที่ตั้งค่าเริ่มต้น "ธรรมดา"
const khaoSoi = {
  ...base, id: "khaosoi", hasMeatChoice: true, meatPriceDeltas: { pork: 0, beef: 10 }, soldOutMeats: ["beef"], disabledMeats: [],
  hasPortion: false, portionPriceDelta: 15, hasEggAddon: false, hasPlainAddOns: false,
  customGroups: [{
    id: "portion", nameTh: "ขนาดจาน (ธรรมดา/พิเศษ)", nameEn: "Portion Size", type: "single", required: true, defaultChoiceId: "reg",
    choices: [{ id: "reg", labelTh: "ธรรมดา", labelEn: "Regular", priceDelta: 0 }, { id: "sp", labelTh: "พิเศษ", labelEn: "Special", priceDelta: 25 }],
  }],
};

const line = (item, extra = {}) => ({ cartId: "x", item, quantity: 1, spiceLevel: 0, addEgg: false, addOns: [], ...extra });

test("built-in meat → required group, no default, sold-out meat is closed, quick toggle on, legacy fields cleared", () => {
  const n = normalizeMenuItem(khaoSoi);
  assert.deepEqual(n.customGroups.map((g) => g.id), ["builtin-meat", "portion"]);
  const meat = n.customGroups[0];
  assert.equal(meat.nameTh, "เลือกเนื้อสัตว์");
  assert.equal(meat.required, true);
  assert.equal(meat.quickToggle, true);
  assert.equal(meat.defaultChoiceId, undefined);
  assert.deepEqual(meat.choices.map((c) => [c.labelTh, c.priceDelta, !!c.soldOut]), [["หมู", 0, false], ["ไก่", 0, false], ["เนื้อ", 10, true]]);
  // ค่าเริ่มต้นของกลุ่มเดิมถูกเอาออก กลุ่มขนาดจานไม่ติ๊กปุ่มด่วน
  assert.equal(n.customGroups[1].defaultChoiceId, undefined);
  assert.equal(n.customGroups[1].quickToggle, false);
  // ตั้งเป็น false ไว้ (แอปเก่านับไม่มี field = เปิด) และลบ field แบบเดิม
  assert.equal(n.hasMeatChoice, false);
  assert.equal(n.hasEggAddon, false);
  for (const k of ["meatPriceDeltas", "soldOutMeats", "disabledMeats", "portionPriceDelta"]) assert.equal(k in n, false, k);
  assert.equal(hasLegacyOptions(n), false);
  assert.equal(normalizeMenuItem(n), n, "แปลงแล้วคืน object เดิม");
});

test("spice / portion / egg / plain add-ons convert with the same prices", () => {
  const legacy = { ...base, id: "x", hasSpice: true, hasPortion: true, portionPriceDelta: 15 }; // ไม่มี field ไข่/จาน = เปิด
  const n = normalizeMenuItem(legacy);
  assert.deepEqual(n.customGroups.map((g) => [g.id, g.type, !!g.required]), [
    ["builtin-spice", "single", true], ["builtin-portion", "single", true], ["builtin-egg", "multi", false], ["builtin-addons", "multi", false],
  ]);
  assert.deepEqual(n.customGroups[0].choices.map((c) => c.labelTh), ["ไม่เผ็ด", "เผ็ดน้อย", "เผ็ดกลาง", "เผ็ดมาก"]);
  // ราคาเดิม: จานพิเศษ + ไข่ดาว + จานเปล่าเพิ่ม = 89 + 15 + 15 + 10
  const legacyPrice = itemPrice(legacy, undefined, "special", true, ["extra-plate"], {});
  const newPrice = itemPrice(n, undefined, undefined, false, [], { "builtin-portion": ["special"], "builtin-egg": ["egg"], "builtin-addons": ["extra-plate"], "builtin-spice": ["spice0"] });
  assert.equal(legacyPrice, 129);
  assert.equal(newPrice, 129);
});

test("hidden choice (old Hide button) counts as closed and stays closed after normalizing", () => {
  const item = { ...base, ...noBuiltins, id: "t", customGroups: [{ id: "g", nameTh: "เลือกเนื้อสัตว์", nameEn: "", type: "single", required: true,
    choices: [{ id: "a", labelTh: "หมู", labelEn: "", priceDelta: 0, active: true }, { id: "b", labelTh: "ซี่โครงหมู", labelEn: "", priceDelta: 0, active: false }] }] };
  const n = normalizeMenuItem(item);
  assert.deepEqual(n.customGroups[0].choices.map((c) => [c.id, c.soldOut, "active" in c]), [["a", undefined, false], ["b", true, false]]);
  assert.equal(n.customGroups[0].quickToggle, true, "กลุ่มชื่อมี 'เนื้อสัตว์' ติ๊กไว้ตั้งต้น");
});

test("required group all closed = item sold out, for any group (not only meat)", () => {
  const item = { ...base, ...noBuiltins, id: "d", customGroups: [{ id: "dip", nameTh: "เลือกน้ำพริก", nameEn: "", type: "single", required: true, quickToggle: false,
    choices: [{ id: "a", labelTh: "อ่อง", labelEn: "", priceDelta: 0, soldOut: true }, { id: "b", labelTh: "หนุ่ม", labelEn: "", priceDelta: 0 }] }] };
  assert.equal(menuAvailability(item), "available");
  const allOff = { ...item, customGroups: setChoiceClosed(item.customGroups, "dip", "b", true) };
  assert.equal(requiredGroupAllClosed(allOff), true);
  assert.equal(menuAvailability(allOff), "soldOut");
  // ไม่บังคับเลือก ปิดหมดก็ยังขายได้
  const optional = { ...allOff, customGroups: allOff.customGroups.map((g) => ({ ...g, required: false })) };
  assert.equal(menuAvailability(optional), "available");
  // แบบในตัว: เนื้อหมดทุกตัว = หมด
  assert.equal(menuAvailability({ ...khaoSoi, soldOutMeats: ["pork", "chicken", "beef"] }), "soldOut");
});

test("closed choice blocks the cart line — new orders and legacy lines (meat stored as ci.meat)", () => {
  const fresh = { ...khaoSoi }; // เนื้อหมด
  assert.equal(isCartItemUnavailable(line(khaoSoi, { meat: "beef" }), fresh), true, "รายการแบบเดิม");
  assert.equal(isCartItemUnavailable(line(khaoSoi, { meat: "pork" }), fresh), false);
  const n = normalizeMenuItem(khaoSoi);
  assert.equal(isCartItemUnavailable(line(n, { customSelections: { "builtin-meat": ["beef"], portion: ["reg"] } }), fresh), true, "รายการแบบใหม่");
  assert.equal(closedSelectedChoices(line(n, { customSelections: { "builtin-meat": ["chicken"] } }), fresh).length, 0);
  // กลุ่มอื่นที่ไม่ใช่เนื้อก็กันได้
  const freshDip = { ...base, ...noBuiltins, id: "d", customGroups: [{ id: "dip", nameTh: "น้ำพริก", nameEn: "", type: "single", quickToggle: false, choices: [{ id: "a", labelTh: "อ่อง", labelEn: "", priceDelta: 0, soldOut: true }] }] };
  assert.equal(isCartItemUnavailable(line(freshDip, { customSelections: { dip: ["a"] } }), freshDip), true);
});

test("stats labels: legacy and converted lines get the same option text", () => {
  const legacyLine = line({ ...base, id: "k", hasSpice: true, hasPortion: true, portionPriceDelta: 15, hasEggAddon: true, hasPlainAddOns: false },
    { spiceLevel: 0, portion: "regular", addEgg: true });
  const n = normalizeMenuItem(legacyLine.item);
  const newLine = line(n, { customSelections: { "builtin-spice": ["spice0"], "builtin-portion": ["regular"], "builtin-egg": ["egg"] } });
  assert.deepEqual(choiceLabels(legacyLine, "th"), ["ไม่เผ็ด", "ธรรมดา", "ไข่ดาว"]);
  assert.deepEqual(choiceLabels(newLine, "th"), choiceLabels(legacyLine, "th"));
  assert.equal(cartItemTotal(newLine), cartItemTotal(legacyLine));
});

test("kitchen ticket prints every chosen option for new orders; old orders print as before", () => {
  const n = normalizeMenuItem({ ...base, id: "k", hasSpice: true, hasPortion: true, hasEggAddon: false, hasPlainAddOns: false });
  assert.equal(kitchenOptionSummary(line(n, { customSelections: { "builtin-spice": ["spice0"], "builtin-portion": ["regular"] } }), "th"), "ไม่เผ็ด, ธรรมดา");
  const old = line({ ...base, id: "k", hasSpice: true, hasPortion: true }, { spiceLevel: 2, portion: "special", meat: "pork" });
  assert.equal(kitchenOptionSummary(old, "th"), "หมู, พิเศษ, เผ็ดกลาง");
});

test("quick toggle: explicit flag wins over the meat-name default", () => {
  assert.equal(isQuickToggleGroup({ id: "g", nameTh: "เลือกเนื้อสัตว์", nameEn: "", type: "single", choices: [] }), true);
  assert.equal(isQuickToggleGroup({ id: "g", nameTh: "เลือกเนื้อสัตว์", nameEn: "", type: "single", choices: [], quickToggle: false }), false);
  assert.equal(isQuickToggleGroup({ id: "g", nameTh: "น้ำพริก", nameEn: "", type: "single", choices: [], quickToggle: true }), true);
});

test("save from the edit screen keeps live on/off for existing choices, form value for new ones", () => {
  const prev = normalizeMenuItem(khaoSoi); // เนื้อปิดอยู่ใน DB
  const form = normalizeMenuItem(khaoSoi);
  // ฟอร์มค้างไว้ก่อนที่เครื่องอื่นจะเปิดเนื้อ: ฟอร์มยังเห็นปิด แต่ DB เปิดแล้ว
  const live = { ...prev, customGroups: setChoiceClosed(prev.customGroups, "builtin-meat", "beef", false) };
  const added = { ...form, customGroups: [...form.customGroups, { id: "new", nameTh: "ใหม่", nameEn: "", type: "single", quickToggle: false,
    choices: [{ id: "n1", labelTh: "ก", labelEn: "", priceDelta: 0, soldOut: true }] }] };
  const saved = withLiveAvailability(added, live);
  assert.equal(saved.customGroups[0].choices.find((c) => c.id === "beef").soldOut, undefined, "ตัวที่มีใน DB เอาค่าจาก DB");
  assert.equal(saved.customGroups[2].choices[0].soldOut, true, "ตัวใหม่เอาค่าจากฟอร์ม");
  assert.equal("soldOutMeats" in saved, false);
});
