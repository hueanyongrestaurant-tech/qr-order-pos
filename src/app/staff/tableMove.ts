// ─── ย้ายโต๊ะ: ตรรกะล้วน (ไม่แตะ Firestore/เครื่องพิมพ์) ───────────────────────
//
// การย้ายเขียนใน handleMoveTable (App.tsx) เป็น transaction เดียว: ทุกออเดอร์ค้างของโต๊ะเดิม
// (in-progress + awaiting-payment) ได้ tableNumber ใหม่ + moveId/movedFrom/movedAt ชุดเดียวกัน
//
// การพิมพ์ใบย้าย: ไม่มีเครื่องไหนพิมพ์ "จากปุ่ม" — ทุกเครื่องที่ตั้งเครื่องพิมพ์ไว้ (รวมเครื่องที่กดย้าย)
// เห็นการย้ายผ่าน orders listener เดิม แล้วพิมพ์ส่วนของจุดตัวเองตาม print role
// - takeNewMoves: moveId ที่ไม่เคยเห็นใน subscription นี้ = เพิ่งย้าย (snapshot แรกถูกนับว่า "เห็นแล้ว"
//   ทั้งหมด → รีโหลดไม่พิมพ์ซ้ำ) การแก้ออเดอร์ทีหลัง (เสิร์ฟ/void) ไม่เปลี่ยน moveId → ไม่พิมพ์ซ้ำ
// - transaction ไม่มี latency compensation และ snapshot ของ query สอดคล้องกันเสมอ ทุกออเดอร์ของการย้าย
//   รอบหนึ่งจึงโผล่มาพร้อมกันใน snapshot เดียว → รวมเป็นใบเดียวได้

import type { CartItem, Language, Order } from "../types";
import { cartItemKey, unservedItems } from "../utils";

export interface MoveGroup {
  moveId: string;
  from: string;
  to: string;
  movedAt: Date;
  orders: Order[];
}

const isActiveDineIn = (o: Order) => !o.isTakeaway && (o.status === "in-progress" || o.status === "awaiting-payment");

// ออเดอร์ค้างของโต๊ะนี้ (ที่จะถูกย้าย) — ใช้นับ N ในข้อความยืนยัน
export function activeDineInOrders(orders: Order[], table: string): Order[] {
  return orders.filter((o) => isActiveDineIn(o) && o.tableNumber === table);
}

// โต๊ะที่มีลูกค้านั่ง (มีออเดอร์ค้าง) — หน้าเลือกโต๊ะปลายทางทำเป็นสีเทากดไม่ได้ (transaction ยังเช็คซ้ำ)
export function occupiedTables(orders: Order[]): Set<string> {
  return new Set(orders.filter(isActiveDineIn).map((o) => o.tableNumber));
}

// คืนกลุ่มการย้ายที่ยังไม่เคยเห็น แล้วจด moveId ลง seen (mutate) — เรียกทุก snapshot รวมถึง snapshot แรก
// (snapshot แรกแค่จด ไม่พิมพ์: ผู้เรียกทิ้งผลลัพธ์เอง)
export function takeNewMoves(seen: Set<string>, orders: Order[]): MoveGroup[] {
  const groups = new Map<string, MoveGroup>();
  orders.forEach((o) => {
    if (!o.moveId || seen.has(o.moveId)) return;
    const g = groups.get(o.moveId);
    if (g) {
      g.orders.push(o);
    } else {
      groups.set(o.moveId, {
        moveId: o.moveId,
        from: o.movedFrom ?? "?",
        to: o.tableNumber,
        movedAt: o.movedAt ?? new Date(),
        orders: [o],
      });
    }
  });
  groups.forEach((_, id) => seen.add(id));
  return [...groups.values()];
}

// ออเดอร์จำลองสำหรับพิมพ์ใบย้าย: เฉพาะรายการที่ยังไม่เสิร์ฟ (ไม่นับที่ void) ของทุกรอบรวมกัน
// เมนูที่ตัวเลือก/หมายเหตุเหมือนกันทุกอย่าง (cartItemKey เดียวกัน) รวมเป็นบรรทัดเดียวบวกจำนวน
// เวลาบนหัวใบ = เวลาที่ย้าย, เลขโต๊ะ = โต๊ะใหม่ — null = ไม่มีอะไรค้าง ไม่ต้องพิมพ์
export function buildMoveTicketOrder(group: MoveGroup): Order | null {
  const merged = new Map<string, CartItem>();
  [...group.orders]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .forEach((o) => {
      unservedItems(o).forEach((ci) => {
        const key = cartItemKey(ci);
        const existing = merged.get(key);
        merged.set(key, existing ? { ...existing, quantity: existing.quantity + ci.quantity } : { ...ci });
      });
    });
  if (merged.size === 0) return null;
  return {
    id: `move:${group.moveId}`,
    tableNumber: group.to,
    timestamp: group.movedAt,
    items: [...merged.values()],
    status: "in-progress",
  };
}

// บรรทัดหัวใบ — เครื่องพิมพ์ใช้ codepage TIS-620 ไม่มีลูกศร "→" (จะออกเป็น "?") บนกระดาษจึงใช้ "->"
export function moveBanner(from: string, to: string, lang: Language): string {
  return lang === "en" ? `MOVED ${from} -> ${to}` : `ย้ายจาก ${from} -> ${to}`;
}
