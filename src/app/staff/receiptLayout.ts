// ─── ใบเสร็จ: จัดหน้าเป็นบรรทัดข้อความ (ฟังก์ชันล้วน) — nativePrinter.ts แปลงเป็น ESC/POS ─────
// ทั้งใบขนาดปกติ ตัวเลขเงินทุกบรรทัด (รายการ + ยอดรวม) ชิดขวาที่ช่อง LINE_WIDTH ตรงคอลัมน์เดียวกัน
// ไม่มี ฿ ที่ตัวเลข — บอกหน่วยครั้งเดียวที่หัวคอลัมน์ "(บาท)" / "(THB)"
// ชื่อเมนูยาวตัดขึ้นบรรทัดใหม่ใต้ชื่อ (เยื้องตรงหลัง "2x ") ราคายังอยู่บรรทัดแรก

import type { Language } from "../types";
import { T } from "../translations";
import { cartItemTotal, formatOptionDetails } from "../utils";
import type { ReceiptData } from "./ticket";
import { LINE_WIDTH, columns, displayWidth, wrapLine } from "./printText";

export interface ReceiptLine {
  text: string;
  align: "left" | "center";
  bold?: boolean;
  tall?: boolean; // สูง 2 เท่า กว้างเท่าเดิม (GS ! 0x01) — ใช้เฉพาะใบเสร็จแบบใหม่ คอลัมน์จึงไม่เลื่อน
}

const left = (text: string, bold?: boolean): ReceiptLine => ({ text, align: "left", ...(bold ? { bold } : {}) });
const center = (text: string, bold?: boolean): ReceiptLine => ({ text, align: "center", ...(bold ? { bold } : {}) });
const RULE = "-".repeat(LINE_WIDTH);
const DETAIL_INDENT = "  ";

export function layoutReceipt(data: ReceiptData, lang: Language, now: Date): ReceiptLine[] {
  const t = T[lang];
  const lines: ReceiptLine[] = [
    center(t.appName, true),
    center(data.label),
    center(now.toLocaleString(lang === "th" ? "th-TH" : "en-US")),
    left(RULE),
    ...columns(lang === "en" ? "Item" : "รายการ", lang === "en" ? "(THB)" : "(บาท)").map((l) => left(l)),
  ];
  const detail = (text: string) =>
    wrapLine(text, LINE_WIDTH - displayWidth(DETAIL_INDENT)).forEach((l) => lines.push(left(DETAIL_INDENT + l)));

  data.items.forEach((ci) => {
    const name = lang === "en" ? ci.item.name.en : ci.item.name.th;
    const qty = `${ci.quantity}x `;
    columns(`${qty}${name}`, String(cartItemTotal(ci)), LINE_WIDTH, " ".repeat(displayWidth(qty))).forEach((l) =>
      lines.push(left(l)),
    );
    const opt = formatOptionDetails(ci, lang);
    if (opt) detail(opt);
    if (ci.customNote) detail(`+ ${ci.customNote} (+${ci.customAddOnPrice || 0})`);
  });

  lines.push(left(RULE));
  columns(lang === "en" ? "Total" : "รวมทั้งหมด", String(data.total)).forEach((l) => lines.push(left(l, true)));
  // ไม่พิมพ์ส่วนการชำระเงิน (ชำระโดย/รับเงิน/เงินทอน/ยอดเงินสด-โอน) — ใบเสร็จมีแค่รายการ + ยอดรวม
  lines.push(left(RULE));
  lines.push(center(lang === "en" ? "Thank you for your visit" : "ขอบคุณที่ใช้บริการค่ะ"));
  return lines;
}

// ─── ใบเสร็จแบบใหม่ (ทดลอง) — เปิดด้วยสวิตช์ status/receipt.newLayout ปิด = layoutReceipt ด้านบนเหมือนเดิมทุกตัวอักษร ─────
// ตัวเลขเงินทุกบรรทัดลงท้าย "บาท"/"THB" ชิดขวาที่ช่อง LINE_WIDTH มีคอมมาหลักพัน ยอดสุทธิ + เงินทอนสูง 2 เท่า (กว้างเท่าเดิม)
// ส่วนชำระเงินใช้ data.payment — ไม่มี (หรือข้อมูลบางตัวไม่มี) = ข้ามเฉพาะบรรทัดนั้น
// หัวข้อย่อยตัวเลือก/หมายเหตุใช้ "-" ไม่ใช่ "•" — • ไม่มีใน TIS-620 เครื่องพิมพ์จะพิมพ์เป็น "?"

export const formatMoney = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const BULLET = "   - ";
const BULLET_INDENT = "     ";

export function layoutReceiptNew(data: ReceiptData, lang: Language, now: Date, footer = ""): ReceiptLine[] {
  const t = T[lang];
  const en = lang === "en";
  const baht = (n: number) => `${formatMoney(n)} ${en ? "THB" : "บาท"}`;
  const lines: ReceiptLine[] = [
    center(t.appName, true),
    center(data.label),
    center(now.toLocaleString(en ? "en-US" : "th-TH")),
    left(RULE),
    ...columns(en ? "Qty/Item" : "จำนวน/รายการ", en ? "Amount" : "ยอดเงิน").map((l) => left(l)),
  ];
  const push = (texts: string[], opts: Partial<ReceiptLine> = {}) => texts.forEach((text) => lines.push({ ...left(text), ...opts }));
  const bullet = (text: string) =>
    push(wrapLine(text, LINE_WIDTH - BULLET.length, LINE_WIDTH - BULLET_INDENT.length).map((l, i) => (i === 0 ? BULLET : BULLET_INDENT) + l));

  data.items.forEach((ci) => {
    const qty = `x${ci.quantity} `;
    push(columns(`${qty}${en ? ci.item.name.en : ci.item.name.th}`, baht(cartItemTotal(ci)), LINE_WIDTH, " ".repeat(displayWidth(qty))));
    const opt = formatOptionDetails(ci, lang);
    if (opt) bullet(opt);
    if (ci.customNote) bullet(`${ci.customNote} (+${ci.customAddOnPrice || 0})`);
  });

  lines.push(left(RULE));
  const count = data.items.reduce((s, ci) => s + ci.quantity, 0);
  lines.push(left(en ? `${count} item${count === 1 ? "" : "s"}` : `รวม ${count} รายการ`));
  push(columns(en ? "Net total" : "ยอดสุทธิ", baht(data.total)), { bold: true, tall: true });

  const p = data.payment;
  if (p) {
    lines.push(left(RULE));
    const method = p.method === "cash" ? (en ? "Cash" : "เงินสด") : p.method === "transfer" ? (en ? "Transfer" : "โอนเงิน") : en ? "Cash+Transfer" : "เงินสด+โอน";
    push(columns(en ? "Paid by" : "ชำระโดย", method));
    const transfer = p.method === "split" ? p.transferAmount : undefined;
    if (transfer !== undefined) {
      push(columns(en ? "Transfer" : "โอนเงิน", baht(transfer)));
      push(columns(en ? "Cash" : "เงินสด", baht(data.total - transfer)));
    }
    if (p.method !== "transfer" && p.cashReceived !== undefined) {
      push(columns(en ? "Received" : "รับเงินมา", baht(p.cashReceived)));
      // แยกจ่ายแต่ไม่รู้ยอดโอน = ไม่รู้ว่าส่วนเงินสดเท่าไร คิดเงินทอนไม่ได้
      const due = p.method === "cash" ? data.total : transfer !== undefined ? data.total - transfer : undefined;
      if (due !== undefined && p.cashReceived >= due) push(columns(en ? "Change" : "เงินทอน", baht(p.cashReceived - due)), { tall: true });
    }
  }

  lines.push(left(RULE));
  footer
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l) => wrapLine(l, LINE_WIDTH).forEach((w) => lines.push(center(w))));
  lines.push(center(en ? "Thank you for your visit" : "ขอบคุณที่ใช้บริการค่ะ"));
  return lines;
}
