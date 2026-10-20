// ─── สต็อกต่อเมนู (logic ล้วน ไม่แตะ Firestore — ทดสอบได้) ─────────────────────────────
// stock/{itemId} = { remaining, alertAt? } — ไม่มี doc = ขายไม่จำกัด
// menuItems.stockTracked = true บอกเครื่องลูกค้า/พนักงานว่าเมนูนี้ต้องส่งออเดอร์แบบ transaction ตัดสต็อก
// (ไหลไปกับ menu snapshot/cache ตามปกติ — ลูกค้าไม่ต้องอ่านอะไรเพิ่ม และไม่เห็นจำนวน)
// หักสต็อกเฉพาะตอนกดสั่ง (ลูกค้า/พนักงานสั่งแทน) — action อื่นไม่แตะสต็อก พนักงานแก้จำนวนเองถ้าต้องคืน

import type { CartItem } from "./types";

export interface StockEntry {
  remaining: number;
  alertAt?: number;
}

// ตรงกับ rules: ลูกค้าตัดได้ไม่เกิน 50 ชิ้นต่อเมนูต่อออเดอร์
export const GUEST_MAX_TAKE_PER_ITEM = 50;

// จำนวนที่ต้องตัดต่อ stock doc (รวมทุกบรรทัดที่ใช้ doc เดียวกัน ไม่นับบรรทัดที่ยกเลิก)
// docIdsOf = stock doc ที่รายการนี้ต้องตัด: สต็อกของเมนูเอง (id เมนู) และ/หรือของเตรียมที่ผูกทั้งเมนูหรือกับตัวเลือกที่เลือก
// (ดู prep.ts) — [] = ไม่ตัด | เช่น 2 เมนูที่ผูกของเตรียมเดียวกัน สั่งอย่างละ 1 = ของเตรียมนั้นต้องตัด 2
export function stockNeeds(items: CartItem[], docIdsOf: (ci: CartItem) => string[]): Map<string, number> {
  const needs = new Map<string, number>();
  items.forEach((ci) => {
    if (ci.voided || ci.quantity <= 0) return;
    new Set(docIdsOf(ci)).forEach((id) => needs.set(id, (needs.get(id) ?? 0) + ci.quantity));
  });
  return needs;
}

export type StockTakePlan =
  | { ok: true; updates: Map<string, number>; soldOutIds: string[] }
  | { ok: false; shortIds: string[] };

// current: remaining ล่าสุดจาก server (undefined = ไม่มี doc แล้ว = ไม่จำกัด ข้ามไป)
// เหลือไม่พอ (หรือลูกค้าสั่งเกินเพดานต่อออเดอร์) → ไม่ตัดเลยสักเมนู คืนรายการที่ไม่พอ
export function planStockTake(
  needs: Map<string, number>,
  current: Map<string, number | undefined>,
  opts: { guest: boolean },
): StockTakePlan {
  const updates = new Map<string, number>();
  const shortIds: string[] = [];
  const soldOutIds: string[] = [];
  needs.forEach((need, id) => {
    const remaining = current.get(id);
    if (remaining === undefined) return;
    if (remaining < need || (opts.guest && need > GUEST_MAX_TAKE_PER_ITEM)) { shortIds.push(id); return; }
    const next = remaining - need;
    updates.set(id, next);
    if (next <= 0) soldOutIds.push(id);
  });
  if (shortIds.length > 0) return { ok: false, shortIds };
  return { ok: true, updates, soldOutIds };
}

export type StockLevel = "negative" | "out" | "low" | "ok";

export function stockLevel(entry: StockEntry): StockLevel {
  if (entry.remaining < 0) return "negative";
  if (entry.remaining === 0) return "out";
  if (entry.alertAt !== undefined && entry.remaining <= entry.alertAt) return "low";
  return "ok";
}

// ช่องกรอกจำนวน: "" = ไม่จำกัด (null) | จำนวนเต็ม ≥ 0 | อย่างอื่น = "invalid"
export function parseStockInput(raw: string): number | null | "invalid" {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return "invalid";
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : "invalid";
}

// เมนูนี้ต้องส่งแบบตัดสต็อกไหม — ระบบสต็อกเปิดอยู่ และมีจำนวนตั้งไว้
export function shouldTrackStock(enabled: boolean, hasStock: boolean): boolean {
  return enabled && hasStock;
}

// คืนเมนูใหม่ที่เปิดขายหลังเติมสต็อก: กรอกจำนวน > 0 ใหม่ = เปิดขาย | 0 = หมด | ว่าง = ไม่จำกัด เปิดขาย
export function soldOutAfterStockSet(value: number | null): boolean {
  return value !== null && value <= 0;
}
