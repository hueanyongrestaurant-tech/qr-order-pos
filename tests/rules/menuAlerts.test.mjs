// แถบ "หมดแล้ว" หน้าออเดอร์: เมนูที่กดหมดเอง + ตัวเลือกที่ปิด (prep.buildClosedAlerts) ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClosedAlerts } from "../../src/app/prep";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const menu = (id, extra = {}) => ({ id, categoryId: "c", name: { th: id, en: `${id}-en` }, description: { th: "", en: "" }, photo: "", price: 50, ...noBuiltins, ...extra });
const meat = (closed = {}) => [{
  id: "meat", nameTh: "เนื้อ", nameEn: "Meat", type: "single", required: true, quickToggle: true,
  choices: [
    { id: "pork", labelTh: "หมู", labelEn: "Pork", priceDelta: 0, ...(closed.pork ?? {}) },
    { id: "beef", labelTh: "เนื้อ", labelEn: "Beef", priceDelta: 30, ...(closed.beef ?? {}) },
  ],
}];
const name = (m) => m.name.th;

test("buildClosedAlerts: manual sold-out menus and closed options, shown even with the stock system off", () => {
  const menus = [
    menu("แกงอ่อม", { customGroups: meat({ beef: { soldOut: true } }) }),
    menu("ลาบ", { soldOut: true }),
    menu("ซ่อน", { soldOut: true, active: false }),
    menu("ปกติ", { customGroups: meat() }),
    menu("เก่า", { customGroups: meat({ pork: { active: false } }) }), // ปุ่ม "ซ่อน" ตัวเลือกแบบเดิม = ปิด
  ];
  const expected = [
    { id: "ลาบ", name: "ลาบ" },
    ...[
      { id: "แกงอ่อม", name: "แกงอ่อม", choices: ["เนื้อ"] },
      { id: "เก่า", name: "เก่า", choices: ["หมู"] },
    ].sort((a, b) => a.name.localeCompare(b.name, "th")),
  ];
  assert.deepEqual(buildClosedAlerts(false, menus, new Map(), new Map(), name), expected);
  assert.deepEqual(buildClosedAlerts(true, menus, new Map(), new Map(), name), expected);
  assert.deepEqual(buildClosedAlerts(false, [menus[0]], new Map(), new Map(), name, (c) => c.labelEn)[0].choices, ["Beef"]);
});

test("buildClosedAlerts: stock-caused sold-outs are left to the stock list (no duplicates) — unless stock is off", () => {
  const menus = [
    menu("soup", { soldOut: true, stockTracked: true }),
    menu("larb", { soldOut: true, soldOutByPrep: true, prepIds: ["prep_l"] }),
    menu("khao", { customGroups: meat({ beef: { soldOut: true, soldOutByPrep: true, prepIds: ["prep_b"] } }) }),
  ];
  const stockMap = new Map([["soup", { remaining: 0 }]]);
  const prepMap = new Map([["prep_l", { name: "L", remaining: 0 }], ["prep_b", { name: "B", remaining: 0 }]]);
  assert.deepEqual(buildClosedAlerts(true, menus, stockMap, prepMap, name), []);
  assert.deepEqual(buildClosedAlerts(false, menus, stockMap, prepMap, name).map((a) => a.id).sort(), ["khao", "larb", "soup"]);
  // ของเตรียมเติมแล้วแต่เมนู/ตัวเลือกยังปิดอยู่ (เครื่องพนักงานยังไม่เปิดคืน) → ยังแสดง
  const refilled = new Map([["prep_l", { name: "L", remaining: 3 }], ["prep_b", { name: "B", remaining: 3 }]]);
  assert.deepEqual(buildClosedAlerts(true, menus.slice(1), new Map(), refilled, name).map((a) => a.id).sort(), ["khao", "larb"]);
});
