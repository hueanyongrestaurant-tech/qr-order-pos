// ─── "ที่สั่งไปแล้ว": สรุปรายการของโต๊ะให้ลูกค้าดู — ตรรกะล้วน (ไม่แตะ Firestore) แยกไว้ให้ทดสอบได้ ─────────
//
// ลูกค้าอ่าน orders ไม่ได้ (rules) — เครื่องพนักงานที่ฟังออเดอร์ค้างอยู่แล้วสร้างสรุปของแต่ละโต๊ะจากข้อมูลในหน่วยความจำ
// แล้วเขียนลง tableViews/{รหัสลิงก์ของโต๊ะ} (ดู tableViewStore.ts) ลูกค้าเปิดได้เฉพาะ doc ที่รู้รหัส
//
// สรุปมีแค่: ชื่อเมนู + ตัวเลือก, จำนวน, ราคา, ยอดรวม — ไม่มีสถานะเสิร์ฟ ไม่มีรายการที่ยกเลิก (void/cancel)
// ปิดบิลแล้วต้องหาย: ออเดอร์ที่จ่ายแล้วไม่อยู่ใน listener → สรุปของโต๊ะนั้นว่าง เครื่องพนักงานเขียนทับให้เอง
// กันกรณีเครื่องที่ปิดบิลยังเป็นแอปเก่า (ไม่เขียนสรุป): ลูกค้าเทียบเวลาปิดบิล (status/tableClosures) กับเวลาของสรุป
// ปิดบิลทีหลังสรุป = ถือว่าโต๊ะว่าง (decodeTableView)

import { fnv1a, stableStringify } from "./menuSnapshot";
import type { CartItem, Language, Order } from "./types";
import { cartItemKey, cartItemUnitPrice, formatOptionDetails } from "./utils";

export const TABLE_VIEW_VERSION = 1;
// รายการที่เครื่องนี้เพิ่งส่ง แต่สรุปยังไม่มี — โชว์เป็น "กำลังส่งเข้าร้าน" ได้นานสุดเท่านี้
// (เกินแล้วยังไม่ขึ้น = ร้านยกเลิก หรือไม่มีเครื่องพนักงานเปิดอยู่ — ไม่โชว์ค้างตลอดไป)
export const PENDING_SHOW_MS = 10 * 60 * 1000;

export interface TableViewLine {
  th: string;
  en: string;
  optTh: string; // ตัวเลือก (+ หมายเหตุ/รายการเพิ่ม) ภาษาไทย — ว่าง = ไม่มี
  optEn: string;
  qty: number;
  amount: number; // ราคารวมของบรรทัด (ราคาต่อชิ้น × จำนวน)
}

export interface TableViewData {
  lines: TableViewLine[];
  total: number;
  orderIds: string[]; // ออเดอร์ที่รวมอยู่ในสรุปนี้ — ลูกค้าใช้เช็คว่ารายการที่เพิ่งส่งเข้าแล้วหรือยัง
}

const isOpenDineIn = (o: Order, table: string) =>
  !o.isTakeaway && o.tableNumber === table && (o.status === "in-progress" || o.status === "awaiting-payment");

function optionText(ci: CartItem, lang: Language): string {
  const parts = [formatOptionDetails(ci, lang)];
  if (ci.note) parts.push(`"${ci.note}"`);
  if (ci.customNote) parts.push(`+ ${ci.customNote}`);
  return parts.filter(Boolean).join(" · ");
}

export function lineFromCartItem(ci: CartItem): TableViewLine {
  return {
    th: ci.item.name.th,
    en: ci.item.name.en || ci.item.name.th,
    optTh: optionText(ci, "th"),
    optEn: optionText(ci, "en"),
    qty: ci.quantity,
    amount: cartItemUnitPrice(ci) * ci.quantity,
  };
}

// รวมทุกรอบที่ยังไม่ปิดบิลของโต๊ะ — เมนูเดียวกัน ตัวเลือกเหมือนกัน ราคาเท่ากัน = บรรทัดเดียว บวกจำนวน
// เรียงตามรายการที่สั่งก่อนขึ้นก่อน
export function buildTableView(orders: Order[], table: string): TableViewData {
  const open = orders.filter((o) => isOpenDineIn(o, table)).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const merged = new Map<string, TableViewLine>();
  open.forEach((o) => {
    (o.items || []).forEach((ci) => {
      if (ci.voided || ci.quantity <= 0) return;
      const line = lineFromCartItem(ci);
      const key = `${cartItemKey(ci)}|${cartItemUnitPrice(ci)}`;
      const existing = merged.get(key);
      merged.set(key, existing ? { ...existing, qty: existing.qty + line.qty, amount: existing.amount + line.amount } : line);
    });
  });
  const lines = [...merged.values()];
  return {
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    orderIds: open.map((o) => o.id).sort(),
  };
}

export interface EncodedTableView {
  data: string;
  hash: string;
}

export function encodeTableView(view: TableViewData): EncodedTableView {
  const data = stableStringify(view);
  return { data, hash: fnv1a(data) };
}

// ฝั่งลูกค้า — raw = ข้อมูลใน tableViews/{token}, closedAtMs = เวลาปิดบิลล่าสุดของโต๊ะ (0 = ไม่เคย, null = อ่านไม่ได้)
// null = ข้อมูลเสีย/รุ่นไม่ตรง (ผู้เรียกแสดงว่าโหลดไม่ได้)
export function decodeTableView(
  raw: { version?: unknown; data?: unknown; updatedAtMs?: number } | undefined,
  closedAtMs: number | null,
): (TableViewData & { updatedAtMs: number }) | null {
  if (!raw || raw.version !== TABLE_VIEW_VERSION || typeof raw.data !== "string") return null;
  const updatedAtMs = raw.updatedAtMs ?? 0;
  if (closedAtMs !== null && closedAtMs > updatedAtMs) {
    // ปิดบิลหลังสรุปล่าสุด — ของในสรุปเป็นของบิลที่ปิดไปแล้ว
    return { lines: [], total: 0, orderIds: [], updatedAtMs };
  }
  try {
    const parsed = JSON.parse(raw.data) as Partial<TableViewData>;
    if (!Array.isArray(parsed.lines) || !Array.isArray(parsed.orderIds) || typeof parsed.total !== "number") return null;
    return { lines: parsed.lines, total: parsed.total, orderIds: parsed.orderIds, updatedAtMs };
  } catch {
    return null;
  }
}

// ─── รายการที่เครื่องนี้ส่งไป (เก็บใน sessionStorage ของแท็บ) ───
export interface SentOrder {
  id: string;
  sentAt: number; // Date.now() ของมือถือ — ใช้นับระยะเวลาเท่านั้น
  lines: TableViewLine[];
  // updatedAt (เวลา server) ของสรุปที่อ่านได้ตอนเช็คก่อนส่ง — undefined = อ่านไม่ได้
  viewUpdatedAtMs?: number;
}

// ที่เครื่องนี้ส่งแล้ว แต่สรุปยังไม่มี — เฉพาะที่ส่งไม่เกิน PENDING_SHOW_MS และสรุปยังไม่ถูกเขียนใหม่หลังส่ง
// (สรุปถูกเขียนใหม่แล้วแต่ไม่มีออเดอร์นี้ = ร้านยกเลิก/ย้ายโต๊ะ/ปิดบิลไปแล้ว ไม่ใช่ "กำลังส่ง")
export function pendingSentOrders(
  sent: SentOrder[],
  view: (TableViewData & { updatedAtMs: number }) | null,
  now: number,
): SentOrder[] {
  const included = new Set(view?.orderIds ?? []);
  return sent.filter((s) =>
    !included.has(s.id)
    && now - s.sentAt <= PENDING_SHOW_MS
    && (s.viewUpdatedAtMs === undefined || !view || view.updatedAtMs <= s.viewUpdatedAtMs));
}

// ─── รหัสลิงก์ของโต๊ะ ───
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // ตัดตัวที่สับสน (0/O, 1/l/I)
export const TOKEN_LENGTH = 16; // ~93 บิต — สุ่มเดาไม่ได้

export function newTableToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    // ตัดค่าที่ทำให้เอนเอียง (256 ไม่หารด้วยจำนวนตัวอักษรลงตัว)
    const limit = 256 - (256 % TOKEN_ALPHABET.length);
    random(TOKEN_LENGTH * 2).forEach((b) => {
      if (b < limit && out.length < TOKEN_LENGTH) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
    });
  }
  return out;
}

export const isTableTokenShape = (t: string): boolean =>
  t.length === TOKEN_LENGTH && [...t].every((c) => TOKEN_ALPHABET.includes(c));
