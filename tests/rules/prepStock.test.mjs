// ของเตรียม (สต็อกร่วมหลายเมนู) — logic ล้วนใน src/app/prep.ts + stock.ts และการตัดจริงผ่าน stockStore กับ emulator + firestore.rules
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp, writeBatch } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { createOrderTakingStock, runStockTransaction, StockShortError } from "../../src/app/stockStore";
import { stockNeeds } from "../../src/app/stock";
import {
  buildStockAlerts, guestStockDocIds, isPrepId, prepIsOut, prepSoldOutChanges, prepTrackedFor, staffStockDocIds,
} from "../../src/app/prep";

const menu = (id, extra = {}) => ({ id, categoryId: "c", name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price: 50, ...extra });
const line = (item, quantity, extra = {}) => ({ cartId: `${item.id}-${quantity}-${Math.random()}`, item, quantity, spiceLevel: 0, ...extra });

// ─── logic ล้วน ───

test("guestStockDocIds: own stock + linked preps only when tracked", () => {
  assert.deepEqual(guestStockDocIds(menu("a")), []);
  assert.deepEqual(guestStockDocIds(menu("a", { stockTracked: true })), ["a"]);
  assert.deepEqual(guestStockDocIds(menu("a", { prepIds: ["prep_x"], prepTracked: false })), [], "stock system off → no prep take");
  assert.deepEqual(guestStockDocIds(menu("a", { stockTracked: true, prepIds: ["prep_x", "prep_y"], prepTracked: true })), ["a", "prep_x", "prep_y"]);
  assert.deepEqual(guestStockDocIds(undefined), []);
});

test("staffStockDocIds: skips unlimited preps and everything when the system is off", () => {
  const stockMap = new Map([["a", { remaining: 3 }]]);
  const prepMap = new Map([["prep_x", { name: "X", remaining: 2 }], ["prep_u", { name: "U" }]]);
  const m = menu("a", { prepIds: ["prep_x", "prep_u", "prep_gone"] });
  assert.deepEqual(staffStockDocIds(m, "a", true, stockMap, prepMap), ["a", "prep_x"]);
  assert.deepEqual(staffStockDocIds(m, "a", false, stockMap, prepMap), []);
  assert.deepEqual(staffStockDocIds(menu("b"), "b", true, stockMap, prepMap), []);
});

test("stockNeeds: two menus sharing one prep add up; voided lines don't count", () => {
  const larbA = menu("larbA", { prepIds: ["prep_larb"], prepTracked: true });
  const larbB = menu("larbB", { prepIds: ["prep_larb"], prepTracked: true, stockTracked: true });
  const plain = menu("plain");
  const byId = new Map([larbA, larbB, plain].map((m) => [m.id, m]));
  const needs = stockNeeds(
    [line(larbA, 1), line(larbB, 2), line(plain, 5), line(larbA, 3, { voided: true })],
    (id) => guestStockDocIds(byId.get(id)),
  );
  assert.deepEqual([...needs].sort(), [["larbB", 2], ["prep_larb", 3]]);
});

test("stockNeeds: a menu listing the same prep twice takes it once per plate", () => {
  const m = menu("m", { prepIds: ["prep_x", "prep_x"], prepTracked: true });
  assert.deepEqual([...stockNeeds([line(m, 2)], () => guestStockDocIds(m))], [["prep_x", 2]]);
});

test("prepIsOut / isPrepId / prepTrackedFor", () => {
  assert.equal(prepIsOut({ name: "x", remaining: 0 }), true);
  assert.equal(prepIsOut({ name: "x", remaining: -2 }), true);
  assert.equal(prepIsOut({ name: "x", remaining: 1 }), false);
  assert.equal(prepIsOut({ name: "x" }), false, "unlimited");
  assert.equal(prepIsOut(undefined), false, "deleted");
  assert.equal(isPrepId("prep_abc"), true);
  assert.equal(isPrepId("padthai"), false);
  assert.equal(prepTrackedFor(true, ["prep_x"]), true);
  assert.equal(prepTrackedFor(false, ["prep_x"]), false);
  assert.equal(prepTrackedFor(true, []), false);
  assert.equal(prepTrackedFor(true, undefined), false);
});

test("prepSoldOutChanges: prep at 0 closes every linked menu that is still on sale", () => {
  const prepMap = new Map([["prep_x", { name: "X", remaining: 0 }]]);
  const menus = [
    menu("a", { prepIds: ["prep_x"] }),
    menu("b", { prepIds: ["prep_x"], soldOut: true }),           // already sold out → leave it (no flag)
    menu("c", { prepIds: ["prep_x"], active: false }),           // hidden → leave it
    menu("d"),                                                    // not linked
  ];
  assert.deepEqual(prepSoldOutChanges(menus, new Map(), prepMap), { close: ["a"], reopen: [] });
});

test("prepSoldOutChanges: refill reopens only menus closed by the prep", () => {
  const prepMap = new Map([["prep_x", { name: "X", remaining: 5 }]]);
  const menus = [
    menu("auto", { prepIds: ["prep_x"], soldOut: true, soldOutByPrep: true }),
    menu("manual", { prepIds: ["prep_x"], soldOut: true }),      // staff pressed หมด themselves → stays sold out
    menu("ownOut", { prepIds: ["prep_x"], soldOut: true, soldOutByPrep: true }), // own stock still 0
  ];
  const stockMap = new Map([["ownOut", { remaining: 0 }]]);
  assert.deepEqual(prepSoldOutChanges(menus, stockMap, prepMap), { close: [], reopen: ["auto"] });
});

test("prepSoldOutChanges: one of two linked preps still out keeps the menu closed", () => {
  const prepMap = new Map([["prep_x", { name: "X", remaining: 5 }], ["prep_y", { name: "Y", remaining: 0 }]]);
  const m = menu("a", { prepIds: ["prep_x", "prep_y"], soldOut: true, soldOutByPrep: true });
  assert.deepEqual(prepSoldOutChanges([m], new Map(), prepMap), { close: [], reopen: [] });
});

test("prepSoldOutChanges: prep made unlimited / deleted / unlinked → flagged menu reopens", () => {
  const flagged = (prepIds) => menu("a", { prepIds, soldOut: true, soldOutByPrep: true });
  assert.deepEqual(prepSoldOutChanges([flagged(["prep_x"])], new Map(), new Map([["prep_x", { name: "X" }]])).reopen, ["a"]);
  assert.deepEqual(prepSoldOutChanges([flagged(["prep_x"])], new Map(), new Map()).reopen, ["a"]);
  assert.deepEqual(prepSoldOutChanges([flagged(undefined)], new Map(), new Map()).reopen, ["a"]);
});

test("buildStockAlerts: sold out (menu stock or prep at ≤ 0) apart from running low; manual sold-out not listed", () => {
  const menus = [
    menu("soup", { stockTracked: true, soldOut: true }),
    menu("rice", { stockTracked: true }),
    menu("manual", { soldOut: true }),                           // pressed หมด by hand, no stock → not listed
    menu("hiddenOut", { stockTracked: true, active: false }),
    menu("a", { prepIds: ["prep_x"] }), menu("b", { prepIds: ["prep_x"] }),
    menu("c", { prepIds: ["prep_low"] }),
  ];
  const stockMap = new Map([
    ["soup", { remaining: 0 }], ["rice", { remaining: 2, alertAt: 3 }], ["hiddenOut", { remaining: 0 }], ["deleted", { remaining: 0 }],
  ]);
  const prepMap = new Map([
    ["prep_x", { name: "X", remaining: -1 }], ["prep_low", { name: "L", remaining: 1, alertAt: 1 }],
    ["prep_free", { name: "F" }], ["prep_unused", { name: "U", remaining: 0 }],
  ]);
  const { out, low } = buildStockAlerts(true, menus, stockMap, prepMap, (m) => m.name.th);
  assert.deepEqual(out, [{ id: "soup", name: "soup", remaining: 0 }, { id: "prep_x", name: "X", remaining: -1, menuCount: 2 }]
    .sort((p, q) => p.name.localeCompare(q.name, "th")));
  assert.deepEqual(low, [{ id: "prep_low", name: "L", remaining: 1, menuCount: 1 }, { id: "rice", name: "rice", remaining: 2 }]);
  assert.deepEqual(buildStockAlerts(false, menus, stockMap, prepMap, (m) => m.name.th), { out: [], low: [] }, "stock switch off → no bar");
});

// ─── emulator: ตัดของเตรียมจริงด้วย firestore.rules ของจริง (ไม่แตะ production) ───

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
    await setDoc(doc(db, "stock", "prep_larb"), { kind: "prep", name: "ลาบ", remaining: 1, alertAt: 2 });
    await setDoc(doc(db, "stock", "prep_free"), { kind: "prep", name: "ไม่จำกัด" });
    await setDoc(doc(db, "stock", "padthai"), { remaining: 5 });
    await setDoc(doc(db, "menuItems", "padthai"), { price: 60, stockTracked: true, prepIds: ["prep_larb"], prepTracked: true, soldOut: false });
  });
});

const read = async (path) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
};
const orderData = () => ({ tableNumber: "1-2", items: [], status: "in-progress", createdAt: serverTimestamp() });
let guestDb;
beforeEach(() => { guestDb = undefined; });
const guestOrder = (id, needs) => {
  if (!guestDb) guestDb = env.unauthenticatedContext().firestore();
  const db = guestDb;
  setTestDb(db);
  return runStockTransaction((tx) => createOrderTakingStock(tx, { orderRef: doc(db, "orders", id), orderData: orderData(), needs, guest: true }));
};

test("guest takes menu stock + prep in one order; last prep → 0", async () => {
  const r = await guestOrder("o1", new Map([["padthai", 1], ["prep_larb", 1]]));
  assert.deepEqual(r.soldOutIds, ["prep_larb"]);
  assert.equal((await read("stock/prep_larb")).remaining, 0);
  assert.equal((await read("stock/prep_larb")).name, "ลาบ", "name untouched");
  assert.equal((await read("stock/padthai")).remaining, 4);
  assert.equal((await read("orders/o1")).status, "in-progress");
});

test("two menus sharing a prep with 1 left → whole order refused, nothing taken", async () => {
  await assert.rejects(guestOrder("o2", new Map([["padthai", 2], ["prep_larb", 2]])),
    (e) => e instanceof StockShortError && e.shortIds.join() === "prep_larb" && e.current.get("prep_larb") === 1);
  assert.equal(await read("orders/o2"), undefined);
  assert.equal((await read("stock/prep_larb")).remaining, 1);
  assert.equal((await read("stock/padthai")).remaining, 5);
});

test("unlimited prep (no remaining) → order goes through, prep doc untouched", async () => {
  await guestOrder("o3", new Map([["prep_free", 3]]));
  assert.equal((await read("orders/o3")).status, "in-progress");
  assert.deepEqual(await read("stock/prep_free"), { kind: "prep", name: "ไม่จำกัด" });
});

test("two guests race for the last prep → exactly one wins", async () => {
  const results = await Promise.allSettled([
    guestOrder("a1", new Map([["prep_larb", 1]])),
    guestOrder("b1", new Map([["prep_larb", 1]])),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof StockShortError).length, 1);
  assert.equal((await read("stock/prep_larb")).remaining, 0);
});

test("staff order taking the last prep does not write soldOut itself (effect sets it with the prep flag)", async () => {
  const db = env.authenticatedContext("staff").firestore();
  setTestDb(db);
  await runTransaction(db, (tx) => createOrderTakingStock(tx, {
    orderRef: doc(db, "orders", "s1"), orderData: orderData(), needs: new Map([["prep_larb", 1]]), guest: false,
  }));
  assert.equal((await read("stock/prep_larb")).remaining, 0);
  assert.equal((await read("menuItems/padthai")).soldOut, false);
});

test("rules: guest can't rename / refill / create / delete a prep", async () => {
  const db = env.unauthenticatedContext().firestore();
  const b = writeBatch(db);
  b.set(doc(db, "orders", "o9"), orderData());
  b.update(doc(db, "stock", "prep_larb"), { remaining: 0, lastOrderId: "o9", name: "hacked" });
  await assertFails(b.commit());
  await assertFails(updateDoc(doc(db, "stock", "prep_larb"), { remaining: 50 }));
  await assertFails(setDoc(doc(db, "stock", "prep_new"), { kind: "prep", name: "x", remaining: 5 }));
  const b2 = writeBatch(db);
  b2.set(doc(db, "orders", "o10"), orderData());
  b2.update(doc(db, "stock", "prep_free"), { remaining: 0, lastOrderId: "o10" });
  await assertFails(b2.commit(), "unlimited prep can't be turned into a number by a guest");
});

test("rules: staff can create, set unlimited, and delete a prep", async () => {
  const { deleteField, deleteDoc, increment } = await import("firebase/firestore");
  const db = env.authenticatedContext("staff").firestore();
  await assertSucceeds(setDoc(doc(db, "stock", "prep_new"), { kind: "prep", name: "ใหม่", remaining: 5 }));
  await assertSucceeds(updateDoc(doc(db, "stock", "prep_new"), { remaining: increment(-1) }));
  await assertSucceeds(updateDoc(doc(db, "stock", "prep_new"), { remaining: deleteField(), alertAt: deleteField() }));
  await assertSucceeds(deleteDoc(doc(db, "stock", "prep_new")));
});
