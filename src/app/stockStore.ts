// ─── สต็อกต่อเมนู: ส่วนที่คุยกับ Firestore (logic ล้วนอยู่ใน stock.ts) ─────────────────────
// ตัดสต็อก = ทำใน transaction เดียวกับการสร้างออเดอร์ (อ่าน stock → เหลือไม่พอ = ไม่สร้างออเดอร์เลย)
// หักสต็อกตอนกดสั่ง — แต่ละบรรทัดจดไว้ว่าตัดอะไรไป (stockDocs/stockQty) ให้การยกเลิก/ลดจำนวนคืนได้ถูกตัว
// (คืนสต็อก/ตัดกลับตอนคืนรายการ ดู orderStockStore.ts + stockReturn.ts) | ย้ายโต๊ะ/บิลย้อนหลัง ไม่แตะสต็อก
// ลูกค้าเขียน stock ได้เฉพาะ "ลด remaining" ที่ผูกกับออเดอร์ใหม่ใน commit เดียวกัน (ดู firestore.rules)

import { doc, runTransaction, type DocumentReference, type Transaction } from "firebase/firestore";
import { db } from "../lib/firebase";
import { planStockTake } from "./stock";
import type { CartItem } from "./types";
import { isPrepId } from "./prep";

export const stockDocRef = (itemId: string) => doc(db, "stock", itemId);
// สวิตช์ปิดระบบสต็อกทั้งร้าน { enabled: boolean } — ไม่มี doc = เปิด
export const STOCK_CONFIG_REF = () => doc(db, "status", "stockConfig");

export class StockShortError extends Error {
  code = "stock-short";
  // current = remaining ล่าสุดที่อ่านได้ (เหลือ ≤ 0 = หมด / มากกว่านั้น = เหลือไม่พอจำนวนที่สั่ง)
  constructor(public shortIds: string[], public current: Map<string, number | undefined>) {
    super("stock-short");
  }
}

// runTransaction สำหรับออเดอร์ที่ตัดสต็อก + ลองใหม่เองเมื่อโดน permission-denied
// เหตุผล: ลูกค้าสองคนตัดเมนูเดียวกันพร้อมกัน server ตรวจ rules กับค่าที่อีกคนเพิ่งตัดไปแล้ว (ก่อนเช็คว่า
// ข้อมูลที่อ่านมาเก่า) จึงตอบ permission-denied แทนที่จะให้ SDK retry เอง — ไม่ขายเกินแน่นอน แต่คนที่แพ้
// จะส่งไม่ผ่านทั้งที่ยังมีของ ลองใหม่ = อ่านสต็อกล่าสุด → ผ่าน หรือได้ StockShortError ที่ถูกต้อง
// ยังโดนต่อเนื่องจนครบรอบ = ถูกปฏิเสธจริง (เช่นออเดอร์ id นี้ส่งสำเร็จไปแล้วรอบก่อน) → โยนต่อให้ orderSendOutcome
export async function runStockTransaction<R>(fn: (tx: Transaction) => Promise<R>, attempts = 5): Promise<R> {
  for (let i = 1; ; i++) {
    try {
      return await runTransaction(db, fn);
    } catch (err) {
      if ((err as { code?: string })?.code !== "permission-denied" || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 80 * i + Math.random() * 120));
    }
  }
}

// อ่าน remaining ล่าสุดของหลายเมนูใน transaction (undefined = ไม่มี doc = ไม่จำกัด)
export async function readStock(tx: Transaction, itemIds: Iterable<string>): Promise<Map<string, number | undefined>> {
  const ids = [...new Set(itemIds)];
  const snaps = await Promise.all(ids.map((id) => tx.get(stockDocRef(id))));
  const current = new Map<string, number | undefined>();
  snaps.forEach((s, i) => {
    const r = s.exists() ? s.data().remaining : undefined;
    current.set(ids[i], typeof r === "number" ? r : undefined);
  });
  return current;
}

// สร้างออเดอร์ + ตัดสต็อกใน transaction ที่ผู้เรียกเปิดไว้ (อ่านทั้งหมดก่อนเขียนตามกติกา transaction)
// prepare: อ่านอย่างอื่นเพิ่มก่อนเขียน (เช่นตัวนับคิวกลับบ้าน) คืน field ที่จะใส่ในออเดอร์ + ฟังก์ชันเขียนของมัน
// guest = ลูกค้า (ไม่ได้ล็อกอิน) → ห้ามแตะ menuItems; พนักงานกดหมดให้ทันทีในรอบเดียวกันเมื่อสต็อกของเมนูเหลือ 0
// needs มีของเตรียม (stock/prep_*) ปนได้ — ตัดเหมือนกัน แต่เมนูที่ผูกไว้ให้ effect ในเครื่องพนักงานกดหมด (ต้องติดธง soldOutByPrep)
export async function createOrderTakingStock(
  tx: Transaction,
  opts: {
    orderRef: DocumentReference;
    orderData: Record<string, unknown>;
    needs: Map<string, number>;
    guest: boolean;
    // stock doc ของแต่ละบรรทัด (ตัวเดียวกับที่ใช้คิด needs) — ใช้จด stockDocs/stockQty ลงบรรทัดที่ตัดจริง
    docIdsOf?: (ci: CartItem) => string[];
    prepare?: (tx: Transaction) => Promise<{ fields: Record<string, unknown>; write: () => void }>;
  },
): Promise<{ remaining: Map<string, number>; soldOutIds: string[] }> {
  const current = await readStock(tx, opts.needs.keys());
  const prepared = opts.prepare ? await opts.prepare(tx) : null;
  const plan = planStockTake(opts.needs, current, { guest: opts.guest });
  if (!plan.ok) throw new StockShortError(plan.shortIds, current);
  prepared?.write();
  const items = opts.orderData.items as CartItem[] | undefined;
  const docIdsOf = opts.docIdsOf;
  const markedItems = docIdsOf && Array.isArray(items)
    ? { items: items.map((ci) => markStockTaken(ci, docIdsOf(ci), plan.updates)) }
    : {};
  tx.set(opts.orderRef, { ...opts.orderData, ...markedItems, ...(prepared?.fields ?? {}) });
  plan.updates.forEach((remaining, id) => {
    tx.update(stockDocRef(id), { remaining, lastOrderId: opts.orderRef.id });
  });
  if (!opts.guest) {
    plan.soldOutIds.filter((id) => !isPrepId(id))
      .forEach((id) => tx.update(doc(db, "menuItems", id), { soldOut: true, soldOutByStock: true }));
  }
  return { remaining: plan.updates, soldOutIds: plan.soldOutIds };
}

// บรรทัดที่ตัดสต็อกจริง (doc ที่มีจำนวน — ไม่มี doc/ไม่จำกัดไม่นับ) จด stockDocs + stockQty — ไม่ได้ตัดเลย = ไม่ใส่ฟิลด์
export function markStockTaken(ci: CartItem, docIds: string[], taken: Map<string, number>): CartItem {
  const docs = [...new Set(docIds)].filter((id) => taken.has(id));
  if (ci.voided || ci.quantity <= 0 || docs.length === 0) return ci;
  return { ...ci, stockDocs: docs, stockQty: ci.quantity };
}
