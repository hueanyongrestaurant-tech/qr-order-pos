// ─── สถิติเพิ่มเติมในหน้าสถิติ (logic ล้วน — คิดจากออเดอร์ที่จ่ายแล้วที่หน้าสถิติโหลดมาอยู่แล้ว ไม่อ่านเพิ่ม) ───
// "บิล" = ออเดอร์ที่ปิดพร้อมกัน (paymentBatchId เดียวกัน) — โต๊ะ 1 รอบนั่ง = 1 บิล ไม่ว่าจะสั่งกี่รอบ
// กลับบ้าน/บิลเก่าที่ไม่มี paymentBatchId = 1 ออเดอร์ 1 บิล

import type { Order } from "./types";
import { cartItemTotal, orderTotal } from "./utils";
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
export function tableStats(bills: Bill[], by: "bills" | "revenue", top = Infinity): TableStat[] {
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

// จำนวนวันในช่วงที่เลือก (นับทั้งวันแรกและวันสุดท้าย) — ใช้หาค่าเฉลี่ยต่อวัน
export function rangeDayCount(rangeStart: Date, rangeEnd: Date): number {
  const a = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
  const b = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate()).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export interface HourStat { hour: number; total: number; avg: number }

// ช่วงเวลาคนเยอะ: จำนวนบิลตามชั่วโมงที่เริ่มสั่ง + เฉลี่ยต่อวัน (ทศนิยม 1 ตำแหน่ง)
// ชั่วโมงแรกสุดถึงท้ายสุดที่มีบิล เติมชั่วโมงว่างให้ครบ (เส้นเวลาไม่กระโดด)
export function billsPerHour(bills: Bill[], days: number): HourStat[] {
  if (bills.length === 0) return [];
  const counts = new Array<number>(24).fill(0);
  bills.forEach((b) => { counts[b.firstOrderAt.getHours()]++; });
  const used = counts.map((c, h) => (c > 0 ? h : -1)).filter((h) => h >= 0);
  const out: HourStat[] = [];
  for (let h = used[0]; h <= used[used.length - 1]; h++) {
    out.push({ hour: h, total: counts[h], avg: Math.round((counts[h] / Math.max(1, days)) * 10) / 10 });
  }
  return out;
}

// ชั่วโมงที่คนเยอะสุด n อันดับ (เท่ากันให้ชั่วโมงที่เร็วกว่ามาก่อน) ไม่นับชั่วโมงที่ไม่มีบิล
export function topHours(perHour: HourStat[], n = 3): HourStat[] {
  return perHour.filter((h) => h.total > 0).sort((a, b) => b.total - a.total || a.hour - b.hour).slice(0, n);
}

// "1-3" → ชั้น 1 โต๊ะ 3 (ตามผังใน TABLE_FLOORS) — รูปแบบอื่นคืน null
export function parseTableNumber(tn: string): { floor: number; table: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(tn);
  return m ? { floor: Number(m[1]), table: Number(m[2]) } : null;
}

// เมนูขายดี (รวมทุกตัวเลือกของเมนูเดียวกัน) ไม่นับรายการที่ยกเลิก / Add-on ที่พนักงานพิมพ์เพิ่มเอง (ค่าถุง ฯลฯ)
export interface TopItem { id: string; nameTh: string; nameEn: string; qty: number; revenue: number }
export function topItems(orders: Order[], top = 10): TopItem[] {
  const map = new Map<string, TopItem>();
  orders.forEach((o) => (o.items || []).forEach((ci) => {
    if (ci.voided || ci.item.categoryId === ADDON_CATEGORY_ID) return;
    const s = map.get(ci.item.id) ?? { id: ci.item.id, nameTh: ci.item.name.th, nameEn: ci.item.name.en, qty: 0, revenue: 0 };
    s.qty += ci.quantity;
    s.revenue += cartItemTotal(ci);
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
