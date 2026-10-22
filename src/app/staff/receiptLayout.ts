// ─── ใบเสร็จ: จัดหน้าเป็นบรรทัดข้อความ (ฟังก์ชันล้วน) — nativePrinter.ts แปลงเป็น ESC/POS ─────
// ทั้งใบขนาดปกติ ตัวเลขเงินทุกบรรทัด (รายการ + ยอดรวม) ชิดขวาที่ช่อง LINE_WIDTH ตรงคอลัมน์เดียวกัน
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
  ];
  const detail = (text: string) =>
    wrapLine(text, LINE_WIDTH - displayWidth(DETAIL_INDENT)).forEach((l) => lines.push(left(DETAIL_INDENT + l)));

  data.items.forEach((ci) => {
    const name = lang === "en" ? ci.item.name.en : ci.item.name.th;
    const qty = `${ci.quantity}x `;
    // ฿ อยู่ "หลัง" ตัวเลขตามที่ขอ (เช่น "210฿")
    columns(`${qty}${name}`, `${cartItemTotal(ci)}${t.thb}`, LINE_WIDTH, " ".repeat(displayWidth(qty))).forEach((l) =>
      lines.push(left(l)),
    );
    const opt = formatOptionDetails(ci, lang);
    if (opt) detail(opt);
    if (ci.customNote) detail(`+ ${ci.customNote} (+${ci.customAddOnPrice || 0}${t.thb})`);
  });

  lines.push(left(RULE));
  columns(lang === "en" ? "Total" : "รวมทั้งหมด", `${data.total}${t.thb}`).forEach((l) => lines.push(left(l, true)));
  // ไม่พิมพ์ส่วนการชำระเงิน (ชำระโดย/รับเงิน/เงินทอน/ยอดเงินสด-โอน) — ใบเสร็จมีแค่รายการ + ยอดรวม
  lines.push(left(RULE));
  lines.push(center(lang === "en" ? "Thank you for your visit" : "ขอบคุณที่ใช้บริการค่ะ"));
  return lines;
}
