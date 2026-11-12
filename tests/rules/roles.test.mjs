// บัญชีเจ้าของ / พนักงาน กับ firestore.rules ชุดใหม่ (emulator — ไม่แตะ production)
// เจ้าของทำได้ทุกอย่าง | พนักงานทำงานหน้าร้านได้ครบ แต่ดึงยอดขายย้อนหลัง/สถิติ/รายจ่าย/บันทึกกิจกรรมไม่ได้ | ลูกค้าเหมือนเดิม
// query ของพนักงานในไฟล์นี้ = query เดียวกับที่แอปยิงจริง (ดูหมายเลขในคอมเมนต์เทียบกับรายการใน PR/คำอธิบาย)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { closeTablesTx } from "../../src/app/staff/closeTables";
import { createMissingTableLinks, listTableLinks, writeTableView } from "../../src/app/tableViewStore";
import { encodeTableView } from "../../src/app/tableView";
import { OWNER_EMAIL, STAFF_EMAIL } from "../../src/app/constants";
import { canSeeTab, roleForEmail } from "../../src/app/staff/roleStore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { await env?.cleanup(); });

const owner = () => env.authenticatedContext("owner-uid", { email: OWNER_EMAIL }).firestore();
const staff = () => env.authenticatedContext("staff-uid", { email: STAFF_EMAIL }).firestore();
const guest = () => env.unauthenticatedContext().firestore();
const ACTIVE = ["in-progress", "awaiting-payment"];

const menu = (id, price) => ({ id, categoryId: "food", name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price, hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false, customGroups: [] });
const line = (id, price, quantity) => ({ cartId: `${id}-${quantity}`, item: menu(id, price), quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} });
const at = (daysAgo, minute = 0) => Timestamp.fromMillis(Date.now() - daysAgo * 86400000 + minute * 60000);
const order = (table, status, items, extra = {}) => ({ tableNumber: table, status, items, createdAt: at(0), ...extra });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "orders", "a1"), order("1-2", "in-progress", [line("rice", 50, 2)]));
    await setDoc(doc(db, "orders", "a2"), order("1-2", "awaiting-payment", [line("tea", 25, 2)]));
    await setDoc(doc(db, "orders", "b1"), order("1-3", "awaiting-payment", [line("soup", 80, 1)]));
    await setDoc(doc(db, "orders", "t1"), order("T-1", "awaiting-payment", [line("rice", 50, 1)], { isTakeaway: true, takeawayLabel: "T-1" }));
    // ยอดขายเก่า
    await setDoc(doc(db, "orders", "paid-today"), order("2-1", "paid", [line("rice", 50, 4)], { paidAt: at(0), paymentMethod: "cash" }));
    await setDoc(doc(db, "orders", "paid-old"), order("2-2", "paid", [line("soup", 80, 5)], { createdAt: at(30), paidAt: at(30), paymentMethod: "transfer" }));
    await setDoc(doc(db, "orders", "cancelled-old"), order("2-3", "cancelled", [line("tea", 25, 1)], { createdAt: at(20), cancelledAt: at(20) }));
    await setDoc(doc(db, "orders", "backfill-old"), order("2-4", "paid", [line("tea", 25, 1)], { createdAt: at(2), backfilled: true, backfilledAt: at(1) }));
    await setDoc(doc(db, "dailyStats", "2026-10-01"), { total: 12345, bills: 40 });
    await setDoc(doc(db, "expenses", "2026-10-01"), { date: "2026-10-01", items: [{ name: "gas", amount: 400 }] });
    await setDoc(doc(db, "expenseItems", "gas"), { name: "gas" });
    await setDoc(doc(db, "activityLogs", "log1"), { action: "void_item", amount: 50, createdAt: at(1) });
    await setDoc(doc(db, "stock", "rice"), { remaining: 10 });
    await setDoc(doc(db, "menuItems", "rice"), { price: 50 });
    await setDoc(doc(db, "categories", "food"), { nameTh: "อาหาร", order: 0 });
    await setDoc(doc(db, "status", "live"), { busyTables: 0, busyItems: 0 });
    await setDoc(doc(db, "tableViews", "TOKEN-1-2"), { table: "1-2", version: 1, data: "{}", hash: "h", createdAt: at(5), updatedAt: at(5) });
  });
});

const read = async (path) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
};
// query ประวัติ/สถิติของแอป (fetchPaidOrders, dailyStats.ts): ช่วง createdAt ไม่กรอง status
const historyQuery = (db, days = 60) => query(collection(db, "orders"), where("createdAt", ">=", at(days).toDate()), where("createdAt", "<", at(-1).toDate()), orderBy("createdAt", "asc"), limit(8000));
const ids = (snap) => snap.docs.map((d) => d.id).sort();

// ─── role จากอีเมล + แท็บที่เห็น ───
test("role comes from the signed-in email; staff do not get history / stats / expenses / activity tabs", () => {
  assert.equal(roleForEmail(OWNER_EMAIL), "owner");
  assert.equal(roleForEmail("Owner@Hueanyong.Local "), "owner");
  assert.equal(roleForEmail(STAFF_EMAIL), "staff");
  assert.equal(roleForEmail(null), "staff");
  assert.equal(roleForEmail("someone-else@hueanyong.local"), "staff");
  for (const tab of ["orders", "payment", "menu"]) assert.ok(canSeeTab("staff", tab), tab);
  for (const tab of ["history", "stats", "expenses", "activity"]) {
    assert.equal(canSeeTab("staff", tab), false, tab);
    assert.equal(canSeeTab(null, tab), false, tab);
    assert.ok(canSeeTab("owner", tab), tab);
  }
});

// ─── พนักงาน: งานหน้าร้านทุกอย่างยังทำได้ ───
test("staff Q1: orders-screen listener (status in active, limit 300) works — also as a live listener", async () => {
  const q = query(collection(staff(), "orders"), where("status", "in", ACTIVE), limit(300));
  assert.deepEqual(ids(await assertSucceeds(getDocs(q))), ["a1", "a2", "b1", "t1"]);
  // listener จริง (ที่ auto-print ครัว/เคาน์เตอร์ใช้) + ออเดอร์ใหม่ของลูกค้าเข้ามา + บิลที่ถูกปิดหลุดออกไป ไม่ error
  const seen = [];
  let failed = null;
  const stop = onSnapshot(q, (snap) => seen.push(ids(snap)), (err) => { failed = err; });
  await assertSucceeds(setDoc(doc(guest(), "orders", "new-guest"), order("1-4", "in-progress", [line("rice", 50, 1)], { createdAt: serverTimestamp() })));
  await assertSucceeds(updateDoc(doc(staff(), "orders", "b1"), { status: "paid", paymentMethod: "cash", paidAt: serverTimestamp() }));
  for (let i = 0; i < 100 && !(seen.at(-1)?.includes("new-guest") && !seen.at(-1)?.includes("b1")); i++) await new Promise((r) => setTimeout(r, 30));
  stop();
  assert.equal(failed, null);
  assert.deepEqual(seen.at(-1), ["a1", "a2", "new-guest", "t1"]);
});

test("staff Q2: create orders — manual table order, takeaway with the queue counter", async () => {
  const db = staff();
  await assertSucceeds(addDoc(collection(db, "orders"), order("1-5", "in-progress", [line("rice", 50, 1)], { createdAt: serverTimestamp() })));
  // คิวกลับบ้าน: transaction อ่าน+เขียน counters/takeaway-<วัน> แล้วสร้างออเดอร์
  await assertSucceeds(runTransaction(db, async (tx) => {
    const ref = doc(db, "counters", "takeaway-2026-11-12");
    const n = ((await tx.get(ref)).data()?.count || 0) + 1;
    tx.set(ref, { count: n });
    tx.set(doc(collection(db, "orders")), order("T-" + n, "in-progress", [line("rice", 50, 1)], { isTakeaway: true, takeawayLabel: "T-" + n, createdAt: serverTimestamp() }));
  }));
});

test("staff Q3: serve / unserve / void item / cancel order — transaction get + update on one order", async () => {
  const db = staff();
  const ref = doc(db, "orders", "a1");
  await assertSucceeds(runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    tx.update(ref, { status: "awaiting-payment", servedAt: { [snap.data().items[0].cartId]: new Date() } });
  }));
  await assertSucceeds(runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    tx.update(ref, { items: snap.data().items.map((ci) => ({ ...ci, voided: true, voidReason: "ลูกค้าเปลี่ยนใจ" })) });
  }));
  await assertSucceeds(runTransaction(db, async (tx) => {
    await tx.get(ref);
    tx.update(ref, { status: "cancelled", cancelledAt: new Date() });
  }));
  // เหตุผลการยกเลิก + log ยังจดได้
  await assertSucceeds(setDoc(doc(db, "voidReasons", "list"), { reasons: ["ลูกค้าเปลี่ยนใจ"] }, { merge: true }));
  await assertSucceeds(getDoc(doc(db, "voidReasons", "list")));
  await assertSucceeds(addDoc(collection(db, "activityLogs"), { action: "cancel_order", orderId: "a1", amount: 100, createdAt: serverTimestamp() }));
});

test("staff Q4: pay a table and combine tables (closeTablesTx — real code) — then the bills are closed", async () => {
  // a1 ยังไม่เสิร์ฟ — แอปไม่ให้ปิดบิลที่ยังมีของค้าง: พนักงานกดเสิร์ฟก่อน (transaction แบบ Q3)
  const db = staff();
  const a1 = doc(db, "orders", "a1");
  await assertSucceeds(runTransaction(db, async (tx) => { await tx.get(a1); tx.update(a1, { status: "awaiting-payment" }); }));
  setTestDb(db);
  const result = await closeTablesTx(["1-2", "1-3"], { method: "cash", cashReceived: 500 }, {
    "1-2": { orderIds: ["a1", "a2"], total: 150 },
    "1-3": { orderIds: ["b1"], total: 80 },
  });
  assert.deepEqual([...result.orderIds].sort(), ["a1", "a2", "b1"]);
  assert.equal((await read("orders/a1")).status, "paid");
  assert.equal((await read("orders/b1")).paymentBatchId, result.batchId);
});

test("staff Q5: close a takeaway bill (transaction get + update to paid)", async () => {
  const db = staff();
  const ref = doc(db, "orders", "t1");
  await assertSucceeds(runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    assert.equal(snap.data().status, "awaiting-payment");
    tx.update(ref, { status: "paid", paymentMethod: "transfer", paidAt: serverTimestamp() });
  }));
});

test("staff Q6: move table — query by table + active status, transaction on each order, guard doc, closures, activity log", async () => {
  const db = staff();
  const [src, dst] = await Promise.all(["1-2", "2-9"].map((table) => assertSucceeds(getDocs(query(collection(db, "orders"), where("tableNumber", "==", table), where("status", "in", ACTIVE))))));
  assert.deepEqual(ids(src), ["a1", "a2"]);
  assert.equal(dst.size, 0);
  await assertSucceeds(runTransaction(db, async (tx) => {
    const guardRef = doc(db, "counters", "table-moves");
    await tx.get(guardRef);
    const docs = await Promise.all(src.docs.map((d) => tx.get(doc(db, "orders", d.id))));
    docs.forEach((s) => tx.update(s.ref, { tableNumber: "2-9", moveId: "m1", movedFrom: "1-2", movedAt: serverTimestamp() }));
    tx.set(guardRef, { lastMoveId: "m1" }, { merge: true });
    tx.set(doc(db, "status", "tableClosures"), { closedAt: { "1-2": serverTimestamp() } }, { merge: true });
    tx.set(doc(collection(db, "activityLogs")), { action: "move_table", from: "1-2", to: "2-9", createdAt: serverTimestamp() });
  }));
  assert.equal((await read("orders/a1")).tableNumber, "2-9");
});

test("staff Q7: stale-screen checks — reading ONE order that another device already closed still works, and it stays closed", async () => {
  const db = staff();
  const ref = doc(db, "orders", "paid-today");
  // transaction ของเสิร์ฟ/ยกเลิกอ่านใบนั้นก่อน: ต้องอ่านได้เพื่อรู้ว่าปิดไปแล้ว (ไม่งั้นจอค้างจะ error แทนที่จะบอกว่าบิลปิดแล้ว)
  let seenStatus;
  await assertSucceeds(runTransaction(db, async (tx) => { seenStatus = (await tx.get(ref)).data().status; }));
  assert.equal(seenStatus, "paid");
  await assertFails(updateDoc(ref, { status: "in-progress" }));
  await assertFails(updateDoc(ref, { status: "cancelled" }));
});

test("staff Q8: tableViews writer, table links, status docs, menu, stock, printers — unchanged", async () => {
  const db = staff();
  setTestDb(db);
  assert.equal((await listTableLinks()).get("1-2").token, "TOKEN-1-2");
  await assertSucceeds(writeTableView("TOKEN-1-2", encodeTableView({ lines: [], total: 0, orderIds: [] })));
  assert.deepEqual(await createMissingTableLinks(["1-2", "1-3"]), { created: ["1-3"], skipped: ["1-2"] });
  await assertSucceeds(setDoc(doc(db, "status", "live"), { busyTables: 2, busyItems: 5 }));
  await assertSucceeds(setDoc(doc(db, "status", "printRouting"), { food: "kitchen" }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "status", "receipt"), { newLayout: true }, { merge: true }));
  await assertSucceeds(updateDoc(doc(db, "menuItems", "rice"), { soldOut: true }));
  await assertSucceeds(setDoc(doc(db, "stock", "rice"), { remaining: 5 }));
  await assertSucceeds(setDoc(doc(db, "printers", "5A:4A:8E:4E:09:4E"), { name: "ครัวใน", address: "5A:4A:8E:4E:09:4E" }));
  assert.equal((await assertSucceeds(getDocs(collection(db, "printers")))).size, 1);
  await assertSucceeds(deleteDoc(doc(db, "printers", "5A:4A:8E:4E:09:4E")));
});

// ─── พนักงาน: ดึงยอดขายย้อนหลังไม่ได้ ───
test("staff DENIED: every way of listing closed orders (sales history)", async () => {
  const db = staff();
  const orders = collection(db, "orders");
  await assertFails(getDocs(historyQuery(db)));                                                   // ประวัติ/สถิติ (ช่วงวันที่)
  await assertFails(getDocs(orders));                                                             // ทั้ง collection
  await assertFails(getDocs(query(orders, limit(1))));
  await assertFails(getDocs(query(orders, orderBy("createdAt", "asc"), limit(1))));               // fetchFirstOrderDay
  await assertFails(getDocs(query(orders, where("status", "==", "paid"))));
  await assertFails(getDocs(query(orders, where("status", "in", ["paid", "cancelled"]))));
  await assertFails(getDocs(query(orders, where("status", "in", [...ACTIVE, "paid"]))));          // แอบพ่วง paid
  await assertFails(getDocs(query(orders, where("tableNumber", "==", "2-1"))));                   // ทั้งประวัติของโต๊ะ
  await assertFails(getDocs(query(orders, where("backfilledAt", ">", at(60).toDate()), limit(500)))); // syncPaidOrdersDisk
  await assertFails(getDocs(query(orders, where("cancelledAt", ">", at(60).toDate()), limit(500))));
  await assertFails(getDocs(query(orders, where("paymentMethod", "==", "cash"))));
  let failed = null;
  const stop = onSnapshot(historyQuery(db), () => {}, (err) => { failed = err; });
  for (let i = 0; i < 100 && !failed; i++) await new Promise((r) => setTimeout(r, 30));
  stop();
  assert.equal(failed?.code, "permission-denied");
});

test("staff DENIED: stats, expenses, activity-log reads, backfill bills", async () => {
  const db = staff();
  await assertFails(getDoc(doc(db, "dailyStats", "2026-10-01")));
  await assertFails(getDocs(collection(db, "dailyStats")));
  await assertFails(setDoc(doc(db, "dailyStats", "2026-10-02"), { total: 1 }));
  await assertFails(setDoc(doc(db, "dailyStats", "2026-10-01"), { stale: true }, { merge: true }));
  await assertFails(getDoc(doc(db, "expenses", "2026-10-01")));
  await assertFails(getDocs(query(collection(db, "expenses"), where("date", ">=", "2026-10-01"), where("date", "<=", "2026-10-31"), limit(750))));
  await assertFails(setDoc(doc(db, "expenses", "2026-10-03"), { date: "2026-10-03", items: [] }));
  await assertFails(getDocs(query(collection(db, "expenseItems"), limit(1000))));
  await assertFails(setDoc(doc(db, "expenseItems", "x"), { name: "x" }));
  await assertFails(getDoc(doc(db, "activityLogs", "log1")));
  await assertFails(getDocs(query(collection(db, "activityLogs"), orderBy("createdAt", "desc"), limit(50))));
  await assertFails(updateDoc(doc(db, "activityLogs", "log1"), { amount: 0 }));
  await assertFails(deleteDoc(doc(db, "activityLogs", "log1")));
  // บิลย้อนหลัง (เข้าจากหน้าประวัติ) = เจ้าของเท่านั้น
  await assertFails(addDoc(collection(db, "orders"), order("1-1", "paid", [line("rice", 50, 1)], { backfilled: true, createdAt: at(1) })));
  await assertFails(updateDoc(doc(db, "orders", "backfill-old"), { status: "cancelled", cancelledAt: new Date() }));
  await assertFails(deleteDoc(doc(db, "orders", "a1")));
});

// ─── เจ้าของ: ทำได้ทุกอย่าง ───
test("owner: everything staff can do, plus history, stats, expenses, activity log, backfill", async () => {
  const db = owner();
  const orders = collection(db, "orders");
  assert.equal((await assertSucceeds(getDocs(historyQuery(db)))).size, 8);
  assert.equal((await assertSucceeds(getDocs(query(orders, orderBy("createdAt", "asc"), limit(1))))).docs[0].id, "paid-old");
  await assertSucceeds(getDocs(query(orders, where("backfilledAt", ">", at(60).toDate()), limit(500))));
  await assertSucceeds(getDocs(query(orders, where("cancelledAt", ">", at(60).toDate()), limit(500))));
  await assertSucceeds(getDocs(query(orders, where("status", "in", ACTIVE), limit(300))));
  await assertSucceeds(getDocs(orders));
  await assertSucceeds(getDoc(doc(db, "dailyStats", "2026-10-01")));
  await assertSucceeds(setDoc(doc(db, "dailyStats", "2026-10-02"), { total: 1 }));
  await assertSucceeds(setDoc(doc(db, "dailyStats", "2026-10-01"), { stale: true, staleAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(db, "dailyStats", "not-a-day"), { total: 1 }));
  await assertSucceeds(getDocs(query(collection(db, "expenses"), where("date", ">=", "2026-10-01"), where("date", "<=", "2026-10-31"), limit(750))));
  await assertSucceeds(setDoc(doc(db, "expenses", "2026-10-03"), { date: "2026-10-03", items: [] }));
  await assertSucceeds(deleteDoc(doc(db, "expenses", "2026-10-03")));
  await assertSucceeds(getDocs(query(collection(db, "expenseItems"), limit(1000))));
  await assertSucceeds(setDoc(doc(db, "expenseItems", "x"), { name: "x" }));
  await assertSucceeds(getDocs(query(collection(db, "activityLogs"), orderBy("createdAt", "desc"), limit(50))));
  await assertSucceeds(addDoc(collection(db, "activityLogs"), { action: "x", createdAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db, "activityLogs", "log1")));       // log ลบไม่ได้แม้เจ้าของ
  await assertFails(deleteDoc(doc(db, "orders", "a1")));               // ออเดอร์ลบไม่ได้แม้เจ้าของ
  // บิลย้อนหลัง + ยกเลิกบิลย้อนหลัง
  await assertSucceeds(addDoc(orders, order("1-1", "paid", [line("rice", 50, 1)], { backfilled: true, backfilledAt: serverTimestamp(), createdAt: at(1) })));
  await assertSucceeds(updateDoc(doc(db, "orders", "backfill-old"), { status: "cancelled", cancelledAt: new Date() }));
  await assertFails(updateDoc(doc(db, "orders", "paid-today"), { status: "in-progress" })); // บิลปิดแล้วเปิดกลับไม่ได้ทุกบัญชี
  // งานหน้าร้าน
  setTestDb(db);
  const result = await closeTablesTx(["1-3"], { method: "cash", cashReceived: 100 }, { "1-3": { orderIds: ["b1"], total: 80 } });
  assert.deepEqual(result.orderIds, ["b1"]);
  await assertSucceeds(setDoc(doc(db, "printers", "AA:BB:CC:DD:EE:FF"), { name: "x", address: "AA:BB:CC:DD:EE:FF" }));
  assert.deepEqual(await createMissingTableLinks(["1-2", "2-1"]), { created: ["2-1"], skipped: ["1-2"] });
});

// ─── ลูกค้า: เหมือนเดิม ───
test("guest: ordering and the table link still work; nothing else opened up", async () => {
  const db = guest();
  await assertSucceeds(setDoc(doc(db, "orders", "g1"), order("1-2", "in-progress", [line("rice", 50, 1)], { createdAt: serverTimestamp() })));
  // สั่งพร้อมตัดสต็อกใน commit เดียว
  const batch = writeBatch(db);
  batch.set(doc(db, "orders", "g2"), order("1-2", "in-progress", [line("rice", 50, 1)], { createdAt: serverTimestamp() }));
  batch.update(doc(db, "stock", "rice"), { remaining: 9, lastOrderId: "g2" });
  await assertSucceeds(batch.commit());
  assert.equal((await assertSucceeds(getDoc(doc(db, "tableViews", "TOKEN-1-2")))).data().table, "1-2");
  await assertSucceeds(getDocs(collection(db, "menuItems")));
  await assertSucceeds(getDocs(collection(db, "categories")));
  await assertSucceeds(getDoc(doc(db, "status", "qrConfig")));
  await assertSucceeds(getDoc(doc(db, "stock", "rice")));
  await assertFails(getDoc(doc(db, "orders", "g1")));
  await assertFails(getDocs(query(collection(db, "orders"), where("status", "in", ACTIVE), limit(300))));
  await assertFails(updateDoc(doc(db, "orders", "g1"), { status: "cancelled" }));
  await assertFails(setDoc(doc(db, "orders", "g3"), order("1-2", "paid", [], { backfilled: true, createdAt: at(1) })));
  await assertFails(getDocs(collection(db, "tableViews")));
  await assertFails(getDocs(collection(db, "printers")));
  await assertFails(setDoc(doc(db, "printers", "AA:BB:CC:DD:EE:FF"), { name: "x" }));
  await assertFails(getDoc(doc(db, "dailyStats", "2026-10-01")));
  await assertFails(getDoc(doc(db, "expenses", "2026-10-01")));
  await assertFails(getDoc(doc(db, "activityLogs", "log1")));
  await assertFails(addDoc(collection(db, "activityLogs"), { action: "x" }));
  await assertFails(getDoc(doc(db, "counters", "takeaway-2026-11-12")));
});

// ─── บัญชีแปลกหน้า: ใครก็สมัครบัญชี Firebase Auth ได้ด้วย API key ในหน้าเว็บ — ล็อกอินได้ แต่ต้องไม่ได้อะไรเลย ───
test("signed-in STRANGER (self-registered account) is denied everything staff can do — same as a guest", async () => {
  const strangers = [
    env.authenticatedContext("stranger-1", { email: "someone@gmail.com" }).firestore(),
    env.authenticatedContext("stranger-2", { email: "admin@hueanyong.local.evil.com" }).firestore(),
    env.authenticatedContext("stranger-3", { email: "ADMIN@hueanyong.local" }).firestore(),     // อีเมลใน token เป็นตัวพิมพ์เล็กเสมอ — ตัวใหญ่ = ไม่ใช่
    env.authenticatedContext("stranger-4", { email: "xowner@hueanyong.local" }).firestore(),
    env.authenticatedContext("stranger-5").firestore(),                                           // ไม่มีอีเมล (anonymous / custom token)
    env.authenticatedContext("stranger-6", { email_verified: true, name: "admin@hueanyong.local" }).firestore(),
  ];
  for (const [i, db] of strangers.entries()) {
    const who = `stranger-${i + 1}`;
    const orders = collection(db, "orders");
    // ออเดอร์: อ่านไม่ได้เลย แก้ไม่ได้
    await assertFails(getDocs(query(orders, where("status", "in", ACTIVE), limit(300))), who);
    await assertFails(getDocs(query(orders, where("tableNumber", "==", "1-2"), where("status", "in", ACTIVE))));
    await assertFails(getDoc(doc(db, "orders", "a1")));
    await assertFails(getDoc(doc(db, "orders", "paid-today")));
    await assertFails(getDocs(historyQuery(db)));
    await assertFails(updateDoc(doc(db, "orders", "a1"), { status: "awaiting-payment" }));
    await assertFails(updateDoc(doc(db, "orders", "a1"), { status: "cancelled", cancelledAt: new Date() }));
    await assertFails(updateDoc(doc(db, "orders", "a2"), { status: "paid", paymentMethod: "cash" }));
    await assertFails(updateDoc(doc(db, "orders", "a1"), { tableNumber: "2-9" }));
    await assertFails(deleteDoc(doc(db, "orders", "a1")));
    await assertFails(addDoc(orders, order("1-1", "paid", [], { backfilled: true, createdAt: at(1) })));
    await assertFails(runTransaction(db, async (tx) => { await tx.get(doc(db, "orders", "a1")); }));
    // เมนู / สต็อก / สถานะร้าน: เขียนไม่ได้
    await assertFails(updateDoc(doc(db, "menuItems", "rice"), { price: 1 }));
    await assertFails(setDoc(doc(db, "menuItems", "new"), { price: 1 }));
    await assertFails(deleteDoc(doc(db, "menuItems", "rice")));
    await assertFails(setDoc(doc(db, "categories", "x"), { nameTh: "x", order: 9 }));
    await assertFails(setDoc(doc(db, "stock", "rice"), { remaining: 999 }));
    await assertFails(deleteDoc(doc(db, "stock", "rice")));
    await assertFails(setDoc(doc(db, "status", "live"), { busyTables: 99, busyItems: 99 }));
    await assertFails(setDoc(doc(db, "status", "qrConfig"), { legacyTableUrl: true }, { merge: true }));
    await assertFails(setDoc(doc(db, "status", "printRouting"), { food: "counter" }, { merge: true }));
    await assertFails(setDoc(doc(db, "status", "receipt"), { footer: "x" }, { merge: true }));
    await assertFails(setDoc(doc(db, "status", "tableClosures"), { closedAt: {} }, { merge: true }));
    // ลิงก์โต๊ะ: ไล่ดูรหัส/สร้าง/แก้/ลบไม่ได้
    await assertFails(getDocs(collection(db, "tableViews")));
    await assertFails(setDoc(doc(db, "tableViews", "EVIL"), { table: "1-2", version: 1, data: "{}", hash: "h" }));
    await assertFails(updateDoc(doc(db, "tableViews", "TOKEN-1-2"), { data: "{}" }));
    await assertFails(deleteDoc(doc(db, "tableViews", "TOKEN-1-2")));
    // ตัวนับ / เครื่องพิมพ์ / เหตุผลยกเลิก / log / สถิติ / รายจ่าย
    await assertFails(getDoc(doc(db, "counters", "takeaway-2026-11-12")));
    await assertFails(setDoc(doc(db, "counters", "tableLinkLock"), { seq: 1 }));
    await assertFails(setDoc(doc(db, "counters", "table-moves"), { lastMoveId: "x" }));
    await assertFails(getDocs(collection(db, "printers")));
    await assertFails(setDoc(doc(db, "printers", "AA:BB:CC:DD:EE:FF"), { name: "x", address: "AA:BB:CC:DD:EE:FF" }));
    await assertFails(getDoc(doc(db, "voidReasons", "list")));
    await assertFails(setDoc(doc(db, "voidReasons", "list"), { reasons: ["x"] }));
    await assertFails(addDoc(collection(db, "activityLogs"), { action: "x", createdAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db, "activityLogs", "log1")));
    await assertFails(getDoc(doc(db, "dailyStats", "2026-10-01")));
    await assertFails(setDoc(doc(db, "dailyStats", "2026-10-02"), { total: 1 }));
    await assertFails(getDoc(doc(db, "expenses", "2026-10-01")));
    await assertFails(setDoc(doc(db, "expenses", "2026-10-03"), { date: "2026-10-03", items: [] }));
    await assertFails(getDocs(collection(db, "expenseItems")));
    // สิ่งที่ลูกค้าทำได้ ยังทำได้เท่าลูกค้า (ไม่มากกว่า): อ่านเมนู/สถานะ, เปิดลิงก์โต๊ะที่รู้รหัส, สั่งอาหาร
    await assertSucceeds(getDocs(collection(db, "menuItems")));
    await assertSucceeds(getDoc(doc(db, "status", "qrConfig")));
    await assertSucceeds(getDoc(doc(db, "tableViews", "TOKEN-1-2")));
    await assertSucceeds(setDoc(doc(db, "orders", `from-${who}`), order("1-2", "in-progress", [line("rice", 50, 1)], { createdAt: serverTimestamp() })));
    await assertFails(getDoc(doc(db, "orders", `from-${who}`)));
  }
  // บัญชีของร้านสองบัญชียังผ่านตามเดิม
  await assertSucceeds(getDocs(query(collection(staff(), "orders"), where("status", "in", ACTIVE), limit(300))));
  await assertSucceeds(getDocs(query(collection(owner(), "orders"), where("status", "in", ACTIVE), limit(300))));
});
