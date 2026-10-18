// Firestore rules tests — รันกับ emulator (ไม่แตะ production):  cd tests/rules && npm install && npm test
// ต้องมี Java 21+ (ใช้ jbr ของ Android Studio ได้: ตั้ง JAVA_HOME="C:\Program Files\Android\Android Studio\jbr")
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, increment, serverTimestamp, runTransaction, Timestamp } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "stock", "padthai"), { remaining: 3, alertAt: 2 });
    await setDoc(doc(db, "stock", "somtam"), { remaining: 10 });
    await setDoc(doc(db, "menuItems", "padthai"), { price: 60, stockTracked: true });
    await setDoc(doc(db, "orders", "existing"), { tableNumber: "1-2", status: "in-progress", items: [] });
  });
});

const guest = () => env.unauthenticatedContext().firestore();
const staff = () => env.authenticatedContext("staff").firestore();
const order = (extra = {}) => ({ tableNumber: "1-2", status: "in-progress", items: [], createdAt: serverTimestamp(), ...extra });

// ─── ออเดอร์ที่ไม่มีเมนูติดสต็อก: ต้องเหมือนเดิมทุกอย่าง ───
test("guest: plain order create still works (no stock)", async () => {
  await assertSucceeds(setDoc(doc(guest(), "orders", "o1"), order()));
});
test("guest: plain order with stockItemIds field still works", async () => {
  await assertSucceeds(setDoc(doc(guest(), "orders", "o1"), order({ stockItemIds: ["padthai"] })));
});
test("guest: order with bad status still denied", async () => {
  await assertFails(setDoc(doc(guest(), "orders", "o1"), order({ status: "paid" })));
});
test("guest: re-sending same order id is denied (retry = already sent)", async () => {
  await assertFails(setDoc(doc(guest(), "orders", "existing"), order()));
});

// ─── ลูกค้าตัดสต็อกพร้อมสร้างออเดอร์ ───
test("guest: batch order + stock decrement succeeds", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order({ stockItemIds: ["padthai", "somtam"] }));
  b.update(doc(db, "stock", "padthai"), { remaining: 1, lastOrderId: "o1" });
  b.update(doc(db, "stock", "somtam"), { remaining: 9, lastOrderId: "o1" });
  await assertSucceeds(b.commit());
});
test("guest: transaction (read stock → write) succeeds, can take the last one to 0", async () => {
  const db = guest();
  await assertSucceeds(runTransaction(db, async (tx) => {
    const s = await tx.get(doc(db, "stock", "padthai"));
    tx.set(doc(db, "orders", "o1"), order());
    tx.update(doc(db, "stock", "padthai"), { remaining: s.data().remaining - 3, lastOrderId: "o1" });
  }));
});
test("guest: can read stock doc", async () => {
  await assertSucceeds(getDoc(doc(guest(), "stock", "padthai")));
});
test("guest: decrement without creating an order is denied", async () => {
  await assertFails(updateDoc(doc(guest(), "stock", "padthai"), { remaining: 2, lastOrderId: "nope" }));
});
test("guest: decrement tied to an EXISTING order is denied", async () => {
  await assertFails(updateDoc(doc(guest(), "stock", "padthai"), { remaining: 2, lastOrderId: "existing" }));
});
test("guest: decrement below zero is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "padthai"), { remaining: -1, lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: increase is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "padthai"), { remaining: 99, lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: same value (no decrement) is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "padthai"), { remaining: 3, lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: decrement more than 50 at once is denied", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "stock", "big"), { remaining: 100 }));
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "big"), { remaining: 49, lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: changing alertAt is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "padthai"), { remaining: 2, lastOrderId: "o1", alertAt: 0 });
  await assertFails(b.commit());
});
test("guest: non-integer remaining is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "padthai"), { remaining: 1.5, lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: increment() sentinel is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  b.update(doc(db, "stock", "padthai"), { remaining: increment(5), lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: create / delete / set-overwrite stock denied", async () => {
  await assertFails(setDoc(doc(guest(), "stock", "newone"), { remaining: 5 }));
  await assertFails(deleteDoc(doc(guest(), "stock", "padthai")));
  await assertFails(setDoc(doc(guest(), "stock", "padthai"), { remaining: 0 }));
});
test("guest: tying decrement to a backfill-style paid order is denied", async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order({ status: "paid", backfilled: true, createdAt: Timestamp.now() }));
  b.update(doc(db, "stock", "padthai"), { remaining: 2, lastOrderId: "o1" });
  await assertFails(b.commit());
});
test("guest: still cannot write menuItems (soldOut stays staff-only)", async () => {
  await assertFails(updateDoc(doc(guest(), "menuItems", "padthai"), { soldOut: true }));
});
test("guest: big order touching 20 stocked items in one commit succeeds", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (let i = 0; i < 20; i++) await setDoc(doc(ctx.firestore(), "stock", `m${i}`), { remaining: 5 });
  });
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o1"), order());
  for (let i = 0; i < 20; i++) b.update(doc(db, "stock", `m${i}`), { remaining: 4, lastOrderId: "o1" });
  await assertSucceeds(b.commit());
});

// ─── พนักงาน ───
test("staff: create / set / increment / negative / delete stock", async () => {
  const db = staff();
  await assertSucceeds(setDoc(doc(db, "stock", "newone"), { remaining: 5, alertAt: 1 }));
  await assertSucceeds(updateDoc(doc(db, "stock", "newone"), { remaining: increment(2) }));
  await assertSucceeds(updateDoc(doc(db, "stock", "newone"), { remaining: -1 }));
  await assertSucceeds(deleteDoc(doc(db, "stock", "newone")));
});
test("staff: manual order + decrement + soldOut in one transaction", async () => {
  const db = staff();
  await assertSucceeds(runTransaction(db, async (tx) => {
    await tx.get(doc(db, "stock", "padthai"));
    tx.set(doc(db, "orders", "s1"), order({ stockItemIds: ["padthai"] }));
    tx.update(doc(db, "stock", "padthai"), { remaining: 0, lastOrderId: "s1" });
    tx.update(doc(db, "menuItems", "padthai"), { soldOut: true });
  }));
});
