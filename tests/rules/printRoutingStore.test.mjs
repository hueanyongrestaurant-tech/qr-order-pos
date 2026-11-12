// ตอนเปิดแอป: หมวด → จุดพิมพ์ ใช้ค่าในเครื่องทันที / รอ Firestore / ไม่มีอะไรเลย 5 วิ → กฎชื่อหมวดเดิม (ไม่ใช่ "ทุกรายการ")
// โค้ดจริงใน src/app/staff/printRoutingStore.ts กับ emulator (ไม่แตะ production)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import {
  PRINT_ROUTING_CACHE_KEY, getPrintRouting, resetPrintRoutingForTest, savePrintStation, startPrintRouting, waitForPrintRouting,
} from "../../src/app/staff/printRoutingStore";
import { planTickets } from "../../src/app/staff/stationTickets";

// localStorage ของเครื่อง (node ไม่มีให้ใช้)
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});

const cats = [
  { id: "drink", nameTh: "เครื่องดื่ม", nameEn: "Drinks", order: 0 },
  { id: "food", nameTh: "อาหาร", nameEn: "Food", order: 1 },
  { id: "dessert", nameTh: "ของหวาน", nameEn: "Desserts", order: 2 },
];
const it = (id, categoryId) => ({ id, categoryId, name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price: 10, customGroups: [] });
const order = {
  id: "o", tableNumber: "1-1", timestamp: new Date(2026, 10, 11, 12), status: "in-progress",
  items: [["tea", "drink"], ["larb", "food"], ["mango", "dessert"]].map(([id, c], i) => ({ cartId: `c${i}`, item: it(id, c), quantity: 1, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} })),
};
const ticketItems = (routing, role) => planTickets(order, role, cats, routing).map((p) => [p.station, p.sections.flatMap((s) => s.items.map((ci) => ci.item.id))]);
const until = async (cond) => { for (let i = 0; i < 150 && !cond(); i++) await new Promise((r) => setTimeout(r, 20)); };

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { resetPrintRoutingForTest(); await env?.cleanup(); });
beforeEach(async () => {
  resetPrintRoutingForTest();
  store.clear();
  await env.clearFirestore();
  setTestDb(env.authenticatedContext("staff", { email: "admin@hueanyong.local" }).firestore());
});

test("no cache and nothing loaded: waits ~timeout, then the old name rule — never an ALL ITEMS ticket", async () => {
  assert.equal(getPrintRouting(), null);
  const t0 = Date.now();
  const routing = await waitForPrintRouting(150); // listener ไม่ได้เปิด = ไม่มีวันโหลดเสร็จ
  assert.ok(Date.now() - t0 >= 140);
  assert.deepEqual(routing, {});
  assert.deepEqual(ticketItems(routing, "counter"), [["counter", ["tea"]]]);
  assert.deepEqual(ticketItems(routing, "inner"), [["inner", ["larb", "mango"]]]);
  for (const role of ["all", "counter", "inner", "outer", "kitchen"])
    assert.ok(planTickets(order, role, cats, routing).every((p) => p.station !== "fallback"), role);
});

test("cache from last time is used immediately on startup, before Firestore answers", async () => {
  store.set(PRINT_ROUTING_CACHE_KEY, JSON.stringify({ dessert: "counter", junk: "outer" }));
  assert.deepEqual(getPrintRouting(), { dessert: "counter" });
  const t0 = Date.now();
  const routing = await waitForPrintRouting(5000);
  assert.ok(Date.now() - t0 < 50, "no waiting with a cache");
  assert.deepEqual(ticketItems(routing, "counter"), [["counter", ["tea", "mango"]]]);
});

test("Firestore value replaces the cache and is saved for next startup", async () => {
  store.set(PRINT_ROUTING_CACHE_KEY, JSON.stringify({ dessert: "kitchen" }));
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "status", "printRouting"), { dessert: "counter" }));
  const stop = startPrintRouting();
  assert.deepEqual(getPrintRouting(), { dessert: "kitchen" }); // ค่าในเครื่องทันที
  await until(() => getPrintRouting()?.dessert === "counter");
  assert.deepEqual(getPrintRouting(), { dessert: "counter" });
  assert.deepEqual(JSON.parse(store.get(PRINT_ROUTING_CACHE_KEY)), { dessert: "counter" });
  stop();
});

test("no cache: waiting resolves as soon as Firestore loads (not after the timeout)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "status", "printRouting"), { drink: "kitchen" }));
  const wait = waitForPrintRouting(5000);
  const t0 = Date.now();
  const stop = startPrintRouting();
  const routing = await wait;
  assert.ok(Date.now() - t0 < 4000);
  assert.deepEqual(routing, { drink: "kitchen" });
  assert.deepEqual(ticketItems(routing, "counter"), []);
  stop();
});

test("no doc at all = old name rule, and staff can save a station (status rules allow it)", async () => {
  const stop = startPrintRouting();
  assert.deepEqual(await waitForPrintRouting(5000), {});
  await savePrintStation("dessert", "counter");
  await until(() => !!getPrintRouting()?.dessert);
  assert.deepEqual(getPrintRouting(), { dessert: "counter" });
  stop();
});
