// ─── ยอดสรุปรายวัน dailyStats/{YYYY-MM-DD} — ให้แท็บยอดขาย (วัน/สัปดาห์/เดือน/ปี) ถูกตลอดไปไม่ว่าออเดอร์จะสะสมเท่าไหร่ ───
// 1 doc ต่อ 1 วันที่ "ปิดแล้ว" (เก่ากว่าเมื่อวาน — ดู lastPersistableDay) สร้างแบบ lazy: หน้าสถิติต้องใช้วันที่ไม่มีสรุป
// → อ่านออเดอร์ของวันนั้นครั้งเดียว คำนวณ แล้วเขียน doc (ดู dailyStatsFetch.ts) | วันนี้/เมื่อวานอ่านสดจาก orders เสมอ ไม่บันทึก
// ไฟล์นี้ = logic ล้วน + อ่าน/เขียน Firestore แบบส่ง db เข้ามา (ใช้ร่วมกับสคริปต์ backfill: scripts/daily-stats-backfill)
//
// ตัวเลขต้องตรงกับที่หน้าสถิติคิดจากออเดอร์ทุกตัว (tests/rules/dailyStats.test.mjs เทียบสองทาง):
// - ยอดรวม/เงินสด/โอน = orderTotal / orderPaymentBreakdown ของออเดอร์ "paid"
// - จำนวนโต๊ะ = จำนวน paymentBatchId || id ที่ไม่ซ้ำ (ไม่นับกลับบ้าน) — เก็บ id ทั้งชุด ไม่ใช่แค่จำนวน
//   เพราะบิลที่เปิดก่อนเที่ยงคืนแล้วสั่งรอบใหม่หลังเที่ยงคืนมี batch เดียวกันสองวัน ต้องนับครั้งเดียวเมื่อดูหลายวัน
// - เมนูที่ขายได้ = แถวตาม id เมนู + id ตัวเลือก (selectionKey) ชื่อ/ตัวเลือกใช้ของเมนูปัจจุบันตอนแสดง (ไม่ได้แช่ไว้)
//   เก็บชื่อ+ตัวเลือกของ "ออเดอร์ล่าสุด" ไว้เผื่อเมนู/ตัวเลือกถูกลบ และลำดับที่เจอครั้งแรก (ตัดสินลำดับแถวที่ขายเท่ากัน)

import {
  collection, doc, documentId, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where, type Firestore,
} from "firebase/firestore";
import type { CartItem, Language, MenuItem, Order } from "./types";
import { cartItemSelections, normalizeMenuItem } from "./menuOptions";
import { selectionKey, type MenuLookup } from "./statsInsights";
import { cartItemTotal, dayKeysInRange, formatDateInput, mapOrderDoc, orderPaymentBreakdown, orderTotal, PAID_ORDERS_QUERY_CAP } from "./utils";

export const DAILY_STATS = "dailyStats";
// เปลี่ยนวิธีคำนวณ/โครง doc เมื่อไหร่ ให้เพิ่มเลขนี้ — doc เวอร์ชันเก่าถูกคำนวณใหม่เองตอนเปิดหน้าสถิติ
export const DAILY_STATS_VERSION = 1;

export interface SummaryChoiceLabel { g: string; c: string; th: string; en: string }
export interface SummaryItem {
  k: string;                      // id เมนู | selectionKey
  id: string;                     // id เมนู
  qty: number;
  rev: number;
  th: string;                     // ชื่อเมนูในออเดอร์ล่าสุดของวัน (ใช้เมื่อเมนูถูกลบแล้ว)
  en: string;
  sel: { g: string; c: string[] }[]; // ตัวเลือกของออเดอร์ล่าสุด ตามลำดับเดิม
  fb: SummaryChoiceLabel[];       // ชื่อตัวเลือกตามเมนูในออเดอร์ล่าสุด (ใช้เมื่อเมนูปัจจุบันไม่มีตัวเลือกนั้นแล้ว)
  f: number;                      // ลำดับที่เจอครั้งแรกในวัน
}
export interface DaySummary {
  v: number;
  day: string;
  revenue: number;
  cash: number;
  transfer: number;
  orders: number;                 // จำนวนออเดอร์ที่จ่ายแล้ว
  groups: string[];               // paymentBatchId || id ของบิลนั่งร้าน (เรียงแล้ว)
  groupCount: number;
  items: SummaryItem[];
  open: number;                   // ออเดอร์ของวันนั้นที่ยังไม่ปิด — > 0 = ยังไม่บันทึก (ยังเปลี่ยนได้)
  builtAt?: number;               // ms ตอนสร้าง (เวลา server) — มาจาก Firestore
  stale?: boolean;                // มีคนแก้บิลของวันนั้นหลังสร้าง → คำนวณใหม่
}

const isOpenStatus = (s: unknown) => s === "in-progress" || s === "awaiting-payment";

// สรุป 1 วันจากออเดอร์ (ทุกสถานะได้ — นับเฉพาะ paid, นับ open แยก) ออเดอร์นอกวันนั้นไม่นับ
// ลำดับออเดอร์ต้องเป็นลำดับเดียวกับ query (createdAt เก่า→ใหม่) — เรียงซ้ำด้วยเวลาแบบ stable เหมือนหน้าสถิติ
export function buildDaySummary(day: string, orders: Order[]): DaySummary {
  const ofDay = orders.filter((o) => formatDateInput(o.timestamp) === day);
  const paid = ofDay.filter((o) => o.status === "paid");
  let revenue = 0, cash = 0, transfer = 0;
  paid.forEach((o) => {
    revenue += orderTotal(o);
    const b = orderPaymentBreakdown(o);
    cash += b.cash;
    transfer += b.transfer;
  });
  const groups = [...new Set(paid.filter((o) => !o.isTakeaway).map((o) => o.paymentBatchId || o.id))].sort();
  const items = new Map<string, SummaryItem>();
  let pos = 0;
  [...paid].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).forEach((o) => {
    o.items.forEach((ci) => {
      if (ci.voided) return; // รายการที่ถูกยกเลิก ไม่นับในสถิติ
      const k = `${ci.item.id}|${selectionKey(ci)}`;
      const prev = items.get(k);
      const latest = latestOf(ci);
      items.set(k, {
        k,
        id: ci.item.id,
        qty: (prev?.qty ?? 0) + ci.quantity,
        rev: (prev?.rev ?? 0) + cartItemTotal(ci),
        ...latest, // ชื่อ/ตัวเลือกทับด้วยออเดอร์ที่ใหม่กว่าเสมอ (เรียงเก่า→ใหม่แล้ว)
        f: prev?.f ?? pos,
      });
      pos++;
    });
  });
  return {
    v: DAILY_STATS_VERSION,
    day,
    revenue,
    cash,
    transfer,
    orders: paid.length,
    groups,
    groupCount: groups.length,
    items: [...items.values()],
    open: ofDay.filter((o) => isOpenStatus(o.status)).length,
  };
}

// ชื่อ + ตัวเลือก + ชื่อตัวเลือก (ตามเมนูในออเดอร์) ของบรรทัดนี้ — Firestore ไม่รับ undefined จึงเติม "" (แสดงผลเหมือนกัน)
function latestOf(ci: CartItem): Pick<SummaryItem, "th" | "en" | "sel" | "fb"> {
  const selections = cartItemSelections(ci);
  const groups = normalizeMenuItem(ci.item).customGroups ?? [];
  const fb: SummaryChoiceLabel[] = [];
  const sel = Object.entries(selections).map(([g, c]) => {
    c.forEach((cid) => {
      const choice = groups.find((x) => x.id === g)?.choices.find((x) => x.id === cid);
      if (choice) fb.push({ g, c: cid, th: choice.labelTh ?? "", en: choice.labelEn ?? "" });
    });
    return { g, c: [...c] };
  });
  return { th: ci.item.name?.th ?? "", en: ci.item.name?.en ?? "", sel, fb };
}

// ชื่อตัวเลือก — เหมือน selectionLabels ใน statsInsights.ts ทุกอย่าง (ลำดับกลุ่มตามเมนูปัจจุบัน, ชื่อปัจจุบันก่อน)
function summaryLabels(it: SummaryItem, current: MenuItem | undefined, lang: Language): string[] {
  const currentGroups = current ? normalizeMenuItem(current).customGroups ?? [] : [];
  const order = new Map(currentGroups.map((g, i) => [g.id, i]));
  return [...it.sel]
    .sort((a, b) => (order.get(a.g) ?? 999) - (order.get(b.g) ?? 999))
    .flatMap(({ g, c }) => c.map((cid) => {
      const cur = currentGroups.find((x) => x.id === g)?.choices.find((x) => x.id === cid);
      const choice = cur ? { th: cur.labelTh, en: cur.labelEn } : it.fb.find((x) => x.g === g && x.c === cid);
      return choice ? ((lang === "en" ? choice.en || choice.th : choice.th || choice.en) || cid) : cid;
    }));
}

export interface MenuRow { nameEn: string; nameTh: string; optionLabel: string; qty: number; revenue: number }
export interface SalesTotals {
  totalRevenue: number;
  cashRevenue: number;
  transferRevenue: number;
  orderCount: number;
  uniqueGroups: number;
  menuRows: MenuRow[];                   // ลำดับที่เจอครั้งแรก (ยังไม่เรียงตามจำนวน — เหมือน Object.values(menuCounts) เดิม)
  revenueByDay: Record<string, number>;
}

// รวมสรุปหลายวัน (เรียงวันเก่า→ใหม่) เป็นตัวเลขของหน้าสถิติ
export function mergeDaySummaries(days: DaySummary[], menus: MenuLookup, lang: Language): SalesTotals {
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const groups = new Set<string>();
  const rows = new Map<string, { qty: number; revenue: number; latest: SummaryItem }>();
  const revenueByDay: Record<string, number> = {};
  let totalRevenue = 0, cashRevenue = 0, transferRevenue = 0, orderCount = 0;
  sorted.forEach((d) => {
    totalRevenue += d.revenue;
    cashRevenue += d.cash;
    transferRevenue += d.transfer;
    orderCount += d.orders;
    d.groups.forEach((g) => groups.add(g));
    if (d.orders > 0) revenueByDay[d.day] = (revenueByDay[d.day] || 0) + d.revenue;
    [...d.items].sort((a, b) => a.f - b.f).forEach((it) => {
      const r = rows.get(it.k);
      if (r) { r.qty += it.qty; r.revenue += it.rev; r.latest = it; }
      else rows.set(it.k, { qty: it.qty, revenue: it.rev, latest: it });
    });
  });
  const menuRows = [...rows.values()].map(({ qty, revenue, latest }) => {
    const current = menus.get(latest.id);
    const name = current?.name ?? { th: latest.th, en: latest.en };
    return { qty, revenue, nameEn: name.en, nameTh: name.th, optionLabel: summaryLabels(latest, current, lang).join(", ") };
  });
  return { totalRevenue, cashRevenue, transferRevenue, orderCount, uniqueGroups: groups.size, menuRows, revenueByDay };
}

// ขนาดโดยประมาณของ doc (ไบต์ UTF-8 ของ JSON — มากกว่าที่ Firestore นับจริงเล็กน้อย) เพดาน Firestore = 1 MiB
export function summaryBytes(s: DaySummary): number {
  return new TextEncoder().encode(JSON.stringify(s)).length;
}

// ใช้ได้เลยไหม: เวอร์ชันตรง, ไม่ถูกตีว่าเก่า, วันนั้นไม่มีออเดอร์ค้าง
export function isUsableSummary(s: DaySummary | undefined): s is DaySummary {
  return !!s && s.v === DAILY_STATS_VERSION && !s.stale && s.open === 0 && Array.isArray(s.items) && Array.isArray(s.groups);
}

// ─── Firestore (ส่ง db เข้ามา — แอปใช้ db ของแอป, สคริปต์ใช้ db ที่ล็อกอินพนักงาน) ───

export function fromSummaryDoc(id: string, raw: any): DaySummary {
  return {
    ...raw,
    day: id,
    builtAt: raw?.builtAt?.toMillis ? raw.builtAt.toMillis() : undefined,
    stale: raw?.stale === true ? true : undefined,
  } as DaySummary;
}

// สรุปทุกวันในช่วง [startKey, endKey] ที่มีใน Firestore — query เดียว (reads = จำนวน doc, อย่างน้อย 1)
export async function readServerSummaries(store: Firestore, startKey: string, endKey: string): Promise<{ map: Map<string, DaySummary>; reads: number }> {
  const snap = await getDocs(query(
    collection(store, DAILY_STATS),
    where(documentId(), ">=", startKey),
    where(documentId(), "<=", endKey),
  ));
  const map = new Map<string, DaySummary>();
  snap.docs.forEach((d) => map.set(d.id, fromSummaryDoc(d.id, d.data())));
  return { map, reads: Math.max(1, snap.size) };
}

// ข้อมูลที่เขียนลง doc (ไม่มี stale = ล้างธงไปด้วย) — builtAt = เวลา server | ใช้ร่วมกับสคริปต์ backfill
export function summaryDocData(s: DaySummary): Record<string, unknown> {
  const { builtAt: _b, stale: _s, ...data } = s;
  return { ...data, builtAt: serverTimestamp() };
}

// เขียนทับทั้ง doc
export async function writeServerSummary(store: Firestore, s: DaySummary): Promise<void> {
  await setDoc(doc(store, DAILY_STATS, s.day), summaryDocData(s));
}

// ออเดอร์ทุกสถานะของวัน firstKey..lastKey (query เดียวกับหน้าสถิติ: createdAt อย่างเดียว ไม่ต้องมี composite index)
// แบ่งช่วงละไม่เกิน 31 วัน — ไม่ให้ชนเพดาน PAID_ORDERS_QUERY_CAP ตอนสร้างสรุปทีละหลายเดือน
export async function fetchOrdersForDays(store: Firestore, firstKey: string, lastKey: string): Promise<{ orders: Order[]; reads: number }> {
  const days = dayKeysInRange(firstKey, lastKey);
  const orders: Order[] = [];
  let reads = 0;
  for (let i = 0; i < days.length; i += 31) {
    const chunk = days.slice(i, i + 31);
    const end = new Date(`${chunk[chunk.length - 1]}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const snap = await getDocs(query(
      collection(store, "orders"),
      where("createdAt", ">=", new Date(`${chunk[0]}T00:00:00`)),
      where("createdAt", "<", end),
      orderBy("createdAt", "asc"),
      limit(PAID_ORDERS_QUERY_CAP),
    ));
    if (snap.size >= PAID_ORDERS_QUERY_CAP) throw new Error(`orders query hit the cap for ${chunk[0]}..${chunk[chunk.length - 1]}`);
    reads += Math.max(1, snap.size);
    snap.docs.forEach((d) => orders.push(mapOrderDoc(d.id, d.data())));
  }
  return { orders, reads };
}

// เครื่องที่ตั้งเวลาเป็นไทย (UTC+7 ไม่มีเวลาออมแสง) เท่านั้นที่เขียนสรุปลง Firestore — วันของสรุป = วันตามเวลาไทย
export function isBangkokTime(at = new Date()): boolean {
  return at.getTimezoneOffset() === -420;
}
