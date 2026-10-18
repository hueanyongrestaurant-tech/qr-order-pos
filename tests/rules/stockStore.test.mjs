// ทดสอบโค้ดจริงใน src/app/stockStore.ts กับ emulator + firestore.rules ของจริง (ไม่แตะ production)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { createOrderTakingStock, readStockForOrderChange, runStockTransaction, writeStockForOrderChange, StockShortError } from "../../src/app/stockStore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "stock", "padthai"), { remaining: 1, alertAt: 2 });
    await setDoc(doc(db, "stock", "somtam"), { remaining: 10 });
    await setDoc(doc(db, "menuItems", "padthai"), { price: 60, stockTracked: true, soldOut: false });
  });
});

// withSecurityRulesDisabled ไม่คืนค่าจาก callback — เก็บผลผ่านตัวแปรแทน
const read = async (path) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
};
const orderData = (table = "1-2") => ({ tableNumber: table, items: [], status: "in-progress", createdAt: serverTimestamp() });
const staffDb = () => { const db = env.authenticatedContext("staff").firestore(); setTestDb(db); return db; };

// db ของลูกค้าหนึ่ง instance ต่อ test (stockStore ใช้ db จาก shim — สร้างใหม่ทุกครั้งจะได้ ref คนละ instance กับ transaction)
let guestDb;
beforeEach(() => { guestDb = undefined; });
const guestOrder = (id, needs) => {
  if (!guestDb) { guestDb = env.unauthenticatedContext().firestore(); }
  const db = guestDb;
  setTestDb(db);
  return runStockTransaction((tx) => createOrderTakingStock(tx, { orderRef: doc(db, "orders", id), orderData: orderData(), needs, guest: true }));
};

test("guest takes the last one → 0, order has stockItemIds", async () => {
  const r = await guestOrder("o1", new Map([["padthai", 1], ["somtam", 2]]));
  assert.deepEqual(r.soldOutIds, ["padthai"]);
  assert.equal((await read("stock/padthai")).remaining, 0);
  assert.equal((await read("stock/somtam")).remaining, 8);
  assert.deepEqual((await read("orders/o1")).stockItemIds, ["padthai", "somtam"]);
});

test("two guests order the last one at the same time → exactly one wins", async () => {
  const results = await Promise.allSettled([
    guestOrder("a1", new Map([["padthai", 1]])),
    guestOrder("b1", new Map([["padthai", 1]])),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status === "rejected" ? String(r.reason) : "ok")));
  assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof StockShortError).length, 1,
    JSON.stringify(results.map((r) => r.status === "rejected" ? `${r.reason?.code} ${r.reason?.message}` : "ok")));
  assert.equal((await read("stock/padthai")).remaining, 0);
  assert.equal([await read("orders/a1"), await read("orders/b1")].filter(Boolean).length, 1, "only one order was created");
});

test("five guests race for 3 left → exactly 3 orders, stock 0, never negative", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "stock", "somtam"), { remaining: 3 }));
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => guestOrder(`r${i}`, new Map([["somtam", 1]]))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3,
    JSON.stringify(results.map((r) => r.status === "rejected" ? `${r.reason?.code} ${r.reason?.message}` : "ok")));
  assert.equal((await read("stock/somtam")).remaining, 0);
});

test("not enough → StockShortError, no order, stock unchanged", async () => {
  await assert.rejects(guestOrder("o2", new Map([["padthai", 2]])),
    (e) => e instanceof StockShortError && e.shortIds[0] === "padthai" && e.current.get("padthai") === 1);
  assert.equal(await read("orders/o2"), undefined);
  assert.equal((await read("stock/padthai")).remaining, 1);
});

test("re-sending the same order id after success is rejected (no double take)", async () => {
  await guestOrder("o3", new Map([["somtam", 1]]));
  await assert.rejects(guestOrder("o3", new Map([["somtam", 1]])), (e) => e.code === "permission-denied");
  assert.equal((await read("stock/somtam")).remaining, 9);
});

test("stock doc deleted meanwhile (unlimited) → order goes through without stockItemIds", async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "stock", "padthai")));
  await guestOrder("o4", new Map([["padthai", 5]]));
  assert.equal((await read("orders/o4")).stockItemIds, undefined);
});

test("staff order taking the last one marks the menu sold out in the same commit", async () => {
  const db = staffDb();
  await runTransaction(db, (tx) => createOrderTakingStock(tx, { orderRef: doc(db, "orders", "s1"), orderData: orderData(), needs: new Map([["padthai", 1]]), guest: false }));
  assert.equal((await read("menuItems/padthai")).soldOut, true);
  assert.equal((await read("stock/padthai")).remaining, 0);
});

test("staff takeaway: queue counter read+write via prepare in the same transaction", async () => {
  const db = staffDb();
  const counterRef = doc(db, "counters", "takeaway-test");
  await runTransaction(db, (tx) => createOrderTakingStock(tx, {
    orderRef: doc(db, "orders", "t1"), orderData: { ...orderData("0"), isTakeaway: true }, needs: new Map([["somtam", 1]]), guest: false,
    prepare: async (t) => {
      const s = await t.get(counterRef);
      const next = (s.exists() ? s.data().count : 0) + 1;
      return { fields: { takeawayLabel: `T-${next}` }, write: () => t.set(counterRef, { count: next }) };
    },
  }));
  assert.equal((await read("orders/t1")).takeawayLabel, "T-1");
  assert.equal((await read("counters/takeaway-test")).count, 1);
});

test("staff void / restore: only items in stockItemIds, restore may go negative, guests then refused", async () => {
  await guestOrder("o5", new Map([["padthai", 1]]));
  const db = staffDb();
  await runTransaction(db, async (tx) => {
    const raw = (await tx.get(doc(db, "orders", "o5"))).data();
    const next = await readStockForOrderChange(tx, raw.stockItemIds, new Map([["padthai", 1], ["somtam", 4]]));
    assert.deepEqual([...next], [["padthai", 1]]);
    writeStockForOrderChange(tx, next);
  });
  assert.equal((await read("stock/padthai")).remaining, 1);
  assert.equal((await read("stock/somtam")).remaining, 10);
  await runTransaction(db, async (tx) => {
    const raw = (await tx.get(doc(db, "orders", "o5"))).data();
    writeStockForOrderChange(tx, await readStockForOrderChange(tx, raw.stockItemIds, new Map([["padthai", -3]])));
  });
  assert.equal((await read("stock/padthai")).remaining, -2);
  await assert.rejects(guestOrder("o6", new Map([["padthai", 1]])), (e) => e instanceof StockShortError);
});

test("order without stockItemIds (older order / backfill) → stock untouched", async () => {
  const db = staffDb();
  await runTransaction(db, async (tx) => {
    const next = await readStockForOrderChange(tx, undefined, new Map([["padthai", 1]]));
    assert.equal(next.size, 0);
    writeStockForOrderChange(tx, next);
  });
  assert.equal((await read("stock/padthai")).remaining, 1);
});

test("10 guests order a busy item at once (plenty left) → all 10 succeed, stock exact", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "stock", "somtam"), { remaining: 100 }));
  const results = await Promise.allSettled([...Array(10).keys()].map((i) => guestOrder(`p${i}`, new Map([["somtam", 2]]))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 10,
    JSON.stringify(results.map((r) => r.status === "rejected" ? `${r.reason?.code}` : "ok")));
  assert.equal((await read("stock/somtam")).remaining, 80);
});
