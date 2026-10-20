// ─── ของเตรียม = สต็อกร่วมหลายเมนู (logic ล้วน ไม่แตะ Firestore — ทดสอบได้) ─────────────────────
// ของที่ทำไว้เป็นหม้อ/ชุดแล้วใช้หลายเมนู — สั่งเมนูที่ผูกไว้ 1 จาน หักของเตรียม 1
// เก็บใน collection stock เดียวกับสต็อกรายเมนู: stock/prep_xxx = { kind: "prep", name, remaining?, alertAt? }
//   ไม่มี remaining = ไม่จำกัด (ไม่ตัด) | rules ของ stock เดิมใช้ได้เลย ไม่ต้องแก้ firestore.rules
// เมนูเก็บว่าใช้ของเตรียมไหนใน menuItems.prepIds (ไหลไปกับ menu snapshot — ลูกค้าเห็นแค่ id ไม่เห็นจำนวน)
// กติกาเหมือนสต็อกรายเมนู: หักเฉพาะตอนกดสั่ง ไม่คืนเมื่อยกเลิก ใช้สวิตช์ระบบสต็อกตัวเดียวกัน
// เมนูมีทั้งสต็อกของตัวเองและของเตรียมได้ — หมดเมื่ออันใดอันหนึ่งเหลือ 0

import type { MenuItem } from "./types";
import type { StockEntry } from "./stock";

export const PREP_ID_PREFIX = "prep_";
export const isPrepId = (id: string) => id.startsWith(PREP_ID_PREFIX);

export interface PrepEntry {
  name: string;
  remaining?: number; // ไม่มี = ไม่จำกัด
  alertAt?: number;
}

// เหลือ 0 หรือติดลบ = เมนูที่ผูกทุกเมนูขึ้น "หมด" (ไม่จำกัด/ไม่มี doc แล้ว = ไม่หมด)
export function prepIsOut(prep: PrepEntry | undefined): boolean {
  return prep?.remaining !== undefined && prep.remaining <= 0;
}

// stock doc ที่ต้องตัดเมื่อลูกค้าสั่งเมนูนี้ — ดูจากฟิลด์ในเมนูอย่างเดียว (ลูกค้าไม่อ่าน stock ล่วงหน้า)
// doc ที่ไม่มีอยู่/ไม่จำกัด transaction อ่านแล้วข้ามไปเอง
export function guestStockDocIds(item: MenuItem | undefined): string[] {
  if (!item) return [];
  return [...(item.stockTracked ? [item.id] : []), ...(item.prepTracked ? item.prepIds ?? [] : [])];
}

// stock doc ที่ต้องตัดเมื่อพนักงานสั่งแทน — พนักงานมีข้อมูล stock ทั้งหมดในเครื่อง ตัดเฉพาะที่ตั้งจำนวนไว้จริง
export function staffStockDocIds(
  item: MenuItem | undefined,
  itemId: string,
  enabled: boolean,
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
): string[] {
  if (!enabled) return [];
  return [
    ...(stockMap.has(itemId) ? [itemId] : []),
    ...(item?.prepIds ?? []).filter((p) => prepMap.get(p)?.remaining !== undefined),
  ];
}

// เมนูที่ใช้ของเตรียมนี้
export function menusUsingPrep<M extends MenuItem>(menus: M[], prepId: string): M[] {
  return menus.filter((m) => m.prepIds?.includes(prepId));
}

// ผูกเมนูใหม่ / ถอด / ระบบสต็อกเปลี่ยน → prepTracked ของเมนู (ไม่มีของเตรียมผูกเลย = ไม่ใส่ฟิลด์)
export function prepTrackedFor(enabled: boolean, prepIds: string[] | undefined): boolean {
  return enabled && (prepIds?.length ?? 0) > 0;
}

// เมนูที่ต้องกด "หมด" / เปิดขายคืน ตามของเตรียมตอนนี้ (เครื่องพนักงานทำแทนลูกค้าที่เขียน menuItems ไม่ได้)
// • close: ผูกของเตรียมที่หมดอยู่ และเมนูยังขายอยู่ → หมด + ติดธง soldOutByPrep
// • reopen: มีธง soldOutByPrep และของเตรียมที่ผูกไม่หมดแล้วสักตัว (เติมแล้ว/ไม่จำกัด/ลบ/ถอดออก)
//   และสต็อกของเมนูเองไม่ได้เป็น 0 → เปิดขาย — เมนูที่พนักงานกด "หมด" เองไม่มีธง จึงหมดต่อไป
// เมนูที่ซ่อนอยู่ไม่แตะ
export function prepSoldOutChanges(
  menus: MenuItem[],
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
): { close: string[]; reopen: string[] } {
  const close: string[] = [];
  const reopen: string[] = [];
  menus.forEach((m) => {
    if (m.active === false) return;
    const prepOut = (m.prepIds ?? []).some((p) => prepIsOut(prepMap.get(p)));
    if (prepOut) {
      if (!m.soldOut) close.push(m.id);
      return;
    }
    if (!m.soldOut || !m.soldOutByPrep) return;
    const own = stockMap.get(m.id);
    if (own && own.remaining <= 0) return;
    reopen.push(m.id);
  });
  return { close, reopen };
}
