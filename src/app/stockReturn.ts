// ─── คืนสต็อกตอนยกเลิก/ลดจำนวน (logic ล้วน ไม่แตะ Firestore — ทดสอบได้) ─────────────────────
// ตอนสั่ง (createOrderTakingStock) แต่ละบรรทัดจดไว้ว่าตัดอะไรไป: stockDocs = doc ที่ตัด (doc ละ 1 ต่อชิ้น),
// stockQty = ตัดไปกี่ชิ้น — บรรทัดที่ไม่มี stockDocs (ไม่ได้ตัด หรือออเดอร์เก่าก่อนมีฟิลด์นี้) ไม่คืนอะไรเลย
// ชิ้นที่ "ยังตัดค้างอยู่" ของบรรทัดที่ยังมีผล = min(stockQty, quantity) — ชิ้นที่บวกเพิ่มในหน้าจ่ายเงินไม่ได้ตัด
// จึงนับเป็นชิ้นที่ "ไม่ได้ตัด" ก่อนเสมอ: ลดจาก 3 (ตัด 2) เหลือ 2 = ไม่มีอะไรต้องคืน
// พนักงานเลือกเองทุกครั้งว่าคืนหรือไม่ (ครัว: ต้องกดเลือก / เคาน์เตอร์: ติ๊ก) — ไม่คืน = ของถูกใช้ไปแล้ว
// บรรทัดที่ยกเลิกแล้วคืนสต็อก ติด stockReturned — คืนรายการ (restore) ต้องตัดกลับ ไม่พอ = คืนรายการไม่ได้

import type { CartItem, MenuItem } from "./types";
import { servedQtyOf, type ServeState } from "./utils";
import type { StockEntry } from "./stock";
import { prepIsOut, type PrepEntry } from "./prep";

// เปิดขายคืนเองได้ไหม: ระบบเป็นคนกด "หมด" เพราะสต็อกของเมนูเองเหลือ 0 (ธง soldOutByStock) และตอนนี้กลับมา > 0
// (หรือไม่จำกัดแล้ว) และไม่มีของเตรียมที่ผูกทั้งเมนูหมดอยู่ | กด "หมด" เอง = ไม่มีธง = ไม่เปิด | เมนูที่ซ่อนไม่แตะ
export function stockReopenAllowed(m: MenuItem, own: StockEntry | undefined, prepMap: Map<string, PrepEntry>): boolean {
  if (!m.soldOut || !m.soldOutByStock || m.active === false) return false;
  if (own && own.remaining <= 0) return false;
  return !(m.prepIds ?? []).some((p) => prepIsOut(prepMap.get(p)));
}

// ชิ้นที่บรรทัดนี้ยังตัดสต็อกค้างอยู่ (บรรทัดที่ยกเลิกแล้วคืนสต็อกไปแล้ว = 0)
export function stockOutUnits(ci: CartItem): number {
  if (!ci.stockDocs?.length || ci.stockReturned) return 0;
  return Math.max(0, Math.min(Math.floor(ci.stockQty ?? ci.quantity), ci.quantity));
}

// บรรทัดที่ยังตัดค้าง q ชิ้น เหลือจำนวน keepQty → คืนได้กี่ชิ้น และบรรทัดที่เหลือยังตัดค้างกี่ชิ้น
export function splitStock(ci: CartItem, keepQty: number): { returnQty: number; keepStock: number } {
  const taken = stockOutUnits(ci);
  const keepStock = Math.min(taken, Math.max(0, keepQty));
  return { returnQty: taken - keepStock, keepStock };
}

// จำนวนที่ต้องคืนต่อ stock doc (รวมหลายบรรทัด) — doc ละ qty ต่อบรรทัด เหมือนตอนตัด (stockNeeds)
export function returnNeeds(lines: { docs: string[]; qty: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  lines.forEach(({ docs, qty }) => {
    if (qty <= 0) return;
    new Set(docs).forEach((id) => out.set(id, (out.get(id) ?? 0) + qty));
  });
  return out;
}

// คืน: doc ที่ไม่มีแล้ว / ไม่มีจำนวน (ไม่จำกัด) ข้าม | current = remaining ล่าสุดใน transaction
export function planStockReturn(needs: Map<string, number>, current: Map<string, number | undefined>): Map<string, number> {
  const updates = new Map<string, number>();
  needs.forEach((n, id) => {
    const r = current.get(id);
    if (r !== undefined && n > 0) updates.set(id, r + n);
  });
  return updates;
}

// ตัดกลับตอนคืนรายการ — ไม่พอสักตัว = ไม่ตัดเลย (shortIds) | doc ไม่มี/ไม่จำกัด ข้าม
export function planStockRetake(needs: Map<string, number>, current: Map<string, number | undefined>):
  { ok: true; updates: Map<string, number> } | { ok: false; shortIds: string[] } {
  const updates = new Map<string, number>();
  const shortIds: string[] = [];
  needs.forEach((n, id) => {
    const r = current.get(id);
    if (r === undefined || n <= 0) return;
    if (r < n) shortIds.push(id);
    else updates.set(id, r - n);
  });
  return shortIds.length > 0 ? { ok: false, shortIds } : { ok: true, updates };
}

// ─── หน้าต่างถาม "คืนสต็อกไหม" ───────────────────────────────────────────────────
// station: kitchen = ต้องกดเลือก "ครัวยังไม่ทำ/ทำแล้ว" (ไม่มีค่าเริ่มต้น) | counter = ติ๊ก (ค่าเริ่มต้น = ยังไม่เสิร์ฟ → คืน)
export type StockStation = "kitchen" | "counter";

export interface StockPromptLine {
  key: string;        // `${orderId}:${cartId}` — คำตอบส่งกลับด้วย key นี้
  orderId: string;
  cartId: string;
  item: CartItem;
  qty: number;        // จำนวนที่จะคืนถ้าเลือกคืน
  station: StockStation;
  served: boolean;    // ชิ้นที่ยกเลิก/ลดนี้มีชิ้นที่เสิร์ฟแล้วรวมอยู่ (เคาน์เตอร์: ไม่ติ๊กให้)
}

export const promptKey = (orderId: string, cartId: string) => `${orderId}:${cartId}`;

// ค่าเริ่มต้นของแต่ละบรรทัด — ครัว = ยังไม่เลือก (undefined) | เคาน์เตอร์ = ติ๊กเมื่อยังไม่เสิร์ฟ
export function defaultStockChoices(lines: StockPromptLine[]): Map<string, boolean | undefined> {
  return new Map(lines.map((l) => [l.key, l.station === "counter" ? !l.served : undefined]));
}

// กดยืนยันได้เมื่อทุกบรรทัดครัวเลือกแล้ว
export function stockChoicesComplete(lines: StockPromptLine[], choices: Map<string, boolean | undefined>): boolean {
  return lines.every((l) => l.station === "counter" || choices.get(l.key) !== undefined);
}

// บรรทัดนี้มีสต็อกให้คืนจริงไหม (ดูจากข้อมูลในเครื่อง: doc ยังมีจำนวนอยู่) — ไม่มี = ไม่ต้องถาม
// trackedNow(id) = doc นี้ยังมีและมีจำนวน (ไม่ใช่ไม่จำกัด)
function promptLine(
  orderId: string, ci: CartItem, qty: number, served: boolean,
  stationOf: (ci: CartItem) => StockStation, trackedNow: (docId: string) => boolean,
): StockPromptLine[] {
  if (qty <= 0 || !(ci.stockDocs ?? []).some(trackedNow)) return [];
  return [{ key: promptKey(orderId, ci.cartId), orderId, cartId: ci.cartId, item: ci, qty, station: stationOf(ci), served }];
}

// ยกเลิกรายการ: n ชิ้น (ปุ่ม ✕ — เฉพาะชิ้นที่ยังไม่เสิร์ฟ) หรือทั้งบรรทัด (wholeLine — กด − จนเหลือ 0 ในหน้าจ่ายเงิน)
export function voidPromptLines(
  order: ServeState & { id: string },
  ci: CartItem,
  opts: { qty?: number; wholeLine?: boolean },
  stationOf: (ci: CartItem) => StockStation,
  trackedNow: (docId: string) => boolean,
): StockPromptLine[] {
  const served = servedQtyOf(order, ci);
  const n = opts.wholeLine ? ci.quantity : Math.max(1, Math.min(opts.qty ?? ci.quantity, ci.quantity - served));
  const keep = ci.quantity - n;
  return promptLine(order.id, ci, splitStock(ci, keep).returnQty, served > keep, stationOf, trackedNow);
}

// ลดจำนวน (หน้าจ่ายเงิน) เหลือ newQty — ชิ้นที่หายไปมีชิ้นเสิร์ฟแล้วรวมอยู่เมื่อเสิร์ฟแล้วมากกว่าที่เหลือ
export function adjustPromptLines(
  order: ServeState & { id: string },
  ci: CartItem,
  newQty: number,
  stationOf: (ci: CartItem) => StockStation,
  trackedNow: (docId: string) => boolean,
): StockPromptLine[] {
  if (newQty >= ci.quantity) return [];
  return promptLine(order.id, ci, splitStock(ci, newQty).returnQty, servedQtyOf(order, ci) > newQty, stationOf, trackedNow);
}

// ยกเลิกทั้งออเดอร์: ทุกบรรทัดที่ยังมีผลและยังตัดค้าง
export function cancelPromptLines(
  order: ServeState & { id: string; items: CartItem[] },
  stationOf: (ci: CartItem) => StockStation,
  trackedNow: (docId: string) => boolean,
): StockPromptLine[] {
  return order.items
    .filter((ci) => !ci.voided)
    .flatMap((ci) => promptLine(order.id, ci, stockOutUnits(ci), servedQtyOf(order, ci) > 0, stationOf, trackedNow));
}
