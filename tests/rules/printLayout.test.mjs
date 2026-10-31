// ข้อความที่ส่งไปเครื่องพิมพ์ (ใบเสร็จ/ตั๋วครัว/ใบย้ายโต๊ะ) — ตรรกะล้วน ไม่ต้องใช้ emulator
// PRINT_PREVIEW=1 พิมพ์ตัวอย่างใบเสร็จออกจอ, PRINT_DUMP=<file.json> เขียนบรรทัดลงไฟล์ (คอลัมน์ตามที่เครื่องพิมพ์วางจริง: สระบน/ล่าง วรรณยุกต์ไม่กินช่อง)
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_WIDTH, columns, displayWidth, wrapLine } from "../../src/app/staff/printText";
import { layoutReceipt } from "../../src/app/staff/receiptLayout";
import { layoutTicket, planTickets } from "../../src/app/staff/stationTickets";
import { buildMoveTicketOrder, moveBanner } from "../../src/app/staff/tableMove";
import { tableTitle } from "../../src/app/tables";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const menu = (id, th, en, price, categoryId = "food") =>
  ({ id, categoryId, name: { th, en }, description: { th: "", en: "" }, photo: "", price, ...noBuiltins, customGroups: [] });
let n = 0;
const line = (item, quantity, extra = {}) =>
  ({ cartId: `c${n++}`, item, quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {}, ...extra });

const items = [
  line(menu("a", "ชาไทย", "Thai tea", 45), 1),
  line(menu("b", "น้ำเปล่า", "Water", 10), 12),
  line(menu("c", "ข้าวซอยไก่", "Khao soi chicken", 70), 2),
  line(menu("d", "ขนมจีนน้ำเงี้ยวซี่โครงหมูตุ๋นพิเศษใส่เลือด", "Khanom jeen nam ngiao pork rib special", 120), 3),
  line(menu("e", "ผัดซีอิ๊วเส้นใหญ่หมูนุ่มไข่ดาวกรอบ", "Pad see ew", 1250), 1, { customNote: "เพิ่มผักบุ้งน้ำมันหอย", customAddOnPrice: 20 }),
  line(menu("f", "น้ำผึ้งมะนาวโซดา", "Honey lime soda", 55), 1),
];
const receipt = (lang) => ({ label: tableTitle("3-1", lang), items, total: 2177 });
const NOW = new Date(2026, 9, 23, 12, 30);

import { writeFileSync } from "node:fs";
const dumped = {};
const preview = (title, lines) => {
  if (process.env.PRINT_DUMP) {
    dumped[title] = lines;
    writeFileSync(process.env.PRINT_DUMP, JSON.stringify(dumped, null, 1));
  }
  if (!process.env.PRINT_PREVIEW) return;
  const ruler = "1234567890".repeat(3);
  console.log(`\n${title}\n|${ruler}|`);
  // เติมช่องว่างตามความกว้างที่พิมพ์จริง (ไม่ใช่ .length) ให้ขอบขวา | ตรงกับขอบกระดาษ
  lines.forEach((l) => {
    const pad = l.align === "center" ? Math.floor((LINE_WIDTH - displayWidth(l.text)) / 2) : 0;
    const text = " ".repeat(pad) + l.text;
    console.log(`|${text}${" ".repeat(Math.max(0, LINE_WIDTH - displayWidth(text)))}|`);
  });
};

test("displayWidth: สระบน/ล่าง/วรรณยุกต์ไม่กินช่อง, ำ กินช่อง", () => {
  assert.equal(displayWidth("ชาไทย"), 5);
  assert.equal(displayWidth("น้ำ"), 2); // น ้ ำ → ้ ไม่กินช่อง
  assert.equal(displayWidth("ซี่โครง"), 5); // ซ ี ่ โ ค ร ง → ี ่ ไม่กินช่อง
  assert.equal(displayWidth("ผัดซีอิ๊ว"), 5);
  assert.equal(displayWidth("ขนมจีนน้ำเงี้ยว"), 11);
  assert.equal(displayWidth("120฿"), 4);
});

test("receipt: every money figure ends exactly at column LINE_WIDTH (th + en), no ฿ anywhere", () => {
  for (const lang of ["th", "en"]) {
    const lines = layoutReceipt(receipt(lang), lang, NOW);
    preview(`ใบเสร็จ (${lang})`, lines);
    lines.forEach((l) => assert.ok(!l.text.includes("฿"), `${lang}: ฿ in "${l.text}"`));
    const head = lines.find((l) => l.text.endsWith(lang === "en" ? "(THB)" : "(บาท)"));
    assert.ok(head && displayWidth(head.text) === LINE_WIDTH, `${lang}: unit in the column header`);
    const money = lines.filter((l) => /\s\d+$/.test(l.text) && !l.text.includes("(+"));
    assert.equal(money.length, items.length + 1, `${lang}: one price per item + total`);
    money.forEach((l) => assert.equal(displayWidth(l.text), LINE_WIDTH, `${lang}: "${l.text}"`));
    // ไม่มีบรรทัดไหนเกินความกว้างกระดาษ
    lines.forEach((l) => assert.ok(displayWidth(l.text) <= LINE_WIDTH, `${lang} too wide: "${l.text}"`));
    assert.equal(lines[1].text, lang === "en" ? "Marble bench" : "ม้าหินอ่อน");
  }
});

test("receipt: long name wraps under the name, price stays on the first line, nothing lost", () => {
  const lines = layoutReceipt(receipt("th"), "th", NOW).map((l) => l.text);
  const i = lines.findIndex((l) => l.startsWith("3x ขนมจีน"));
  assert.ok(lines[i].endsWith(" 360"));
  assert.ok(lines[i + 1].startsWith("   ") && !/\d$/.test(lines[i + 1]), lines[i + 1]);
  const end = lines.findIndex((l, k) => k > i && /^\d+x /.test(l));
  const joined = lines.slice(i, end).map((l) => l.replace(/\s+\d+$/, "")).join("").replace(/\s/g, "");
  assert.equal(joined, "3xขนมจีนน้ำเงี้ยวซี่โครงหมูตุ๋นพิเศษใส่เลือด");
  // leading vowel ไม่หลุดไปท้ายบรรทัด
  lines.forEach((l) => assert.ok(!/[เแโใไ]$/.test(l.trimEnd()), `stranded leading vowel: "${l}"`));
});

test("columns: price at the same column no matter how many tone marks the name has", () => {
  const a = columns("1x ชาไทย", "45฿")[0];
  const b = columns("1x น้ำผึ้ง", "45฿")[0];
  const c = columns("1x ซี่โครงอ่อน", "45฿")[0];
  [a, b, c].forEach((l) => assert.equal(displayWidth(l), LINE_WIDTH));
  // เดิม (นับ .length) บรรทัดที่มีสระบน/วรรณยุกต์เติมช่องว่างน้อยไป → ราคาเลื่อนซ้าย
  assert.notEqual(b.length, LINE_WIDTH);
});

test("wrapLine: fills by printed width, restWidth applies from the second line", () => {
  const lines = wrapLine("ขนมจีนน้ำเงี้ยวซี่โครงหมูตุ๋นพิเศษใส่เลือดหมู", 15, 10);
  assert.ok(displayWidth(lines[0]) <= 15);
  lines.slice(1).forEach((l) => assert.ok(displayWidth(l) <= 10, l));
  assert.equal(lines.join(""), "ขนมจีนน้ำเงี้ยวซี่โครงหมูตุ๋นพิเศษใส่เลือดหมู");
});

const kitchenOrder = (table) => ({
  id: "o1", tableNumber: table, status: "in-progress", timestamp: new Date(2026, 9, 23, 12, 0),
  items: [line(menu("k", "ข้าวซอยไก่", "Khao soi", 70), 1)],
});
const categories = [{ id: "food", nameTh: "อาหาร", nameEn: "Food" }];

test("kitchen / counter / move tickets print the display name for the marble bench (3-1)", () => {
  for (const role of ["all", "kitchen", "inner", "counter"]) {
    for (const plan of planTickets(kitchenOrder("3-1"), role, categories)) {
      const texts = layoutTicket(kitchenOrder("3-1"), plan, "th").filter((l) => l.kind === "text").map((l) => l.text);
      assert.ok(texts.includes("ม้าหินอ่อน"), `${role}/${plan.station}`);
      assert.ok(!texts.some((t) => t.includes("3-1")), `${role}/${plan.station}`);
    }
  }
  const moved = { ...kitchenOrder("3-1"), moveId: "m1", movedFrom: "1-2" };
  const ticketOrder = buildMoveTicketOrder({ moveId: "m1", from: "1-2", to: "3-1", movedAt: new Date(), orders: [moved] });
  const banner = moveBanner("1-2", "3-1", "th");
  assert.equal(banner, "ย้ายจาก 1-2 -> ม้าหินอ่อน");
  const plan = planTickets(ticketOrder, "kitchen", categories)[0];
  const texts = layoutTicket(ticketOrder, plan, "th", banner).filter((l) => l.kind === "text").map((l) => l.text);
  assert.equal(texts.filter((t) => t === "ม้าหินอ่อน").length, 1);
  assert.equal(moveBanner("3-1", "2-4", "en"), "MOVED Marble bench -> 2-4");
});
