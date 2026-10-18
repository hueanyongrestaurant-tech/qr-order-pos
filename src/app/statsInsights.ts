// ─── สถิติเพิ่มเติมในหน้าสถิติ (logic ล้วน — คิดจากออเดอร์ที่จ่ายแล้วที่หน้าสถิติโหลดมาอยู่แล้ว ไม่อ่านเพิ่ม) ───
// "บิล" = ออเดอร์ที่ปิดพร้อมกัน (paymentBatchId เดียวกัน) — โต๊ะ 1 รอบนั่ง = 1 บิล ไม่ว่าจะสั่งกี่รอบ
// กลับบ้าน/บิลเก่าที่ไม่มี paymentBatchId = 1 ออเดอร์ 1 บิล

import type { Order } from "./types";
import { orderTotal } from "./utils";
import { ADDON_CATEGORY_ID } from "./constants";

export interface Bill {
  key: string;
  tableNumber: string;
  isTakeaway: boolean;
  backfilled: boolean;
  firstOrderAt: Date; // ออเดอร์แรกของบิล (เวลาเริ่มนั่ง)
  paidAt?: Date;      // ปิดบิล — บิลก่อนมี field นี้ไม่มีค่า
  revenue: number;
}

export function groupBills(orders: Order[]): Bill[] {
  const map = new Map<string, Bill>();
  orders.forEach((o) => {
    const key = o.paymentBatchId || o.id;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        key,
        tableNumber: o.tableNumber,
        isTakeaway: !!o.isTakeaway,
        backfilled: !!o.backfilled,
        firstOrderAt: o.timestamp,
        paidAt: o.paidAt,
        revenue: orderTotal(o),
      });
      return;
    }
    if (o.timestamp < prev.firstOrderAt) prev.firstOrderAt = o.timestamp;
    if (o.paidAt && (!prev.paidAt || o.paidAt > prev.paidAt)) prev.paidAt = o.paidAt;
    prev.revenue += orderTotal(o);
  });
  return [...map.values()];
}

// บิลค้างนานผิดปกติ (ลืมปิดบิลข้ามคืน) ไม่นับ — ไม่งั้นค่าเฉลี่ยเพี้ยนทั้งช่วง
export const SEATING_MAX_MINUTES = 6 * 60;

export interface SeatingSummary {
  avgMinutes: number | null; // null = ไม่มีบิลที่คิดได้
  count: number;
  missingPaidAt: number;     // บิลโต๊ะที่ไม่มีเวลาปิด (ก่อนเริ่มเก็บ)
  trackedSince: Date | null; // paidAt เก่าสุดในช่วงนี้ — ใช้บอก "เริ่มเก็บข้อมูลวันที่ …"
}

// เวลานั่ง = ออเดอร์แรก → ปิดบิล เฉพาะโต๊ะ (ไม่นับกลับบ้าน/บิลย้อนหลัง)
export function seatingSummary(bills: Bill[]): SeatingSummary {
  const dineIn = bills.filter((b) => !b.isTakeaway && !b.backfilled);
  const minutes: number[] = [];
  let trackedSince: Date | null = null;
  let missingPaidAt = 0;
  dineIn.forEach((b) => {
    if (!b.paidAt) { missingPaidAt++; return; }
    if (!trackedSince || b.paidAt < trackedSince) trackedSince = b.paidAt;
    const m = (b.paidAt.getTime() - b.firstOrderAt.getTime()) / 60000;
    if (m > 0 && m <= SEATING_MAX_MINUTES) minutes.push(m);
  });
  return {
    avgMinutes: minutes.length > 0 ? minutes.reduce((s, m) => s + m, 0) / minutes.length : null,
    count: minutes.length,
    missingPaidAt,
    trackedSince,
  };
}

export interface TableStat { table: string; bills: number; revenue: number }

// โต๊ะที่ใช้บ่อย / ทำเงินมากสุด (ไม่นับกลับบ้าน) เรียงตาม by
export function tableStats(bills: Bill[], by: "bills" | "revenue", top = 10): TableStat[] {
  const map = new Map<string, TableStat>();
  bills.filter((b) => !b.isTakeaway).forEach((b) => {
    const s = map.get(b.tableNumber) ?? { table: b.tableNumber, bills: 0, revenue: 0 };
    s.bills++;
    s.revenue += b.revenue;
    map.set(b.tableNumber, s);
  });
  return [...map.values()]
    .sort((a, b) => b[by] - a[by] || a.table.localeCompare(b.table, undefined, { numeric: true }))
    .slice(0, top);
}

// ช่วงเวลาคนเยอะ: จำนวนบิลตามชั่วโมงที่เริ่มสั่ง — เติมชั่วโมงว่างระหว่างแรกสุดถึงท้ายสุดให้ครบ (แกนไม่กระโดด)
export function billsByHour(bills: Bill[]): { hour: number; bills: number }[] {
  if (bills.length === 0) return [];
  const counts = new Array<number>(24).fill(0);
  bills.forEach((b) => { counts[b.firstOrderAt.getHours()]++; });
  const used = counts.map((c, h) => (c > 0 ? h : -1)).filter((h) => h >= 0);
  const out: { hour: number; bills: number }[] = [];
  for (let h = used[0]; h <= used[used.length - 1]; h++) out.push({ hour: h, bills: counts[h] });
  return out;
}

// วันในสัปดาห์: บิลเฉลี่ยต่อวัน (หารด้วยจำนวนวันนั้นๆ ในช่วงที่เลือก — ช่วงที่มีจันทร์ 2 ครั้งไม่ได้เปรียบ)
// weekday 0 = อาทิตย์ ตาม Date.getDay() | เรียงจันทร์ → อาทิตย์
export function billsByWeekday(bills: Bill[], rangeStart: Date, rangeEnd: Date): { weekday: number; avg: number; total: number }[] {
  const days = new Array<number>(7).fill(0);
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const last = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  while (cursor <= last) { days[cursor.getDay()]++; cursor.setDate(cursor.getDate() + 1); }
  const totals = new Array<number>(7).fill(0);
  bills.forEach((b) => { totals[b.firstOrderAt.getDay()]++; });
  return [1, 2, 3, 4, 5, 6, 0].map((w) => ({
    weekday: w,
    total: totals[w],
    avg: days[w] > 0 ? Math.round((totals[w] / days[w]) * 10) / 10 : 0,
  }));
}

// เมนูขายดี (รวมทุกตัวเลือกของเมนูเดียวกัน) ไม่นับรายการที่ยกเลิก / Add-on ที่พนักงานพิมพ์เพิ่มเอง (ค่าถุง ฯลฯ)
export function topItems(orders: Order[], top = 10): { id: string; nameTh: string; nameEn: string; qty: number }[] {
  const map = new Map<string, { id: string; nameTh: string; nameEn: string; qty: number }>();
  orders.forEach((o) => (o.items || []).forEach((ci) => {
    if (ci.voided || ci.item.categoryId === ADDON_CATEGORY_ID) return;
    const s = map.get(ci.item.id) ?? { id: ci.item.id, nameTh: ci.item.name.th, nameEn: ci.item.name.en, qty: 0 };
    s.qty += ci.quantity;
    map.set(ci.item.id, s);
  }));
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, top);
}

export function formatMinutes(min: number, lang: "th" | "en"): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (lang === "en") return h > 0 ? `${h} h ${r} min` : `${r} min`;
  return h > 0 ? `${h} ชม. ${r} นาที` : `${r} นาที`;
}
