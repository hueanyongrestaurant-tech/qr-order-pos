// ─── ปิดบิลโต๊ะ (1 โต๊ะ หรือ "รวมโต๊ะ" หลายโต๊ะเป็นบิลเดียว) ใน transaction เดียว ─────────────────
// อ่านออเดอร์ค้างของทุกโต๊ะใหม่จาก server แล้วปิดทุกรอบของทุกโต๊ะพร้อมกัน (สำเร็จหมดหรือไม่ปิดเลย)
// ไม่ยอมปิดถ้าโต๊ะใดยังมีรอบที่ยังไม่เสิร์ฟ หรือชุดออเดอร์/ยอดไม่ตรงกับที่พนักงานเห็นบนการ์ด (ดู planTablesClose)
// ทุกออเดอร์ได้ paymentBatchId เดียวกัน = 1 บิล / 1 กลุ่มลูกค้าในสถิติ / 1 รายการในประวัติ
// เขียนเฉพาะ awaiting-payment → paid (rules closedOrderStaysClosed ไม่เปิดบิลที่ปิดแล้วกลับมา — ไม่ต้องแก้ rules)
// + จดเวลาปิดบิลของทุกโต๊ะลง status/tableClosures ให้หน้าเว็บลูกค้าคนเก่าที่เปิดค้างสั่งต่อไม่ได้

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { PaymentInput } from "../types";
import { planTablesClose } from "../tableSession";
import { allocateTransfer, mapOrderDoc, orderTotal, uid } from "../utils";

// เวลาปิดบิลล่าสุดของแต่ละโต๊ะ { closedAt: { "1-3": Timestamp } } — หน้าเว็บลูกค้าเช็คก่อนส่งออเดอร์ (ดู tableSession.ts)
// อยู่ใน status/ เพราะ rules เดิมให้ลูกค้าอ่าน + พนักงานเขียนได้อยู่แล้ว ไม่ต้องแก้ rules
// (ห้ามใส่ใน status/live — doc นั้นถูก setDoc ทับทั้งก้อนโดยตัวนับร้านยุ่ง)
export const TABLE_CLOSURES_DOC = "tableClosures";

// ปิดบิลไม่ได้ — โยนจากใน transaction แล้วแจ้งพนักงานตาม code; table = โต๊ะที่เป็นต้นเหตุ
export class CloseTableError extends Error {
  code: "pending" | "changed" | "nothing";
  table: string;
  constructor(code: "pending" | "changed" | "nothing", table: string) {
    super(code);
    this.code = code;
    this.table = table;
  }
}

// ฟิลด์การชำระเงินที่เขียนลงออเดอร์ 1 ใบ — transferAmount คือส่วนโอนของ "ใบนี้" (split เท่านั้น)
export const paymentFields = (payment: PaymentInput, orderTransferAmount?: number) => ({
  paymentMethod: payment.method,
  ...(payment.cashReceived !== undefined ? { cashReceived: payment.cashReceived } : {}),
  ...(payment.method === "split" && orderTransferAmount !== undefined ? { transferAmount: orderTransferAmount } : {}),
});

export type ExpectedBills = Record<string, { orderIds: string[]; total: number }>;

// คืน paymentBatchId ที่ใช้ + id ออเดอร์ที่ปิด
export async function closeTablesTx(
  tables: string[],
  payment: PaymentInput,
  expected: ExpectedBills,
): Promise<{ batchId: string; orderIds: string[] }> {
  const batchId = uid();
  const store = db; // จับ instance ไว้ตั้งแต่เริ่ม (retry ของ transaction ใช้ตัวเดิมเสมอ)
  const unique = [...new Set(tables)];
  const orderIds = await runTransaction(store, async (tx) => {
    // อ่าน+เขียน closures doc ทุกครั้ง = guard: สองเครื่องปิดโต๊ะเดียวกันพร้อมกันจะชนกันแล้ว retry
    // (retry รัน query ใหม่ เห็นว่าอีกเครื่องปิดไปแล้ว → "nothing")
    const closuresRef = doc(store, "status", TABLE_CLOSURES_DOC);
    await tx.get(closuresRef);
    // กรอง status ใน query เสมอ — ไม่งั้นอ่านประวัติทั้งหมดของโต๊ะ
    const snaps = await Promise.all(unique.map((table) => getDocs(query(
      collection(store, "orders"),
      where("tableNumber", "==", table),
      where("status", "in", ["in-progress", "awaiting-payment"]),
    ))));
    const ids = [...new Set(snaps.flatMap((s) => s.docs.map((d) => d.id)))];
    const fresh = (await Promise.all(ids.map((id) => tx.get(doc(store, "orders", id))))).filter((s) => s.exists());
    const plan = planTablesClose(
      unique,
      fresh.map((s) => {
        const o = mapOrderDoc(s.id, s.data());
        return { id: s.id, tableNumber: o.tableNumber, status: o.status, isTakeaway: o.isTakeaway, createdAtMs: o.timestamp.getTime(), total: orderTotal(o) };
      }),
      expected,
    );
    if (plan.kind !== "ok") throw new CloseTableError(plan.kind, plan.table);
    const transferShares = payment.method === "split"
      ? allocateTransfer(plan.toClose.map((o) => o.total), payment.transferAmount ?? 0)
      : [];
    plan.toClose.forEach((o, i) =>
      tx.update(doc(store, "orders", o.id), {
        status: "paid",
        paymentBatchId: batchId,
        paidAt: serverTimestamp(),
        ...paymentFields(payment, transferShares[i]),
      }),
    );
    tx.set(closuresRef, { closedAt: Object.fromEntries(unique.map((t) => [t, serverTimestamp()])) }, { merge: true });
    return plan.toClose.map((o) => o.id);
  });
  return { batchId, orderIds };
}
