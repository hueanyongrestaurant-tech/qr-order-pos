// ─── สถิติเพิ่มเติมในหน้าสถิติ (logic ล้วน — คิดจากออเดอร์ที่จ่ายแล้วที่หน้าสถิติโหลดมาอยู่แล้ว ไม่อ่านเพิ่ม) ───
// "บิล" = ออเดอร์ที่ปิดพร้อมกัน (paymentBatchId เดียวกัน) — โต๊ะ 1 รอบนั่ง = 1 บิล ไม่ว่าจะสั่งกี่รอบ
// กลับบ้าน/บิลเก่าที่ไม่มี paymentBatchId = 1 ออเดอร์ 1 บิล

import type { CartItem, Category, CustomChoice, CustomGroup, Language, MenuItem, Order } from "./types";
import { cartItemSelections, normalizeMenuItem } from "./menuOptions";
import { cartItemTotal, orderTotal } from "./utils";
import { ADDON_CATEGORY_ID, COUNTER_CATEGORY_PREFIXES } from "./constants";

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

// ─── ชื่อเมนู/ตัวเลือกในสถิติ: ใช้ "ปัจจุบัน" ตาม id เสมอ ───
// ออเดอร์เก็บสำเนาเมนูตอนสั่ง (ชื่อ/ตัวเลือกตอนนั้น) — เมนูที่เปลี่ยนชื่อแล้วจะนับรวมกันตาม id และโชว์ชื่อปัจจุบัน
// เมนู/ตัวเลือกที่ถูกลบไปแล้ว ใช้ชื่อจากออเดอร์ล่าสุดที่มี
export type MenuLookup = Map<string, MenuItem>;
export const menuLookup = (menus: MenuItem[] | undefined): MenuLookup => new Map((menus ?? []).map((m) => [m.id, m]));

// รายการในออเดอร์ทั้งหมดที่นับในสถิติ (ไม่นับที่ยกเลิก) เรียงจากเก่าไปใหม่ — ตัวหลังทับตัวแรกเวลาเลือกชื่อ fallback
function liveLines(orders: Order[]): CartItem[] {
  return [...orders]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .flatMap((o) => (o.items || []).filter((ci) => !ci.voided));
}

// กลุ่ม/ตัวเลือก: ของเมนูปัจจุบันก่อน ไม่มีค่อยใช้จากสำเนาในออเดอร์ (แปลงแบบเดิมเป็นกลุ่มด้วย normalizeMenuItem)
function findGroup(current: MenuItem | undefined, ci: CartItem, groupId: string): CustomGroup | undefined {
  return (current ? normalizeMenuItem(current).customGroups ?? [] : []).find((g) => g.id === groupId)
    ?? (normalizeMenuItem(ci.item).customGroups ?? []).find((g) => g.id === groupId);
}
function findChoice(current: MenuItem | undefined, ci: CartItem, groupId: string, choiceId: string): CustomChoice | undefined {
  const fromCurrent = current && (normalizeMenuItem(current).customGroups ?? []).find((g) => g.id === groupId)?.choices.find((c) => c.id === choiceId);
  return fromCurrent ?? (normalizeMenuItem(ci.item).customGroups ?? []).find((g) => g.id === groupId)?.choices.find((c) => c.id === choiceId);
}

// key ของตัวเลือกที่เลือก (id กลุ่ม:id ตัวเลือก เรียงแล้ว) — ไม่ขึ้นกับชื่อ จึงไม่แยกแถวเมื่อเปลี่ยนชื่อตัวเลือก
export function selectionKey(ci: CartItem): string {
  return Object.entries(cartItemSelections(ci))
    .flatMap(([g, ids]) => ids.map((c) => `${g}:${c}`))
    .sort()
    .join(",");
}

// ชื่อตัวเลือกที่เลือก ตามลำดับกลุ่มของเมนูปัจจุบัน (ชื่อปัจจุบัน)
export function selectionLabels(ci: CartItem, current: MenuItem | undefined, lang: Language): string[] {
  const selections = cartItemSelections(ci);
  const order = new Map((current ? normalizeMenuItem(current).customGroups ?? [] : []).map((g, i) => [g.id, i]));
  return Object.keys(selections)
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
    .flatMap((g) => selections[g].map((c) => {
      const choice = findChoice(current, ci, g, c);
      return choice ? ((lang === "en" ? choice.labelEn || choice.labelTh : choice.labelTh || choice.labelEn) || c) : c;
    }));
}

// เมนูขายดี (รวมทุกตัวเลือกของเมนูเดียวกัน ตาม id) ไม่นับรายการที่ยกเลิก / Add-on ที่พนักงานพิมพ์เพิ่มเอง (ค่าถุง ฯลฯ)
// ชื่อ = ชื่อเมนูปัจจุบัน (เมนูถูกลบแล้ว = ชื่อในออเดอร์ล่าสุด) | หมวดก็ใช้ของปัจจุบัน (ย้ายหมวดแล้วนับตามหมวดใหม่)
export interface TopItem { id: string; nameTh: string; nameEn: string; qty: number; revenue: number }
// skipCategoryIds = หมวดที่ไม่นับ (การ์ดเมนูขายดี ไม่นับเครื่องดื่ม/ของฝาก — ดู counterCategoryIds)
export function topItems(orders: Order[], top = 10, skipCategoryIds?: Set<string>, menus?: MenuLookup): TopItem[] {
  const map = new Map<string, TopItem>();
  liveLines(orders).forEach((ci) => {
    const current = menus?.get(ci.item.id);
    const categoryId = current?.categoryId ?? ci.item.categoryId;
    if (categoryId === ADDON_CATEGORY_ID || skipCategoryIds?.has(categoryId)) return;
    const name = current?.name ?? ci.item.name;
    const s = map.get(ci.item.id) ?? { id: ci.item.id, nameTh: "", nameEn: "", qty: 0, revenue: 0 };
    s.nameTh = name.th;
    s.nameEn = name.en;
    s.qty += ci.quantity;
    s.revenue += cartItemTotal(ci);
    map.set(ci.item.id, s);
  });
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, top);
}

// ตัวเลือกยอดนิยมของเมนูหนึ่ง เช่น เนื้อ: ไก่ 45% · หมู 35% · เนื้อ 20%
// % = จำนวนจานที่เลือกตัวนั้น / จำนวนจานที่เลือกอะไรสักอย่างในกลุ่มนั้น
// แสดงเฉพาะกลุ่มที่ลูกค้าเลือกต่างกันจริง (≥ 2 ตัวเลือก): กลุ่มที่ครอบคลุมจานมากสุดก่อน (เลือกได้ 1 ก่อนเลือกหลายอย่าง)
// กลุ่มที่ 2 ขึ้นเฉพาะเลือกได้ 1 และครอบคลุม ≥ ครึ่งหนึ่งของจาน — ตัวเลือกเกิน 3 ตัวรวมเป็น "อื่นๆ"
export interface ChoiceShare {
  groupId: string;
  nameTh: string;
  nameEn: string;
  choices: { id: string; labelTh: string; labelEn: string; pct: number }[];
}

export function popularChoices(orders: Order[], itemId: string, menus?: MenuLookup, maxChoices = 3): ChoiceShare[] {
  const current = menus?.get(itemId);
  const lines = liveLines(orders).filter((ci) => ci.item.id === itemId);
  const plates = lines.reduce((s, ci) => s + ci.quantity, 0);
  const groups = new Map<string, { total: number; single: boolean; nameTh: string; nameEn: string; choices: Map<string, { qty: number; labelTh: string; labelEn: string }> }>();
  lines.forEach((ci) => {
    Object.entries(cartItemSelections(ci)).forEach(([gid, ids]) => {
      if (ids.length === 0) return;
      const meta = findGroup(current, ci, gid);
      const g = groups.get(gid) ?? { total: 0, single: (meta?.type ?? "single") === "single", nameTh: "", nameEn: "", choices: new Map() };
      g.nameTh = meta?.nameTh || g.nameTh || gid;
      g.nameEn = meta?.nameEn || g.nameEn || g.nameTh;
      g.total += ci.quantity;
      ids.forEach((cid) => {
        const choice = findChoice(current, ci, gid, cid);
        const c = g.choices.get(cid) ?? { qty: 0, labelTh: cid, labelEn: cid };
        c.qty += ci.quantity;
        if (choice) { c.labelTh = choice.labelTh || choice.labelEn || cid; c.labelEn = choice.labelEn || choice.labelTh || cid; }
        g.choices.set(cid, c);
      });
      groups.set(gid, g);
    });
  });
  const ranked = [...groups].filter(([, g]) => g.choices.size >= 2)
    .sort(([, a], [, b]) => b.total - a.total || Number(b.single) - Number(a.single));
  const picked = ranked.filter(([, g], i) => i === 0 || (i === 1 && g.single && g.total * 2 >= plates)).slice(0, 2);
  return picked.map(([groupId, g]) => {
    const sorted = [...g.choices].sort(([, a], [, b]) => b.qty - a.qty);
    const pct = (qty: number) => Math.round((qty / g.total) * 100);
    const shown = sorted.slice(0, maxChoices).map(([id, c]) => ({ id, labelTh: c.labelTh, labelEn: c.labelEn, pct: pct(c.qty) }));
    const restQty = sorted.slice(maxChoices).reduce((s, [, c]) => s + c.qty, 0);
    if (restQty > 0 && g.single) shown.push({ id: "__other", labelTh: "อื่นๆ", labelEn: "Other", pct: pct(restQty) });
    return { groupId, nameTh: g.nameTh, nameEn: g.nameEn, choices: shown };
  });
}

export function formatMinutes(min: number, lang: "th" | "en"): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (lang === "en") return h > 0 ? `${h} h ${r} min` : `${r} min`;
  return h > 0 ? `${h} ชม. ${r} นาที` : `${r} นาที`;
}

// หมวดเครื่องดื่ม/ของฝาก (ชื่อหมวดขึ้นต้นด้วย COUNTER_CATEGORY_PREFIXES — ชุดเดียวกับที่ส่งพิมพ์เคาน์เตอร์)
export function counterCategoryIds(categories: Category[]): Set<string> {
  return new Set(categories.filter((c) => COUNTER_CATEGORY_PREFIXES.some((p) => (c.nameTh || "").startsWith(p))).map((c) => c.id));
}
