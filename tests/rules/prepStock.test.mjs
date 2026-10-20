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
  allPrepLinks, buildStockAlerts, guestLineDocIds, guestStockDocIds, isPrepId, localSoldOutPatch, menusUsingPrep, prepIsOut, prepLinks,
  prepSoldOutChanges, prepTrackedFor, setPrepOnChoices, staffLineDocIds,
} from "../../src/app/prep";
import { requiredGroupAllClosed, setChoiceClosed } from "../../src/app/menuOptions";
import { withLiveAvailability } from "../../src/app/utils";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const menu = (id, extra = {}) => ({ id, categoryId: "c", name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price: 50, ...extra });
// เมนูแบบใหม่ที่มีกลุ่ม "เนื้อ" (ต้องเลือก): หมู→prep_pork, ไก่→prep_chicken + กลุ่มเพิ่ม (ไม่บังคับ) ไข่→prep_egg
const meatMenu = (id, extra = {}, choiceExtra = {}) => menu(id, {
  ...noBuiltins,
  customGroups: [
    {
      id: "meat", nameTh: "เนื้อ", nameEn: "Meat", type: "single", required: true, quickToggle: true,
      choices: [
        { id: "pork", labelTh: "หมู", labelEn: "Pork", priceDelta: 0, prepIds: ["prep_pork"], ...(choiceExtra.pork ?? {}) },
        { id: "chicken", labelTh: "ไก่", labelEn: "Chicken", priceDelta: 0, prepIds: ["prep_chicken"], ...(choiceExtra.chicken ?? {}) },
      ],
    },
    {
      id: "extra", nameTh: "เพิ่ม", nameEn: "Extra", type: "multi", required: false, quickToggle: false,
      choices: [{ id: "egg", labelTh: "ไข่", labelEn: "Egg", priceDelta: 10, prepIds: ["prep_egg"] }],
    },
  ],
  prepTracked: true,
  ...extra,
});
const choiceOf = (m, groupId, choiceId) => m.customGroups.find((g) => g.id === groupId).choices.find((c) => c.id === choiceId);
const line = (item, quantity, extra = {}) => ({ cartId: `${item.id}-${quantity}-${Math.random()}`, item, quantity, spiceLevel: 0, ...extra });

// ─── logic ล้วน ───

test("guestStockDocIds: own stock + linked preps only when tracked", () => {
  assert.deepEqual(guestStockDocIds(menu("a")), []);
  assert.deepEqual(guestStockDocIds(menu("a", { stockTracked: true })), ["a"]);
  assert.deepEqual(guestStockDocIds(menu("a", { prepIds: ["prep_x"], prepTracked: false })), [], "stock system off → no prep take");
  assert.deepEqual(guestStockDocIds(menu("a", { stockTracked: true, prepIds: ["prep_x", "prep_y"], prepTracked: true })), ["a", "prep_x", "prep_y"]);
  assert.deepEqual(guestStockDocIds(undefined), []);
});

test("staffLineDocIds: skips unlimited preps and everything when the system is off", () => {
  const stockMap = new Map([["a", { remaining: 3 }]]);
  const prepMap = new Map([["prep_x", { name: "X", remaining: 2 }], ["prep_u", { name: "U" }]]);
  const m = menu("a", { prepIds: ["prep_x", "prep_u", "prep_gone"] });
  assert.deepEqual(staffLineDocIds(m, line(m, 1), true, stockMap, prepMap), ["a", "prep_x"]);
  assert.deepEqual(staffLineDocIds(m, line(m, 1), false, stockMap, prepMap), []);
  assert.deepEqual(staffLineDocIds(menu("b"), line(menu("b"), 1), true, stockMap, prepMap), []);
});

test("choice-level: the line takes the menu-level prep plus only the chosen choices' preps", () => {
  const m = meatMenu("larb", { prepIds: ["prep_rice"] });
  const chicken = line(m, 2, { customSelections: { meat: ["chicken"] } });
  const porkEgg = line(m, 1, { customSelections: { meat: ["pork"], extra: ["egg"] } });
  assert.deepEqual(guestLineDocIds(m, chicken), ["prep_rice", "prep_chicken"]);
  assert.deepEqual(guestLineDocIds(m, porkEgg), ["prep_rice", "prep_pork", "prep_egg"]);
  assert.deepEqual(guestLineDocIds({ ...m, prepTracked: false }, chicken), [], "stock system off");
  const needs = stockNeeds([chicken, porkEgg, line(m, 3, { customSelections: { meat: ["pork"] } })], (ci) => guestLineDocIds(m, ci));
  assert.deepEqual([...needs].sort(), [["prep_chicken", 2], ["prep_egg", 1], ["prep_pork", 4], ["prep_rice", 6]]);
  const prepMap = new Map([["prep_pork", { name: "P", remaining: 3 }], ["prep_chicken", { name: "C" }], ["prep_egg", { name: "E", remaining: 9 }]]);
  assert.deepEqual(staffLineDocIds(m, porkEgg, true, new Map(), prepMap), ["prep_pork", "prep_egg"], "unlimited / missing preps skipped");
});

test("choice-level: same prep on the menu and a choice is taken once per plate", () => {
  const m = meatMenu("x", { prepIds: ["prep_pork"] });
  assert.deepEqual(guestLineDocIds(m, line(m, 1, { customSelections: { meat: ["pork"] } })), ["prep_pork"]);
});

test("allPrepLinks / menusUsingPrep / prepLinks see choice links", () => {
  const m = meatMenu("a", { prepIds: ["prep_rice"] });
  assert.deepEqual(allPrepLinks(m).sort(), ["prep_chicken", "prep_egg", "prep_pork", "prep_rice"]);
  assert.deepEqual(menusUsingPrep([m, menu("b", noBuiltins)], "prep_egg").map((x) => x.id), ["a"]);
  assert.deepEqual(prepLinks([m], "prep_pork"), { menuIds: [], choices: [{ menuId: "a", groupId: "meat", choiceId: "pork" }] });
  assert.deepEqual(prepLinks([m], "prep_rice"), { menuIds: ["a"], choices: [] });
});

test("setPrepOnChoices: link, unlink, no-op", () => {
  const groups = meatMenu("a").customGroups;
  const linked = setPrepOnChoices(groups, "prep_new", new Set(["meat:pork", "extra:egg"]));
  assert.deepEqual(linked[0].choices[0].prepIds, ["prep_pork", "prep_new"]);
  assert.deepEqual(linked[1].choices[0].prepIds, ["prep_egg", "prep_new"]);
  assert.deepEqual(linked[0].choices[1].prepIds, ["prep_chicken"]);
  assert.equal(setPrepOnChoices(linked, "prep_new", new Set(["meat:pork", "extra:egg"])), null, "nothing to change");
  const unlinked = setPrepOnChoices(groups, "prep_pork", new Set());
  assert.equal("prepIds" in unlinked[0].choices[0], false, "last prep removed → field gone");
});

test("prepSoldOutChanges: prep at 0 closes only the linked choice; required group all closed → menu sold out by the old rule", () => {
  const m = meatMenu("larb");
  const out = prepSoldOutChanges([m], new Map(), new Map([["prep_pork", { name: "P", remaining: 0 }]]));
  assert.deepEqual(out.close, []);
  const g = out.groups.get("larb");
  assert.deepEqual(choiceOf({ customGroups: g }, "meat", "pork"), { id: "pork", labelTh: "หมู", labelEn: "Pork", priceDelta: 0, prepIds: ["prep_pork"], soldOut: true, soldOutByPrep: true });
  assert.equal(choiceOf({ customGroups: g }, "meat", "chicken").soldOut, undefined, "other choice still on sale");
  assert.equal(requiredGroupAllClosed({ ...m, customGroups: g }), false);
  const both = prepSoldOutChanges([m], new Map(), new Map([["prep_pork", { name: "P", remaining: 0 }], ["prep_chicken", { name: "C", remaining: -1 }]]));
  assert.equal(requiredGroupAllClosed({ ...m, customGroups: both.groups.get("larb") }), true);
});

test("prepSoldOutChanges: refill reopens only choices closed by the prep; staff-closed choice stays closed", () => {
  const m = meatMenu("larb", {}, { pork: { soldOut: true, soldOutByPrep: true }, chicken: { soldOut: true } });
  const r = prepSoldOutChanges([m], new Map(), new Map([["prep_pork", { name: "P", remaining: 4 }], ["prep_chicken", { name: "C", remaining: 4 }]]));
  const g = r.groups.get("larb");
  assert.deepEqual(choiceOf({ customGroups: g }, "meat", "pork"), { id: "pork", labelTh: "หมู", labelEn: "Pork", priceDelta: 0, prepIds: ["prep_pork"] });
  assert.equal(choiceOf({ customGroups: g }, "meat", "chicken").soldOut, true);
  assert.equal(prepSoldOutChanges([m], new Map(), new Map([["prep_pork", { name: "P", remaining: 0 }]])).groups.has("larb"), false,
    "still out → nothing to write");
});

test("prepSoldOutChanges: flagged choice reopens when its prep is unlinked or deleted", () => {
  const m = meatMenu("larb", {}, { pork: { soldOut: true, soldOutByPrep: true, prepIds: undefined } });
  assert.equal(choiceOf({ customGroups: prepSoldOutChanges([m], new Map(), new Map()).groups.get("larb") }, "meat", "pork").soldOut, undefined);
});

test("manual on/off of a choice drops the prep flag (setChoiceClosed)", () => {
  const groups = meatMenu("larb", {}, { pork: { soldOut: true, soldOutByPrep: true } }).customGroups;
  assert.equal(choiceOf({ customGroups: setChoiceClosed(groups, "meat", "pork", true) }, "meat", "pork").soldOutByPrep, undefined);
  assert.equal(choiceOf({ customGroups: setChoiceClosed(groups, "meat", "pork", false) }, "meat", "pork").soldOutByPrep, undefined);
});

test("withLiveAvailability: choice prep flag comes from the latest data, prepIds from the form", () => {
  const prev = meatMenu("larb", {}, { pork: { soldOut: true, soldOutByPrep: true } });
  const form = meatMenu("larb", {}, { pork: { prepIds: ["prep_pork", "prep_more"], soldOutByPrep: false } });
  const saved = withLiveAvailability(form, prev);
  assert.deepEqual(choiceOf(saved, "meat", "pork"), { id: "pork", labelTh: "หมู", labelEn: "Pork", priceDelta: 0, prepIds: ["prep_pork", "prep_more"], soldOut: true, soldOutByPrep: true });
  const stale = withLiveAvailability(meatMenu("larb", {}, { pork: { soldOutByPrep: true } }), meatMenu("larb"));
  assert.equal(choiceOf(stale, "meat", "pork").soldOutByPrep, undefined, "stale flag in the form is dropped");
});

test("localSoldOutPatch: menu-level out → menu sold out; choice-level out → only that choice closed", () => {
  const whole = menu("whole", { ...noBuiltins, prepIds: ["prep_pork"] });
  const m = meatMenu("larb");
  const patch = localSoldOutPatch([whole, m, menu("other", noBuiltins)], ["prep_pork"]);
  assert.deepEqual(patch.get("whole"), { soldOut: true });
  assert.equal(choiceOf(patch.get("larb"), "meat", "pork").soldOut, true);
  assert.equal(choiceOf(patch.get("larb"), "meat", "chicken").soldOut, undefined);
  assert.equal(patch.has("other"), false);
});

test("stockNeeds: two menus sharing one prep add up; voided lines don't count", () => {
  const larbA = menu("larbA", { prepIds: ["prep_larb"], prepTracked: true });
  const larbB = menu("larbB", { prepIds: ["prep_larb"], prepTracked: true, stockTracked: true });
  const plain = menu("plain");
  const byId = new Map([larbA, larbB, plain].map((m) => [m.id, m]));
  const needs = stockNeeds(
    [line(larbA, 1), line(larbB, 2), line(plain, 5), line(larbA, 3, { voided: true })],
    (ci) => guestStockDocIds(byId.get(ci.item.id)),
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
  const r = prepSoldOutChanges(menus, new Map(), prepMap);
  assert.deepEqual([r.close, r.reopen], [["a"], []]);
});

test("prepSoldOutChanges: refill reopens only menus closed by the prep", () => {
  const prepMap = new Map([["prep_x", { name: "X", remaining: 5 }]]);
  const menus = [
    menu("auto", { prepIds: ["prep_x"], soldOut: true, soldOutByPrep: true }),
    menu("manual", { prepIds: ["prep_x"], soldOut: true }),      // staff pressed หมด themselves → stays sold out
    menu("ownOut", { prepIds: ["prep_x"], soldOut: true, soldOutByPrep: true }), // own stock still 0
  ];
  const stockMap = new Map([["ownOut", { remaining: 0 }]]);
  const r = prepSoldOutChanges(menus, stockMap, prepMap);
  assert.deepEqual([r.close, r.reopen], [[], ["auto"]]);
});

test("prepSoldOutChanges: one of two linked preps still out keeps the menu closed", () => {
  const prepMap = new Map([["prep_x", { name: "X", remaining: 5 }], ["prep_y", { name: "Y", remaining: 0 }]]);
  const m = menu("a", { prepIds: ["prep_x", "prep_y"], soldOut: true, soldOutByPrep: true });
  const r = prepSoldOutChanges([m], new Map(), prepMap);
  assert.deepEqual([r.close, r.reopen], [[], []]);
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
  const viaChoice = buildStockAlerts(true, [meatMenu("larb")], new Map(), new Map([["prep_pork", { name: "P", remaining: 0 }]]), (m) => m.name.th);
  assert.deepEqual(viaChoice.out, [{ id: "prep_pork", name: "P", remaining: 0, menuCount: 1 }], "prep linked only to a choice is listed");
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
