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

// ช่วงเวลาคนเยอะ: heatmap วันในสัปดาห์ × ชั่วโมงที่เริ่มสั่ง (นับจำนวนบิลรวมทั้งช่วงที่เลือก)
// แถว = วันที่มีอยู่จริงในช่วง (เรียงจันทร์ → อาทิตย์) | คอลัมน์ = ชั่วโมงแรกสุดถึงท้ายสุดที่มีบิล (เติมชั่วโมงว่างให้ครบ)
export interface BillsHeatmap {
  weekdays: number[]; // 0 = อาทิตย์ ตาม Date.getDay()
  hours: number[];
  counts: Record<string, number>; // key `${weekday}-${hour}`
  max: number;
  peak: { weekday: number; hour: number; count: number } | null;
}

export function billsHeatmap(bills: Bill[], rangeStart: Date, rangeEnd: Date): BillsHeatmap {
  const present = new Set<number>();
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const last = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  while (cursor <= last && present.size < 7) { present.add(cursor.getDay()); cursor.setDate(cursor.getDate() + 1); }
  const weekdays = [1, 2, 3, 4, 5, 6, 0].filter((w) => present.has(w));
  const counts: Record<string, number> = {};
  let max = 0;
  let peak: BillsHeatmap["peak"] = null;
  let minHour = 24;
  let maxHour = -1;
  bills.forEach((b) => {
    const w = b.firstOrderAt.getDay();
    const h = b.firstOrderAt.getHours();
    const key = `${w}-${h}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (counts[key] > max) { max = counts[key]; peak = { weekday: w, hour: h, count: counts[key] }; }
    minHour = Math.min(minHour, h);
    maxHour = Math.max(maxHour, h);
  });
  const hours: number[] = [];
  for (let h = minHour; h <= maxHour; h++) hours.push(h);
  return { weekdays, hours, counts, max, peak };
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
