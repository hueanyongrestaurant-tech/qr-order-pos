// ข้อความที่ส่งไปเครื่องพิมพ์ (ใบเสร็จ/ตั๋วครัว/ใบย้ายโต๊ะ) — ตรรกะล้วน ไม่ต้องใช้ emulator
// PRINT_PREVIEW=1 พิมพ์ตัวอย่างใบเสร็จออกจอ, PRINT_DUMP=<file.json> เขียนบรรทัดลงไฟล์ (คอลัมน์ตามที่เครื่องพิมพ์วางจริง: สระบน/ล่าง วรรณยุกต์ไม่กินช่อง)
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_WIDTH, columns, displayWidth, wrapLine } from "../../src/app/staff/printText";
import { formatMoney, layoutReceipt, layoutReceiptNew } from "../../src/app/staff/receiptLayout";
import { RECEIPT_CASES, RECEIPT_NOW } from "./receiptFixtures.mjs";
import golden from "./fixtures/receipt-classic-golden.json";
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
  const ruler = "1234567890".repeat(3).slice(0, LINE_WIDTH);
  console.log(`\n${title}\n|${ruler}|`);
  // เติมช่องว่างตามความกว้างที่พิมพ์จริง (ไม่ใช่ .length) ให้ขอบขวา | ตรงกับขอบกระดาษ
  lines.forEach((l) => {
    const pad = l.align === "center" ? Math.floor((LINE_WIDTH - displayWidth(l.text)) / 2) : 0;
    const text = " ".repeat(pad) + l.text;
    const mark = [l.bold && "ตัวหนา", l.tall && "สูง x2"].filter(Boolean).join(" ");
    console.log(`|${text}${" ".repeat(Math.max(0, LINE_WIDTH - displayWidth(text)))}|${mark ? "  ← " + mark : ""}`);
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

// ─── ใบเสร็จแบบใหม่ (สวิตช์ status/receipt.newLayout) ─────────────────────────────────────────────
const PAYMENTS = {
  cash: { method: "cash", cashReceived: 2500 },
  transfer: { method: "transfer" },
  split: { method: "split", transferAmount: 1500, cashReceived: 1000 },
};
const FOOTER = "โทร 081-234-5678\nWi-Fi: HueanYong / pass 12345678";
const newReceipt = (lang, payment, footer = "", c = RECEIPT_CASES[0]) =>
  layoutReceiptNew({ label: c.label[lang], items: c.items, total: c.total, payment }, lang, RECEIPT_NOW, footer);
const texts = (lines) => lines.map((l) => l.text);
const unit = (lang) => (lang === "en" ? " THB" : " บาท");

test("switch off: classic receipt is identical to the golden captured before the new layout (97e66e7)", () => {
  for (const c of RECEIPT_CASES) for (const lang of ["th", "en"]) {
    const data = { label: c.label[lang], items: c.items, total: c.total };
    const lines = layoutReceipt(data, lang, RECEIPT_NOW);
    assert.deepEqual(lines, golden[`${c.name}/${lang}`], `${c.name}/${lang}`);
    // ไม่มีบรรทัด tall → nativePrinter ส่ง SIZE_NORMAL ทุกบรรทัดเหมือนเดิม = byte เดิม
    assert.ok(lines.every((l) => !("tall" in l)), `${c.name}/${lang}: tall in classic`);
    // ข้อมูลชำระเงินที่ส่งมาด้วยไม่มีผลกับแบบเดิม
    for (const payment of Object.values(PAYMENTS))
      assert.deepEqual(layoutReceipt({ ...data, payment }, lang, RECEIPT_NOW), lines);
  }
  assert.equal(Object.keys(golden).length, RECEIPT_CASES.length * 2);
});

test("new receipt: every line ≤ LINE_WIDTH, every money figure ends at column LINE_WIDTH", () => {
  for (const lang of ["th", "en"]) for (const [name, payment] of [...Object.entries(PAYMENTS), ["none", undefined]]) {
    for (const c of RECEIPT_CASES) {
      const lines = newReceipt(lang, payment, FOOTER, c);
      if (c === RECEIPT_CASES[0] && (lang === "th" || name === "split")) preview(`ใบเสร็จแบบใหม่ ${name} (${lang})`, lines);
      lines.forEach((l) => assert.ok(displayWidth(l.text) <= LINE_WIDTH, `${lang}/${name} too wide: "${l.text}"`));
      const money = lines.filter((l) => l.text.endsWith(unit(lang)));
      money.forEach((l) => assert.equal(displayWidth(l.text), LINE_WIDTH, `${lang}/${name}: "${l.text}"`));
      // 1 บรรทัดต่อรายการ + ยอดสุทธิ + ส่วนชำระเงิน
      const payLines = { cash: 2, transfer: 0, split: 4, none: 0 }[name];
      assert.equal(money.length, c.items.length + 1 + payLines, `${lang}/${name}/${c.name}`);
      assert.ok(lines.every((l) => !l.text.includes("฿") && !l.text.includes("•")), "฿ / • can't print in TIS-620");
    }
  }
});

test("new receipt: header, column header, items, thousands comma, summary (th)", () => {
  const t = texts(newReceipt("th", PAYMENTS.cash));
  assert.deepEqual(t.slice(0, 3), ["ครัวเฮือนยอง", "ม้าหินอ่อน", RECEIPT_NOW.toLocaleString("th-TH")]);
  assert.ok(/^จำนวน\/รายการ +ยอดเงิน$/.test(t[4]) && displayWidth(t[4]) === LINE_WIDTH, t[4]);
  assert.ok(t.includes(`x1 ชาไทย${" ".repeat(LINE_WIDTH - displayWidth("x1 ชาไทย") - displayWidth("45 บาท"))}45 บาท`));
  assert.ok(t.some((l) => l.startsWith("x1 ผัดซีอิ๊ว") && l.endsWith(" 1,270 บาท")));
  assert.ok(t.includes("   - เพิ่มผักบุ้งน้ำมันหอย (+20)"));
  assert.ok(t.some((l) => l.startsWith("   - เผ็ดกลาง, เส้นใหญ่")));
  assert.ok(t.includes("รวม 22 รายการ"));
  const net = newReceipt("th", PAYMENTS.cash).find((l) => l.text.startsWith("ยอดสุทธิ"));
  assert.ok(net.text.endsWith(" 2,140 บาท") && net.bold && net.tall, JSON.stringify(net));
  assert.equal(formatMoney(5), "5");
  assert.equal(formatMoney(1000), "1,000");
  assert.equal(formatMoney(1234567), "1,234,567");
});

test("new receipt: long name wraps under the name, amount stays on the first line", () => {
  for (const lang of ["th", "en"]) {
    const t = texts(newReceipt(lang, undefined));
    const i = t.findIndex((l) => l.startsWith("x3 "));
    assert.ok(t[i].endsWith(` 360${unit(lang)}`), t[i]);
    assert.ok(t[i + 1].startsWith("   ") && !t[i + 1].endsWith(unit(lang)), t[i + 1]);
    const name = lang === "en" ? "Khanom jeen nam ngiao pork rib special" : "ขนมจีนน้ำเงี้ยวซี่โครงหมูตุ๋นพิเศษใส่เลือด";
    const end = t.findIndex((l, k) => k > i && /^x\d+ /.test(l));
    const joined = [t[i].replace(/\s+360.*$/, ""), ...t.slice(i + 1, end)].join("").replace(/\s/g, "");
    assert.equal(joined, `x3${name}`.replace(/\s/g, ""));
  }
});

test("new receipt: payment section — cash / transfer / mixed, change at double height", () => {
  const row = (lines, label) => lines.find((l) => l.text.startsWith(label));
  const cash = newReceipt("th", PAYMENTS.cash);
  assert.ok(row(cash, "ชำระโดย").text.endsWith(" เงินสด"));
  assert.ok(row(cash, "รับเงินมา").text.endsWith(" 2,500 บาท"));
  assert.ok(row(cash, "เงินทอน").text.endsWith(" 360 บาท") && row(cash, "เงินทอน").tall);

  const transfer = newReceipt("th", PAYMENTS.transfer);
  assert.ok(row(transfer, "ชำระโดย").text.endsWith(" โอนเงิน"));
  assert.ok(!row(transfer, "รับเงินมา") && !row(transfer, "เงินทอน"));

  const split = texts(newReceipt("th", PAYMENTS.split));
  const k = split.findIndex((l) => l.startsWith("ชำระโดย"));
  assert.ok(split[k].endsWith(" เงินสด+โอน"));
  assert.ok(split[k + 1].startsWith("โอนเงิน") && split[k + 1].endsWith(" 1,500 บาท"));
  assert.ok(split[k + 2].startsWith("เงินสด") && split[k + 2].endsWith(" 640 บาท"));
  assert.ok(split[k + 3].startsWith("รับเงินมา") && split[k + 3].endsWith(" 1,000 บาท"));
  assert.ok(split[k + 4].startsWith("เงินทอน") && split[k + 4].endsWith(" 360 บาท"));

  const en = texts(newReceipt("en", PAYMENTS.split));
  assert.ok(en.some((l) => l.startsWith("Paid by") && l.endsWith(" Cash+Transfer")));
  assert.ok(en.some((l) => l.startsWith("Change") && l.endsWith(" 360 THB")));
});

test("new receipt: missing payment data leaves out only that line", () => {
  const has = (lines, label) => lines.some((l) => l.text.startsWith(label));
  // ไม่มีข้อมูลชำระเงินเลย = ไม่มีส่วนชำระเงิน (และไม่มีเส้นคั่นของส่วนนั้น)
  const none = newReceipt("th", undefined);
  assert.ok(!has(none, "ชำระโดย"));
  assert.equal(none.filter((l) => l.text === "-".repeat(LINE_WIDTH)).length, 3);
  // บิลเก่า: รู้แค่วิธีจ่าย
  const old = newReceipt("th", { method: "cash" });
  assert.ok(has(old, "ชำระโดย") && !has(old, "รับเงินมา") && !has(old, "เงินทอน"));
  // แยกจ่ายแต่ไม่มียอดโอน: ไม่รู้ส่วนเงินสด → ไม่มีบรรทัดโอน/เงินสด/เงินทอน แต่ยังมีรับเงินมา
  const splitNoTransfer = newReceipt("th", { method: "split", cashReceived: 1000 });
  assert.ok(has(splitNoTransfer, "รับเงินมา") && !has(splitNoTransfer, "โอนเงิน") && !has(splitNoTransfer, "เงินทอน"));
  // รับเงินน้อยกว่ายอด (ข้อมูลเพี้ยน) = ไม่พิมพ์เงินทอนติดลบ
  assert.ok(!has(newReceipt("th", { method: "cash", cashReceived: 100 }), "เงินทอน"));
});

test("new receipt: footer — empty = no line, up to 3 lines centered, long line wraps, thank-you last", () => {
  const sep = "-".repeat(LINE_WIDTH);
  const empty = newReceipt("th", PAYMENTS.cash, "  \n ");
  assert.deepEqual(texts(empty.slice(-2)), [sep, "ขอบคุณที่ใช้บริการค่ะ"]);
  const lines = newReceipt("th", PAYMENTS.cash, FOOTER.replace("\n", "\n\n"));
  const tail = lines.slice(texts(lines).lastIndexOf(sep) + 1);
  assert.deepEqual(texts(tail), ["โทร 081-234-5678", "Wi-Fi: HueanYong / pass", "12345678", "ขอบคุณที่ใช้บริการค่ะ"]);
  assert.ok(tail.every((l) => l.align === "center"));
});
