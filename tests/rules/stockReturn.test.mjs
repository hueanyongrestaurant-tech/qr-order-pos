// คืนสต็อกตอนยกเลิก/ลดจำนวน/ยกเลิกทั้งใบ + ตัดกลับตอนคืนรายการ — โค้ดจริงใน src/app/orderStockStore.ts + stockReturn.ts
// กับ emulator + firestore.rules ของจริง (ไม่แตะ production)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { createOrderTakingStock, runStockTransaction } from "../../src/app/stockStore";
import { stockNeeds } from "../../src/app/stock";
import { staffLineDocIds, guestLineDocIds } from "../../src/app/prep";
import {
  adjustLineWithStock, cancelOrderWithStock, restoreLineWithStock, voidLineWithStock,
} from "../../src/app/orderStockStore";
import {
  adjustPromptLines, cancelPromptLines, defaultStockChoices, splitStock, stockChoicesComplete, stockOutUnits,
  stockReopenAllowed, voidPromptLines,
} from "../../src/app/stockReturn";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });

// เมนู: ข้าวซอย (ครัว, สต็อกตัวเอง), ชาไทย (เคาน์เตอร์, สต็อกตัวเอง), แกงอ่อม (ตัวเลือกเนื้อ หมู→prep_pork), น้ำเปล่า (ไม่จำกัด)
const menu = (id, extra = {}) => ({ id, categoryId: "food", name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price: 50, ...extra });
const khaosoi = menu("khaosoi", { stockTracked: true });
const thaitea = menu("thaitea", { categoryId: "drinks", stockTracked: true });
const water = menu("water", { categoryId: "drinks" });
const gaengom = menu("gaengom", {
  hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false,
  prepTracked: true,
  customGroups: [{
    id: "meat", nameTh: "เนื้อ", nameEn: "Meat", type: "single", required: true,
    choices: [
      { id: "pork", labelTh: "หมู", labelEn: "Pork", priceDelta: 0, prepIds: ["prep_pork"] },
      { id: "beef", labelTh: "เนื้อ", labelEn: "Beef", priceDelta: 0, prepIds: ["prep_beef"] },
    ],
  }],
});
const menus = [khaosoi, thaitea, water, gaengom];
const line = (item, quantity, cartId, extra = {}) => ({ cartId, item, quantity, spiceLevel: 0, addEgg: false, addOns: [], ...extra });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "stock", "khaosoi"), { remaining: 10 });
    await setDoc(doc(db, "stock", "thaitea"), { remaining: 5 });
    await setDoc(doc(db, "stock", "prep_pork"), { kind: "prep", name: "หมูตุ๋น", remaining: 8 });
    await setDoc(doc(db, "stock", "prep_beef"), { kind: "prep", name: "เนื้อตุ๋น" }); // ไม่จำกัด
    for (const m of menus) await setDoc(doc(db, "menuItems", m.id), m);
  });
});

const read = async (path) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
};
const remaining = async (id) => (await read(`stock/${id}`))?.remaining;
const logs = async () => {
  let out = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDocs(collection(ctx.firestore(), "activityLogs"))).docs.map((d) => d.data());
  });
  return out;
};
const staffDb = () => { const db = env.authenticatedContext("staff", { email: "admin@hueanyong.local" }).firestore(); setTestDb(db); return db; };
const errors = {
  closed: (s) => Object.assign(new Error(`closed:${s}`), { code: "closed" }),
  notUndoable: (s) => Object.assign(new Error(`not-undoable:${s}`), { code: "not-undoable" }),
  allServed: () => Object.assign(new Error("all-served"), { code: "all-served" }),
  retakeShort: (item, short) => Object.assign(new Error(`short:${short.map((x) => `${x.id}=${x.remaining}/${x.need}`).join(",")}`), { code: "retake-short" }),
  addShort: (item, short) => Object.assign(new Error(`add-short:${short.map((x) => `${x.id}=${x.remaining}/${x.need}`).join(",")}`), { code: "add-short" }),
};

// พนักงานสั่งแทน (ตัดสต็อก + จด stockDocs) — stockMap/prepMap จำลองข้อมูลในเครื่อง
const stockMap = new Map([["khaosoi", { remaining: 10 }], ["thaitea", { remaining: 5 }]]);
const prepMap = new Map([["prep_pork", { name: "หมูตุ๋น", remaining: 8 }], ["prep_beef", { name: "เนื้อตุ๋น" }]]);
const staffDocIdsOf = (ci) => staffLineDocIds(menus.find((m) => m.id === ci.item.id), ci, true, stockMap, prepMap);
async function staffOrder(id, items, table = "1-3") {
  const db = staffDb();
  const needs = stockNeeds(items, staffDocIdsOf);
  await runStockTransaction((tx) => createOrderTakingStock(tx, {
    orderRef: doc(db, "orders", id),
    orderData: { tableNumber: table, items, status: "in-progress", createdAt: serverTimestamp(), stockRecorded: true },
    needs, guest: false, docIdsOf: staffDocIdsOf,
  }));
  return (await read(`orders/${id}`)).items;
}
const itemsOf = async (id) => (await read(`orders/${id}`)).items;
const lineOf = async (id, cartId) => (await itemsOf(id)).find((ci) => ci.cartId === cartId);

// ─── ตอนสั่ง: จดว่าตัดอะไรไป ───

test("order records stockDocs/stockQty only on lines that really took stock (unlimited prep skipped)", async () => {
  const items = await staffOrder("o1", [
    line(khaosoi, 2, "a"), line(water, 1, "w"),
    line(gaengom, 1, "gp", { customSelections: { meat: ["pork"] } }),
    line(gaengom, 1, "gb", { customSelections: { meat: ["beef"] } }),
  ]);
  const by = Object.fromEntries(items.map((ci) => [ci.cartId, ci]));
  assert.deepEqual([by.a.stockDocs, by.a.stockQty], [["khaosoi"], 2]);
  assert.equal(by.w.stockDocs, undefined, "unlimited item has no stock fields");
  assert.deepEqual([by.gp.stockDocs, by.gp.stockQty], [["prep_pork"], 1]);
  assert.equal(by.gb.stockDocs, undefined, "unlimited prep (no remaining) not recorded");
  assert.equal(await remaining("khaosoi"), 8);
  assert.equal(await remaining("prep_pork"), 7);
});

test("guest order also records stockDocs (rules still allow the create + take)", async () => {
  const db = env.unauthenticatedContext().firestore();
  setTestDb(db);
  const items = [line(thaitea, 2, "t")];
  const docIdsOf = (ci) => guestLineDocIds(menus.find((m) => m.id === ci.item.id), ci);
  await runStockTransaction((tx) => createOrderTakingStock(tx, {
    orderRef: doc(db, "orders", "g1"),
    orderData: { tableNumber: "1-1", items, status: "in-progress", createdAt: serverTimestamp() },
    needs: stockNeeds(items, docIdsOf), guest: true, docIdsOf,
  }));
  assert.deepEqual((await lineOf("g1", "t")).stockDocs, ["thaitea"]);
  assert.equal(await remaining("thaitea"), 3);
});

// ─── ยกเลิกรายการ (ปุ่ม ✕) ───

test("void + return → stock back, line flagged, log 'return_stock' in the same commit", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  const r = await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  assert.equal(r.returnedQty, 2);
  assert.equal(await remaining("khaosoi"), 10);
  const a = await lineOf("o1", "a");
  assert.equal(a.voided, true);
  assert.equal(a.stockReturned, true);
  const l = (await logs()).filter((x) => x.action === "return_stock");
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].itemName, l[0].tableNumber, l[0].details.qty, l[0].details.via], ["khaosoi", "1-3", 2, "void"]);
});

test("void without return → stock unchanged, no flag, no log", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: false, errors });
  assert.equal(await remaining("khaosoi"), 8);
  assert.equal((await lineOf("o1", "a")).stockReturned, undefined);
  assert.equal((await logs()).length, 0);
});

test("partial void (2 of 3) splits the line: returns 2, original keeps stockQty 1", async () => {
  await staffOrder("o1", [line(khaosoi, 3, "a")]);
  await voidLineWithStock("o1", "a", { qty: 2, reason: "", splitId: "a-x1", returnStock: true, errors });
  assert.equal(await remaining("khaosoi"), 9);
  const items = await itemsOf("o1");
  const orig = items.find((ci) => ci.cartId === "a");
  const split = items.find((ci) => ci.cartId === "a-x1");
  assert.deepEqual([orig.quantity, orig.stockQty, orig.stockReturned], [1, 1, undefined]);
  assert.deepEqual([split.quantity, split.stockQty, split.stockReturned, split.voided], [2, 2, true, true]);
});

test("no double return: voiding the same line again (retry / second tablet) returns nothing", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  const again = await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x2", returnStock: true, errors });
  assert.equal(again, null);
  assert.equal(await remaining("khaosoi"), 10);
  assert.equal((await logs()).length, 1);
});

test("two tablets void the same line at once → stock returned exactly once", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  const results = await Promise.allSettled([
    voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors }),
    voidLineWithStock("o1", "a", { reason: "", splitId: "a-x2", returnStock: true, errors }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled" && r.value).length, 1);
  assert.equal(await remaining("khaosoi"), 10);
});

test("unlimited: stock doc deleted after ordering → void+return skips it, no flag, no log", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(ctx.firestore(), "stock", "khaosoi"));
  });
  const r = await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  assert.equal(r.returnedQty, 0);
  assert.equal(await read("stock/khaosoi"), undefined, "doc not recreated");
  assert.equal((await lineOf("o1", "a")).stockReturned, undefined);
  assert.equal((await logs()).length, 0);
});

test("legacy line (no stockDocs, order from before this change) → nothing returned", async () => {
  staffDb();
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "orders", "old"), {
    tableNumber: "1-1", status: "in-progress", items: [line(khaosoi, 2, "a"), line(water, 1, "w")],
  }));
  await voidLineWithStock("old", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  assert.equal(await remaining("khaosoi"), 10);
});

// ─── ลดจำนวนในหน้าจ่ายเงิน ───

test("qty down 3→2 with return → +1, stockQty follows", async () => {
  await staffOrder("o1", [line(khaosoi, 3, "a")]);
  const r = await adjustLineWithStock("o1", "a", -1, { reason: "", returnStock: true, errors });
  assert.equal(r.returnedQty, 1);
  assert.equal(await remaining("khaosoi"), 8);
  assert.deepEqual([(await lineOf("o1", "a")).quantity, (await lineOf("o1", "a")).stockQty], [2, 2]);
  assert.equal((await logs())[0].details.via, "adjust");
});

test("qty down without return → stock unchanged, stockQty still shrinks (units consumed)", async () => {
  await staffOrder("o1", [line(khaosoi, 3, "a")]);
  await adjustLineWithStock("o1", "a", -1, { reason: "", returnStock: false, errors });
  assert.equal(await remaining("khaosoi"), 7);
  assert.equal((await lineOf("o1", "a")).stockQty, 2);
});

// ─── กด + ในหน้าจ่ายเงิน: ตัดสต็อกเหมือนตอนสั่ง ───
const plus = (orderId, cartId, n = 1) => adjustLineWithStock(orderId, cartId, n, { reason: "", docIdsOf: staffDocIdsOf, errors });

test("qty + with enough stock → taken in the same commit, recorded on the line", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a")]);
  await plus("o1", "a");
  assert.equal(await remaining("khaosoi"), 7);
  const a = await lineOf("o1", "a");
  assert.deepEqual([a.quantity, a.stockDocs, a.stockQty], [3, ["khaosoi"], 3]);
});

test("qty + with NOT enough stock → add-short error, quantity and stock unchanged", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a")]);
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "stock", "khaosoi"), { remaining: 0 }));
  await assert.rejects(plus("o1", "a"), /add-short:khaosoi=0\/1/);
  assert.equal(await remaining("khaosoi"), 0);
  assert.equal((await lineOf("o1", "a")).quantity, 2);
});

test("qty + then void → returns all of it (ordered + added)", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await plus("o1", "a");
  assert.equal(await remaining("khaosoi"), 7);
  const r = await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  assert.equal(r.returnedQty, 3);
  assert.equal(await remaining("khaosoi"), 10);
});

test("qty + takes prep via option the same way the order did", async () => {
  await staffOrder("o1", [line(gaengom, 1, "gp", { customSelections: { meat: ["pork"] } })]);
  assert.equal(await remaining("prep_pork"), 7);
  await plus("o1", "gp", 2);
  assert.equal(await remaining("prep_pork"), 5);
  assert.equal((await lineOf("o1", "gp")).stockQty, 3);
});

test("qty + on a new-order line that took nothing at order time uses the menu's stock now", async () => {
  // น้ำเปล่าไม่จำกัดตอนสั่ง → ตอนนี้ตั้งสต็อกแล้ว: + ตัดและจดลงบรรทัด (− ทีหลังคืนได้แค่ชิ้นที่เพิ่ม)
  await staffOrder("o1", [line(water, 1, "w"), line(khaosoi, 1, "a")]);
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "stock", "water"), { remaining: 4 }));
  stockMap.set("water", { remaining: 4 });
  try {
    await plus("o1", "w");
    assert.equal(await remaining("water"), 3);
    const w = await lineOf("o1", "w");
    assert.deepEqual([w.quantity, w.stockDocs, w.stockQty], [2, ["water"], 1]);
    const r = await voidLineWithStock("o1", "w", { reason: "", splitId: "w-x1", returnStock: true, errors });
    assert.equal(r.returnedQty, 1);
    assert.equal(await remaining("water"), 4);
  } finally {
    stockMap.delete("water");
  }
});

test("qty + on an old order (no stockRecorded, no stockDocs) works as before: no take", async () => {
  staffDb();
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "orders", "old"), {
    tableNumber: "1-1", status: "awaiting-payment", items: [line(khaosoi, 2, "a")],
  }));
  await plus("old", "a");
  assert.equal(await remaining("khaosoi"), 10);
  assert.equal((await lineOf("old", "a")).quantity, 3);
  // − afterwards: nothing recorded → nothing returned
  const r = await adjustLineWithStock("old", "a", -1, { reason: "", returnStock: true, errors });
  assert.equal(r.returnedQty, 0);
  assert.equal(await remaining("khaosoi"), 10);
});

test("qty + on an unlimited item → no take, no error", async () => {
  await staffOrder("o1", [line(water, 1, "w")]);
  await plus("o1", "w");
  assert.equal((await lineOf("o1", "w")).quantity, 2);
  assert.equal((await lineOf("o1", "w")).stockDocs, undefined);
});

test("payment screen − to 0 (wholeLine void, already served) can still return when chosen", async () => {
  await staffOrder("o1", [line(thaitea, 2, "t"), line(water, 1, "w")]);
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "orders", "o1"), { status: "awaiting-payment" }));
  await voidLineWithStock("o1", "t", { wholeLine: true, reason: "", splitId: "t-x1", returnStock: true, errors });
  assert.equal(await remaining("thaitea"), 5);
});

// ─── ยกเลิกทั้งออเดอร์ ───

test("cancel order: per-line choice, only chosen lines returned (incl. prep via option)", async () => {
  await staffOrder("o1", [
    line(khaosoi, 2, "a"), line(thaitea, 1, "t"),
    line(gaengom, 2, "gp", { customSelections: { meat: ["pork"] } }),
  ]);
  assert.deepEqual([await remaining("khaosoi"), await remaining("thaitea"), await remaining("prep_pork")], [8, 4, 6]);
  await cancelOrderWithStock("o1", { reason: "", returnCartIds: new Set(["t", "gp"]), errors });
  assert.deepEqual([await remaining("khaosoi"), await remaining("thaitea"), await remaining("prep_pork")], [8, 5, 8]);
  const o = await read("orders/o1");
  assert.equal(o.status, "cancelled");
  assert.deepEqual(o.items.map((ci) => [ci.cartId, !!ci.stockReturned]), [["a", false], ["t", true], ["gp", true]]);
  assert.equal((await logs()).filter((l) => l.action === "return_stock").length, 2);
});

test("cancel order: voided line already returned is not returned twice", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(thaitea, 1, "t")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  await cancelOrderWithStock("o1", { reason: "", returnCartIds: new Set(["a", "t"]), errors });
  assert.equal(await remaining("khaosoi"), 10);
  assert.equal(await remaining("thaitea"), 5);
});

test("closed bill: cancelling an already-cancelled/paid order throws, nothing returned again", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a")]);
  await cancelOrderWithStock("o1", { reason: "", returnCartIds: new Set(["a"]), errors });
  await assert.rejects(cancelOrderWithStock("o1", { reason: "", returnCartIds: new Set(["a"]), errors }), /closed:cancelled/);
  assert.equal(await remaining("khaosoi"), 10);
  await staffOrder("o2", [line(khaosoi, 1, "b")]);
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "orders", "o2"), { status: "paid" }));
  await assert.rejects(voidLineWithStock("o2", "b", { reason: "", splitId: "b-x", returnStock: true, errors }), /not-undoable:paid/);
  await assert.rejects(adjustLineWithStock("o2", "b", -1, { reason: "", returnStock: true, errors }));
  assert.equal(await remaining("khaosoi"), 9);
  // rules (closedOrderStaysClosed) ยังบังคับ: paid → in-progress ไม่ได้
  await assertFails(updateDoc(doc(staffDb(), "orders", "o2"), { status: "in-progress" }));
});

// ─── คืนรายการ (restore) ───

test("restore after return, enough stock → taken again, flag cleared, log 'retake_stock'", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  const r = await restoreLineWithStock("o1", "a", { errors });
  assert.equal(r.retakenQty, 2);
  assert.equal(await remaining("khaosoi"), 8);
  const a = await lineOf("o1", "a");
  assert.deepEqual([a.voided, a.stockReturned, a.stockQty], [undefined, undefined, 2]);
  assert.equal((await logs()).filter((l) => l.action === "retake_stock").length, 1);
});

test("restore after return, NOT enough → error, item stays voided, stock untouched", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "stock", "khaosoi"), { remaining: 1 }));
  await assert.rejects(restoreLineWithStock("o1", "a", { errors }), /short:khaosoi=1\/2/);
  assert.equal(await remaining("khaosoi"), 1);
  assert.equal((await lineOf("o1", "a")).voided, true);
  assert.equal((await lineOf("o1", "a")).stockReturned, true);
});

test("restore after a split partial void re-takes only the split quantity (prep via option too)", async () => {
  await staffOrder("o1", [line(gaengom, 3, "gp", { customSelections: { meat: ["pork"] } })]);
  await voidLineWithStock("o1", "gp", { qty: 2, reason: "", splitId: "gp-x1", returnStock: true, errors });
  assert.equal(await remaining("prep_pork"), 7);
  await restoreLineWithStock("o1", "gp-x1", { errors });
  assert.equal(await remaining("prep_pork"), 5);
});

test("restore when stock was NOT returned → no retake", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: false, errors });
  const r = await restoreLineWithStock("o1", "a", { errors });
  assert.equal(r.retakenQty, 0);
  assert.equal(await remaining("khaosoi"), 8);
});

test("restore after return but item became unlimited → restored, nothing taken", async () => {
  await staffOrder("o1", [line(khaosoi, 2, "a"), line(water, 1, "w")]);
  await voidLineWithStock("o1", "a", { reason: "", splitId: "a-x1", returnStock: true, errors });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(ctx.firestore(), "stock", "khaosoi"));
  });
  const r = await restoreLineWithStock("o1", "a", { errors });
  assert.equal(r.retakenQty, 0);
  assert.equal((await lineOf("o1", "a")).voided, undefined);
});

// ─── หน้าต่างถาม (logic ล้วน) ───

const station = (ci) => (ci.item.categoryId === "drinks" ? "counter" : "kitchen");
const tracked = (id) => ["khaosoi", "thaitea", "prep_pork"].includes(id);
const taken = (item, q, cartId, extra = {}) => line(item, q, cartId, { stockDocs: [item.id === "gaengom" ? "prep_pork" : item.id], stockQty: q, ...extra });

test("prompt: kitchen line has no default and blocks confirm until picked", () => {
  const order = { id: "o1", status: "in-progress", items: [taken(khaosoi, 2, "a")] };
  const lines = voidPromptLines(order, order.items[0], {}, station, tracked);
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].station, lines[0].qty], ["kitchen", 2]);
  const choices = defaultStockChoices(lines);
  assert.equal(choices.get("o1:a"), undefined);
  assert.equal(stockChoicesComplete(lines, choices), false);
  choices.set("o1:a", false);
  assert.equal(stockChoicesComplete(lines, choices), true);
});

test("prompt: counter checkbox ticked when not served, unticked when served", () => {
  const order = { id: "o1", status: "in-progress", items: [taken(thaitea, 2, "t")], servedUnits: {} };
  const notServed = voidPromptLines(order, order.items[0], {}, station, tracked);
  assert.equal(defaultStockChoices(notServed).get("o1:t"), true);
  assert.equal(stockChoicesComplete(notServed, defaultStockChoices(notServed)), true);
  const served = { ...order, status: "awaiting-payment" };
  const lines = voidPromptLines(served, served.items[0], { wholeLine: true }, station, tracked);
  assert.equal(defaultStockChoices(lines).get("o1:t"), false);
  // ลดจำนวน: เสิร์ฟแล้ว 1 จาก 2 ลดเหลือ 1 → ชิ้นที่ลดยังไม่เสิร์ฟได้ → ติ๊ก
  const partly = { ...order, servedUnits: { t: { count: 1 } } };
  assert.equal(defaultStockChoices(adjustPromptLines(partly, partly.items[0], 1, station, tracked)).get("o1:t"), true);
  assert.equal(defaultStockChoices(adjustPromptLines({ ...order, servedUnits: { t: { count: 2 } } }, order.items[0], 1, station, tracked)).get("o1:t"), false);
});

test("prompt: nothing for unlimited / untracked / legacy lines; cancel = one per tracked line", () => {
  const order = {
    id: "o1", status: "in-progress",
    items: [taken(khaosoi, 2, "a"), line(water, 1, "w"), line(khaosoi, 1, "legacy"), taken(thaitea, 1, "t"), taken(khaosoi, 1, "v", { voided: true })],
  };
  assert.deepEqual(voidPromptLines(order, order.items[1], {}, station, tracked), []);
  assert.deepEqual(voidPromptLines(order, order.items[2], {}, station, tracked), []);
  assert.deepEqual(voidPromptLines(order, order.items[0], {}, station, () => false), [], "doc gone / unlimited now");
  assert.deepEqual(cancelPromptLines(order, station, tracked).map((l) => [l.cartId, l.station]), [["a", "kitchen"], ["t", "counter"]]);
  assert.deepEqual(adjustPromptLines(order, order.items[0], 3, station, tracked), [], "qty up asks nothing");
});

test("stockOutUnits / splitStock: units added later (untaken) leave first", () => {
  const ci = taken(khaosoi, 3, "a", { stockQty: 2 });
  assert.equal(stockOutUnits(ci), 2);
  assert.deepEqual(splitStock(ci, 2), { returnQty: 0, keepStock: 2 });
  assert.deepEqual(splitStock(ci, 1), { returnQty: 1, keepStock: 1 });
  assert.equal(stockOutUnits({ ...ci, stockReturned: true }), 0);
});

// ─── หมดแล้วเปิดคืน ───

test("stockReopenAllowed: only system sold-out (flag), stock > 0, no linked prep out", () => {
  const flagged = { ...khaosoi, soldOut: true, soldOutByStock: true };
  assert.equal(stockReopenAllowed(flagged, { remaining: 2 }, new Map()), true);
  assert.equal(stockReopenAllowed(flagged, { remaining: 0 }, new Map()), false);
  assert.equal(stockReopenAllowed({ ...khaosoi, soldOut: true }, { remaining: 2 }, new Map()), false, "staff marked by hand");
  assert.equal(stockReopenAllowed({ ...flagged, active: false }, { remaining: 2 }, new Map()), false, "hidden");
  assert.equal(stockReopenAllowed({ ...flagged, prepIds: ["prep_x"] }, { remaining: 2 }, new Map([["prep_x", { name: "x", remaining: 0 }]])), false);
});

test("staff order that sells the last one marks soldOutByStock", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "stock", "thaitea"), { remaining: 1 }));
  await staffOrder("o1", [line(thaitea, 1, "t")]);
  const m = await read("menuItems/thaitea");
  assert.deepEqual([m.soldOut, m.soldOutByStock], [true, true]);
});
