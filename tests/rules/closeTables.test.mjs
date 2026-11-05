// ปิดบิล / รวมโต๊ะ (src/app/staff/closeTables.ts) กับ emulator + firestore.rules ของจริง (ไม่แตะ production)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { CloseTableError, closeTablesTx } from "../../src/app/staff/closeTables";
import { planTablesClose } from "../../src/app/tableSession";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { await env?.cleanup(); });

const menu = (id, price) => ({ id, categoryId: "food", name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price, hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false, customGroups: [] });
const line = (id, price, quantity) => ({ cartId: `${id}-${quantity}`, item: menu(id, price), quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} });
const order = (table, status, minute, items) => ({ tableNumber: table, status, items, createdAt: Timestamp.fromMillis(Date.UTC(2026, 10, 5, 5, minute)) });

// โต๊ะ 1-2: 2 รอบ (100 + 50) | โต๊ะ 1-3: 1 รอบ (80) | 2-1 ไม่เกี่ยว | paid เก่าของ 1-3
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "orders", "a1"), order("1-2", "awaiting-payment", 0, [line("rice", 50, 2)]));
    await setDoc(doc(db, "orders", "a2"), order("1-2", "awaiting-payment", 20, [line("tea", 25, 2)]));
    await setDoc(doc(db, "orders", "b1"), order("1-3", "awaiting-payment", 10, [line("soup", 80, 1)]));
    await setDoc(doc(db, "orders", "c1"), order("2-1", "awaiting-payment", 5, [line("rice", 50, 1)]));
    await setDoc(doc(db, "orders", "old"), { ...order("1-3", "paid", 0, [line("rice", 50, 1)]), paymentBatchId: "old-batch", paymentMethod: "cash" });
  });
});

const read = async (path) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
};
const asStaff = () => setTestDb(env.authenticatedContext("staff").firestore());
const expected = {
  "1-2": { orderIds: ["a1", "a2"], total: 150 },
  "1-3": { orderIds: ["b1"], total: 80 },
};
const untouched = async (...ids) => {
  for (const id of ids) {
    const d = await read(`orders/${id}`);
    assert.equal(d.status, "awaiting-payment", id);
    assert.equal(d.paymentBatchId, undefined, id);
  }
};

test("combine 1-2 + 1-3: every order of both tables paid with ONE paymentBatchId, closures for both", async () => {
  asStaff();
  const res = await closeTablesTx(["1-2", "1-3"], { method: "cash", cashReceived: 300 }, expected);
  assert.deepEqual(res.orderIds, ["a1", "b1", "a2"]); // เรียงเก่า→ใหม่ข้ามโต๊ะ
  for (const id of ["a1", "a2", "b1"]) {
    const d = await read(`orders/${id}`);
    assert.equal(d.status, "paid");
    assert.equal(d.paymentBatchId, res.batchId);
    assert.equal(d.paymentMethod, "cash");
    assert.equal(d.cashReceived, 300);
    assert.ok(d.paidAt);
  }
  await untouched("c1");
  assert.equal((await read("orders/old")).paymentBatchId, "old-batch"); // บิลเก่าที่จ่ายแล้วไม่ถูกแตะ
  const closures = (await read("status/tableClosures")).closedAt;
  assert.ok(closures["1-2"] && closures["1-3"]);
  assert.equal(closures["2-1"], undefined);
});

test("combine with cash + transfer: transfer spread oldest-first across both tables, sums to the bill's transfer", async () => {
  asStaff();
  await closeTablesTx(["1-3", "1-2"], { method: "split", transferAmount: 120, cashReceived: 200 }, expected);
  const t = {};
  for (const id of ["a1", "a2", "b1"]) t[id] = (await read(`orders/${id}`)).transferAmount;
  assert.deepEqual(t, { a1: 100, b1: 20, a2: 0 });
});

test("a ticked table still has an unserved round → nothing closed on ANY table", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "orders", "b2"), order("1-3", "in-progress", 30, [line("tea", 25, 1)])));
  asStaff();
  await assert.rejects(closeTablesTx(["1-2", "1-3"], { method: "transfer" }, expected), (e) => e instanceof CloseTableError && e.code === "pending" && e.table === "1-3");
  await untouched("a1", "a2", "b1");
  assert.equal(await read("status/tableClosures"), undefined);
});

test("a ticked table's bill changed since the screen showed it → 'changed', nothing written", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "orders", "b2"), order("1-3", "awaiting-payment", 30, [line("tea", 25, 1)])));
  asStaff();
  await assert.rejects(closeTablesTx(["1-2", "1-3"], { method: "transfer" }, expected), (e) => e instanceof CloseTableError && e.code === "changed" && e.table === "1-3");
  await untouched("a1", "a2", "b1", "b2");
});

test("one table was already paid on another device → 'nothing', the other table stays open (no reopening paid bills)", async () => {
  asStaff();
  await closeTablesTx(["1-3"], { method: "transfer" }, { "1-3": expected["1-3"] });
  const firstBatch = (await read("orders/b1")).paymentBatchId;
  await assert.rejects(closeTablesTx(["1-2", "1-3"], { method: "cash", cashReceived: 500 }, expected), (e) => e instanceof CloseTableError && e.code === "nothing" && e.table === "1-3");
  await untouched("a1", "a2");
  const b1 = await read("orders/b1");
  assert.equal(b1.paymentBatchId, firstBatch);
  assert.equal(b1.paymentMethod, "transfer");
});

test("two devices close the same combined bill at once → exactly one wins, one batch id", async () => {
  const a = env.authenticatedContext("staff").firestore();
  const b = env.authenticatedContext("staff").firestore();
  setTestDb(a);
  const p1 = closeTablesTx(["1-2", "1-3"], { method: "transfer" }, expected);
  setTestDb(b);
  const p2 = closeTablesTx(["1-2", "1-3"], { method: "transfer" }, expected);
  const results = await Promise.allSettled([p1, p2]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status === "rejected" ? String(r.reason) : "ok")));
  const batches = new Set();
  for (const id of ["a1", "a2", "b1"]) batches.add((await read(`orders/${id}`)).paymentBatchId);
  assert.equal(batches.size, 1);
});

test("single table close still works the same way", async () => {
  asStaff();
  const res = await closeTablesTx(["2-1"], { method: "transfer" }, { "2-1": { orderIds: ["c1"], total: 50 } });
  assert.deepEqual(res.orderIds, ["c1"]);
  assert.equal((await read("orders/c1")).paymentBatchId, res.batchId);
  await untouched("a1", "a2", "b1");
});

test("guest (not logged in) cannot close tables", async () => {
  setTestDb(env.unauthenticatedContext().firestore());
  await assert.rejects(closeTablesTx(["1-2", "1-3"], { method: "transfer" }, expected));
  await untouched("a1", "a2", "b1");
});

test("planTablesClose: duplicate tables ignored, first failing table reported", () => {
  const docs = [
    { id: "x", tableNumber: "1-1", status: "awaiting-payment", createdAtMs: 2, total: 10 },
    { id: "y", tableNumber: "1-4", status: "awaiting-payment", createdAtMs: 1, total: 5 },
  ];
  const exp = { "1-1": { orderIds: ["x"], total: 10 }, "1-4": { orderIds: ["y"], total: 5 } };
  const ok = planTablesClose(["1-1", "1-4", "1-1"], docs, exp);
  assert.equal(ok.kind, "ok");
  assert.deepEqual(ok.toClose.map((d) => d.id), ["y", "x"]);
  assert.deepEqual(planTablesClose(["1-1", "1-5"], docs, exp), { kind: "nothing", table: "1-5" });
  assert.deepEqual(planTablesClose([], docs, exp), { kind: "nothing", table: "" });
});
