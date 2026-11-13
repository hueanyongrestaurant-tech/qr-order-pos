// ─── ยกเลิก / ลดจำนวน / ยกเลิกทั้งใบ / คืนรายการ + คืนสต็อก — transaction ที่คุยกับ Firestore ─────────
// ทุกงานอ่านออเดอร์ล่าสุดจาก server → (คืนสต็อก) อ่าน stock doc ที่เกี่ยวข้อง → เขียนออเดอร์ + stock + log ใน
// transaction เดียว: คืนสต็อกไม่มีทางเกิดซ้ำ (บรรทัดที่ยกเลิกไปแล้วไม่ถูกยกเลิกซ้ำ) หรือครึ่งๆ กลางๆ
// returnStock = คำตอบของพนักงานในหน้าต่างยืนยัน (ไม่ส่ง/false = ไม่คืน) | คำนวณจำนวนคืนจากข้อมูลบน server เสมอ
// logic ล้วนอยู่ใน stockReturn.ts / utils.ts (planVoid, planAdjustQty)

import {
  collection, doc, FieldPath, runTransaction, serverTimestamp,
  type DocumentReference, type Transaction,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { CartItem } from "./types";
import {
  lineFullyServed, lineServedQty, liveItems, planAdjustQty, planVoid, stripItemPhoto,
  type LineChangePlan, type ServeState,
} from "./utils";
import { planStockRetake, planStockReturn, returnNeeds, splitStock, stockOutUnits } from "./stockReturn";
import { planStockTake } from "./stock";
import { readStock, stockDocRef } from "./stockStore";

// ข้อความ error มาจาก App (ภาษาตามที่เลือก)
export interface OrderTxErrors {
  closed: (status: unknown) => Error;      // บิลปิดไปแล้วบน server (จอค้าง)
  notUndoable: (status: unknown) => Error; // ย้อน/แก้ไม่ได้แล้ว
  allServed: () => Error;                  // ทุกชิ้นเสิร์ฟแล้ว ยกเลิกไม่ได้
  // คืนรายการแล้วต้องตัดสต็อกกลับแต่เหลือไม่พอ
  retakeShort: (item: CartItem, short: { id: string; remaining: number; need: number }[]) => Error;
  // กด + ในหน้าจ่ายเงินแต่สต็อกเหลือไม่พอ
  addShort: (item: CartItem, short: { id: string; remaining: number; need: number }[]) => Error;
}

export const logTableOf = (raw: Record<string, any>): string =>
  raw.isTakeaway ? raw.takeawayLabel ?? raw.tableNumber : raw.tableNumber;

// ออเดอร์ที่รอชำระ: รายการที่ไม่มี servedAt ถือว่าเสิร์ฟแล้วตาม status (มาจาก "เสิร์ฟทั้งหมด") — ก่อนดึง status
// กลับเป็น in-progress ต้องจด servedAt ให้รายการเหล่านั้นก่อน ไม่งั้นจะกลายเป็น "ยังไม่เสิร์ฟ" ตามไปด้วย
// รายการที่เคยเสิร์ฟไปบางส่วนก่อน "เสิร์ฟทั้งหมด" จด last = ส่วนที่ "เสิร์ฟทั้งหมด" เติมให้ (ย้อนทีหลังได้ถูกจำนวน)
export const keepServedArgs = (raw: ServeState, items: CartItem[], exceptCartId: string): unknown[] =>
  liveItems(items)
    .filter((ci) => ci.cartId !== exceptCartId && !raw.servedAt?.[ci.cartId])
    .flatMap((ci) => {
      const partial = lineServedQty({ servedUnits: raw.servedUnits }, ci);
      return [
        new FieldPath("servedAt", ci.cartId), serverTimestamp(),
        ...(partial > 0 ? [new FieldPath("servedUnits", ci.cartId), { last: ci.quantity - partial }] : []),
      ];
    });

// เขียนผลของ planVoid/planAdjustQty — items[] ใหม่ + จด servedAt ถ้าบรรทัดเดิมเสิร์ฟครบ + เปลี่ยน status ตามกฎเดิม
function applyLineChange(tx: Transaction, ref: DocumentReference, raw: ServeState, cartId: string, plan: LineChangePlan, reason: string) {
  const units = raw.servedUnits?.[cartId];
  tx.update(
    ref,
    "items", plan.items,
    ...(plan.completeLine
      ? [new FieldPath("servedAt", cartId), serverTimestamp(), new FieldPath("servedUnits", cartId), { last: units?.last ?? units?.count ?? 1 }]
      : []),
    ...(plan.status === "cancelled"
      ? ["status", "cancelled", ...(reason ? ["cancelReason", reason] : []), "cancelledAt", new Date()]
      : plan.status === "awaiting-payment" ? ["status", "awaiting-payment"] : []),
  );
}

type StockVia = "void" | "adjust" | "cancel" | "restore";

// log คืนสต็อก/ตัดกลับ ใน transaction เดียวกัน (สร้าง ref ใหม่ทุกรอบ — รอบที่ commit จริงเขียนแค่ครั้งเดียว)
function logStock(
  tx: Transaction, action: "return_stock" | "retake_stock", raw: Record<string, any>, orderId: string,
  ci: CartItem, qty: number, docs: string[], via: StockVia,
) {
  tx.set(doc(collection(db, "activityLogs")), {
    action,
    orderId,
    tableNumber: logTableOf(raw),
    itemName: ci.item.name.th,
    details: { qty, docs, via, isTakeaway: !!raw.isTakeaway },
    createdAt: serverTimestamp(),
  });
}

// อ่าน (ก่อนเขียนทุกอย่าง) แล้วคืนฟังก์ชันเขียนคืนสต็อก — คืน doc ที่คืนจริง (ไม่มี/ไม่จำกัดถูกข้าม)
async function prepareReturn(tx: Transaction, lines: { docs: string[]; qty: number }[]) {
  const needs = returnNeeds(lines);
  if (needs.size === 0) return { returned: new Set<string>(), write: () => {} };
  const current = await readStock(tx, needs.keys());
  const updates = planStockReturn(needs, current);
  return {
    returned: new Set(updates.keys()),
    write: () => updates.forEach((remaining, id) => tx.update(stockDocRef(id), { remaining })),
  };
}

// ใส่ฟิลด์สต็อกให้บรรทัด (เฉพาะบรรทัดที่เคยตัด) — ไม่ให้ undefined หลุดไป Firestore
function withStock(ci: CartItem, stockQty: number, returned?: boolean): CartItem {
  if (!ci.stockDocs?.length) return ci;
  const { stockReturned: _r, ...rest } = ci;
  return { ...rest, stockQty, ...(returned ? { stockReturned: true } : {}) };
}

// ─── ยกเลิก (void) รายการ ───
// qty = จำนวนที่ยกเลิก (ไม่ส่ง = ทั้งหมดที่ยังไม่เสิร์ฟ) | wholeLine = กด − จนเหลือ 0 ในหน้าจ่ายเงิน
// คืน null = ไม่มีอะไรให้ยกเลิกแล้ว (เช่นอีกเครื่องยกเลิกไปก่อน) — กดซ้ำ/ลองใหม่ไม่คืนสต็อกซ้ำ
export async function voidLineWithStock(
  orderId: string,
  cartId: string,
  opts: { qty?: number; wholeLine?: boolean; reason: string; splitId: string; returnStock?: boolean; errors: OrderTxErrors },
) {
  const ref = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const raw = snap.data();
    const items: CartItem[] = raw.items || [];
    const plan = planVoid(raw, items, cartId, opts.qty ?? Number.MAX_SAFE_INTEGER, {
      wholeLine: opts.wholeLine, splitId: opts.splitId, reason: opts.reason, now: new Date(),
    });
    if (!plan) {
      const target = items.find((ci) => ci.cartId === cartId);
      if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw opts.errors.notUndoable(raw.status);
      if (target && !target.voided) throw opts.errors.allServed();
      return null;
    }
    const { returnQty, keepStock } = splitStock(plan.target, plan.target.quantity - plan.n);
    const docs = plan.target.stockDocs ?? [];
    const ret = await prepareReturn(tx, opts.returnStock ? [{ docs, qty: returnQty }] : []);
    const didReturn = ret.returned.size > 0;
    plan.items = plan.items.map((ci) => {
      if (ci.cartId === plan.voidedCartId) return withStock(ci, returnQty, didReturn);
      if (ci.cartId === cartId) return withStock(ci, keepStock);
      return ci;
    });
    applyLineChange(tx, ref, raw, cartId, plan, opts.reason);
    ret.write();
    if (didReturn) logStock(tx, "return_stock", raw, orderId, plan.target, returnQty, [...ret.returned], "void");
    return { raw, plan, returnedQty: didReturn ? returnQty : 0 };
  });
}

// ─── ปรับจำนวน +/− (ไม่ถึง 0) ในหน้าจ่ายเงิน ───
// + ตัดสต็อกเหมือนตอนสั่งใน transaction เดียวกัน (ไม่พอ = ไม่เพิ่ม errors.addShort) แล้วจดลงบรรทัด:
//   บรรทัดที่จดไว้แล้ว (stockDocs) ตัด doc ชุดเดิม | ยังไม่จด แต่ออเดอร์ใหม่ (stockRecorded) → docIdsOf (เหมือนพนักงานสั่ง)
//   ออเดอร์เก่า (ไม่มี stockRecorded และไม่มี stockDocs) = ไม่ตัด (ตามเดิม) | doc ไม่มี/ไม่จำกัด ข้าม
// − คืนได้เฉพาะชิ้นที่ตัดไปจริง (ดู splitStock)
export async function adjustLineWithStock(
  orderId: string,
  cartId: string,
  delta: number,
  opts: { reason: string; returnStock?: boolean; docIdsOf?: (ci: CartItem) => string[]; errors: OrderTxErrors },
) {
  const ref = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const raw = snap.data();
    const plan = planAdjustQty(raw, raw.items || [], cartId, delta);
    if (!plan) {
      if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw opts.errors.notUndoable(raw.status);
      return null;
    }
    let returnedQty = 0;
    let ret = await prepareReturn(tx, []);
    let takeWrite = () => {};
    if (delta > 0) {
      const t = plan.target;
      const docs = t.stockDocs?.length ? t.stockDocs : raw.stockRecorded && opts.docIdsOf ? opts.docIdsOf(t) : [];
      const needs = returnNeeds([{ docs, qty: delta }]);
      if (needs.size > 0) {
        const current = await readStock(tx, needs.keys());
        const take = planStockTake(needs, current, { guest: false });
        if (!take.ok) {
          throw opts.errors.addShort(t, take.shortIds.map((id) => ({ id, remaining: current.get(id) ?? 0, need: needs.get(id) ?? 0 })));
        }
        if (take.updates.size > 0) {
          const taken = t.stockDocs?.length ? t.stockDocs : [...take.updates.keys()];
          const stockQty = stockOutUnits(t) + delta;
          plan.items = plan.items.map((ci) => (ci.cartId === cartId ? withStock({ ...ci, stockDocs: taken }, stockQty) : ci));
          takeWrite = () => take.updates.forEach((remaining, id) => tx.update(stockDocRef(id), { remaining }));
        }
      }
    }
    if (delta < 0) {
      const { returnQty, keepStock } = splitStock(plan.target, plan.newQty);
      ret = await prepareReturn(tx, opts.returnStock ? [{ docs: plan.target.stockDocs ?? [], qty: returnQty }] : []);
      if (ret.returned.size > 0) returnedQty = returnQty;
      plan.items = plan.items.map((ci) => (ci.cartId === cartId ? withStock(ci, keepStock) : ci));
    }
    applyLineChange(tx, ref, raw, cartId, plan, opts.reason);
    ret.write();
    takeWrite();
    if (returnedQty > 0) logStock(tx, "return_stock", raw, orderId, plan.target, returnedQty, [...ret.returned], "adjust");
    return { raw, plan, returnedQty };
  });
}

// ─── ยกเลิกทั้งออเดอร์ ───
// returnCartIds = บรรทัดที่พนักงานเลือกคืนสต็อก | บิลที่จ่าย/ยกเลิกไปแล้วบน server ห้ามยกเลิกทับ (errors.closed)
export async function cancelOrderWithStock(
  orderId: string,
  opts: { reason: string; returnCartIds?: Set<string>; errors: OrderTxErrors },
) {
  const ref = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const raw = snap.data();
    if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw opts.errors.closed(raw.status);
    const items: CartItem[] = raw.items || [];
    const lines = items
      .filter((ci) => !ci.voided && opts.returnCartIds?.has(ci.cartId) && stockOutUnits(ci) > 0)
      .map((ci) => ({ ci, docs: ci.stockDocs ?? [], qty: stockOutUnits(ci) }));
    const ret = await prepareReturn(tx, lines);
    const returnedLines = lines
      .map((l) => ({ ...l, docs: l.docs.filter((d) => ret.returned.has(d)) }))
      .filter((l) => l.docs.length > 0);
    const returnedIds = new Set(returnedLines.map((l) => l.ci.cartId));
    tx.update(ref, {
      status: "cancelled",
      ...(opts.reason ? { cancelReason: opts.reason } : {}),
      cancelledAt: new Date(),
      // ออเดอร์ที่ถูกยกเลิก ไม่เก็บรูปไว้เลย | บรรทัดที่คืนสต็อกติดธงไว้ (ดูย้อนหลังได้ว่าคืนอะไรไป)
      items: items.map((ci) => stripItemPhoto(returnedIds.has(ci.cartId) ? withStock(ci, stockOutUnits(ci), true) : ci)),
    });
    ret.write();
    returnedLines.forEach((l) => logStock(tx, "return_stock", raw, orderId, l.ci, l.qty, l.docs, "cancel"));
    return { raw, returned: returnedLines.map((l) => ({ item: l.ci, qty: l.qty })) };
  });
}

// ─── คืนรายการที่ยกเลิกไปแล้ว ───
// เคยคืนสต็อกตอนยกเลิก (stockReturned) → ตัดกลับใน transaction เดียวกัน | ไม่พอ = คืนรายการไม่ได้ (errors.retakeShort)
export async function restoreLineWithStock(orderId: string, cartId: string, opts: { errors: OrderTxErrors }) {
  const ref = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const raw = snap.data();
    if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw opts.errors.notUndoable(raw.status);
    const items: CartItem[] = raw.items || [];
    const target = items.find((ci) => ci.cartId === cartId);
    if (!target || !target.voided) return null;
    let retaken = { qty: 0, docs: [] as string[], write: () => {} };
    if (target.stockReturned) {
      const qty = stockOutUnits({ ...target, stockReturned: false });
      const needs = returnNeeds([{ docs: target.stockDocs ?? [], qty }]);
      const current = await readStock(tx, needs.keys());
      const plan = planStockRetake(needs, current);
      if (!plan.ok) {
        throw opts.errors.retakeShort(target, plan.shortIds.map((id) => ({ id, remaining: current.get(id) ?? 0, need: needs.get(id) ?? 0 })));
      }
      retaken = {
        qty,
        docs: [...plan.updates.keys()],
        write: () => plan.updates.forEach((remaining, id) => tx.update(stockDocRef(id), { remaining })),
      };
    }
    const newItems = items.map((ci) => {
      if (ci.cartId !== cartId) return ci;
      const { voided: _v, voidReason: _r, voidedAt: _a, voidedWhileUnserved: _u, stockReturned: _s, ...rest } = ci;
      return rest;
    });
    if (raw.status === "awaiting-payment" && target.voidedWhileUnserved && !lineFullyServed(raw, target)) {
      tx.update(ref, "items", newItems, "status", "in-progress", ...keepServedArgs(raw, items, cartId));
    } else {
      tx.update(ref, { items: newItems });
    }
    retaken.write();
    if (retaken.docs.length > 0) logStock(tx, "retake_stock", raw, orderId, target, retaken.qty, retaken.docs, "restore");
    return { raw, target, retakenQty: retaken.docs.length > 0 ? retaken.qty : 0 };
  });
}
