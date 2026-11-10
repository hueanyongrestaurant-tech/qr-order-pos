// หมวด → จุดพิมพ์ (status/printRouting) — ตรรกะล้วน ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutTicket, planTickets, routeOrderItems, stationForCategory } from "../../src/app/staff/stationTickets";
import { parsePrintRouting } from "../../src/app/staff/printRoutingStore";
import { counterCategoryIds, serveSummary, topItems } from "../../src/app/statsInsights";
import golden from "./fixtures/station-tickets-golden.json";
import { ROUTING_CATEGORIES, ROUTING_ORDERS, ROUTING_ROLES, ROUTING_NOW } from "./printRoutingFixtures.mjs";

const cats = [
  { id: "drink", nameTh: "เครื่องดื่ม", nameEn: "Drinks", order: 0 },
  { id: "souv", nameTh: "ของฝาก", nameEn: "Souvenirs", order: 1 },
  { id: "food", nameTh: "อาหารเหนือ", nameEn: "Northern", order: 2 },
  { id: "dessert", nameTh: "ของหวาน", nameEn: "Desserts", order: 3 },
];
const item = (id, th, categoryId) => ({ id, categoryId, name: { th, en: id }, description: { th: "", en: "" }, photo: "", price: 10, customGroups: [] });
let n = 0;
const line = (it, q = 1) => ({ cartId: `l${n++}`, item: it, quantity: q, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} });
const order = (...lines) => ({ id: "o", tableNumber: "1-1", timestamp: ROUTING_NOW, status: "in-progress", items: lines });

const TEA = item("tea", "ชาไทย", "drink");
const KEYRING = item("key", "พวงกุญแจ", "souv");
const KHAOSOI = item("ks", "ข้าวซอยไก่", "food");
const NAMNGIAO = item("nn", "ขนมจีนน้ำเงี้ยว", "food");
const LARB = item("larb", "ลาบคั่ว", "food");
const MANGO = item("mango", "ข้าวเหนียวมะม่วง", "dessert");
const GONE = item("gone", "เมนูหมวดที่ลบ", "deleted-cat");
const BAG = item("bag", "ค่าถุง", "__addon__");
const ids = (arr) => arr.map((ci) => ci.item.id);

test("stationForCategory: map value wins, missing entry falls back to the name prefix", () => {
  assert.equal(stationForCategory(cats[3], {}), "kitchen"); // ของหวาน ยังไม่ตั้ง → ครัว (แบบเดิม)
  assert.equal(stationForCategory(cats[3], { dessert: "counter" }), "counter");
  assert.equal(stationForCategory(cats[0], {}), "counter");
  assert.equal(stationForCategory(cats[0], { drink: "kitchen" }), "kitchen");
  assert.equal(stationForCategory(cats[1], { drink: "kitchen" }), "counter"); // หมวดอื่นไม่โดนผลกระทบ
  assert.equal(stationForCategory(cats[2], { dessert: "counter" }), "kitchen");
  assert.equal(stationForCategory(cats[3], { dessert: "bogus" }), "kitchen"); // ค่าแปลก = เหมือนไม่มีค่า
});

test("routing: dessert → counter, drinks → kitchen, khao soi still outer, deleted category → inner, add-ons separate", () => {
  const o = order(line(TEA), line(KEYRING), line(KHAOSOI), line(NAMNGIAO), line(LARB), line(MANGO), line(GONE), line(BAG));
  const base = routeOrderItems(o, cats, {});
  assert.deepEqual(ids(base.counter), ["tea", "key"]);
  assert.deepEqual(ids(base.inner), ["larb", "mango", "gone"]);
  assert.deepEqual(ids(base.outer), ["ks", "nn"]);
  assert.deepEqual(ids(base.addons), ["bag"]);

  const r = routeOrderItems(o, cats, { dessert: "counter", drink: "kitchen", "deleted-cat": "counter" });
  assert.deepEqual(ids(r.counter), ["key", "mango"]);
  assert.deepEqual(ids(r.inner), ["tea", "larb", "gone"]); // ค่าของหมวดที่ถูกลบไม่มีผล
  assert.deepEqual(ids(r.outer), ["ks", "nn"]);
  assert.deepEqual(ids(r.addons), ["bag"]);
});

test("routing: a food category moved to the counter takes its khao soi with it (outer split only for kitchen items)", () => {
  const r = routeOrderItems(order(line(KHAOSOI), line(LARB)), cats, { food: "counter" });
  assert.deepEqual(ids(r.counter), ["ks", "larb"]);
  assert.deepEqual(ids(r.outer), []);
});

test("every item lands on exactly one station, whatever the map says", () => {
  const all = [TEA, KEYRING, KHAOSOI, NAMNGIAO, LARB, MANGO, GONE];
  const maps = [{}, { dessert: "counter" }, { drink: "kitchen", souv: "kitchen" }, { food: "counter", dessert: "counter", drink: "counter", souv: "counter" }, { x: "counter" }];
  for (const map of maps) {
    const o = order(...all.map((it) => line(it)));
    const r = routeOrderItems(o, cats, map);
    const placed = [...r.counter, ...r.inner, ...r.outer].map((ci) => ci.cartId).sort();
    assert.deepEqual(placed, o.items.map((ci) => ci.cartId).sort(), JSON.stringify(map));
    // ทุกรายการถูกพิมพ์ที่ไหนสักที่ในชุดเคาน์เตอร์+ครัวใน+ครัวนอก
    const printed = new Set(["counter", "inner", "outer"].flatMap((role) => planTickets(o, role, cats, map).flatMap((p) => p.sections.flatMap((s) => s.items.map((ci) => ci.cartId)))));
    o.items.forEach((ci) => assert.ok(printed.has(ci.cartId), `${ci.item.id} printed nowhere with ${JSON.stringify(map)}`));
  }
});

test("add-ons still print on every station's ticket", () => {
  const o = order(line(MANGO), line(KHAOSOI), line(LARB), line(TEA), line(BAG));
  const map = { dessert: "counter" };
  for (const role of ["counter", "inner", "outer"]) {
    const plans = planTickets(o, role, cats, map);
    assert.equal(plans.length, 1, role);
    assert.ok(ids(plans[0].sections[0].items).includes("bag"), role);
  }
  assert.deepEqual(ids(planTickets(o, "counter", cats, map)[0].sections[0].items), ["mango", "tea", "bag"]);
  assert.deepEqual(ids(planTickets(o, "inner", cats, map)[0].sections[0].items), ["larb", "bag"]);
  assert.deepEqual(ids(planTickets(o, "outer", cats, map)[0].sections[0].items), ["ks", "bag"]);
});

test("parsePrintRouting keeps only counter/kitchen values", () => {
  assert.deepEqual(parsePrintRouting({ a: "counter", b: "kitchen", c: "outer", d: 1, e: null }), { a: "counter", b: "kitchen" });
  assert.deepEqual(parsePrintRouting(undefined), {});
});

test("EMPTY map: every ticket for 81 real-menu orders × 5 roles is identical to before printRouting (ccc3aab)", () => {
  let tickets = 0;
  for (const o of ROUTING_ORDERS) for (const role of ROUTING_ROLES) {
    for (const map of [{}, undefined]) {
      const now = planTickets(o, role, ROUTING_CATEGORIES, map).map((plan) => ({ station: plan.station, lines: layoutTicket(o, plan, "th") }));
      assert.deepEqual(JSON.parse(JSON.stringify(now)), golden[`${o.id}/${role}`], `${o.id}/${role}`);
      if (map) tickets += now.length;
    }
  }
  assert.ok(tickets > 300, `${tickets} tickets compared`);
});

// ─── สถิติใช้ map เดียวกับตั๋ว ───
test("stats: EMPTY map gives the same counter set as the old name-prefix rule (real categories)", () => {
  const oldRule = new Set(ROUTING_CATEGORIES.filter((c) => ["เครื่องดื่ม", "ของฝาก"].some((p) => c.nameTh.startsWith(p))).map((c) => c.id));
  assert.deepEqual([...counterCategoryIds(ROUTING_CATEGORIES)].sort(), [...oldRule].sort());
  assert.deepEqual([...counterCategoryIds(ROUTING_CATEGORIES, {})].sort(), [...oldRule].sort());
  assert.deepEqual([...counterCategoryIds(cats, {})].sort(), ["drink", "souv"]);
});

test("stats: dessert routed to the counter is skipped in top items and counted with drinks in serve time", () => {
  const at = (min) => new Date(ROUTING_NOW.getTime() + min * 60000);
  const o = { ...order(line(MANGO, 2), line(LARB, 1), line(TEA, 1), line(KEYRING, 1)), status: "paid" };
  o.serveLog = Object.fromEntries(o.items.map((ci, i) => [ci.cartId, [{ n: ci.quantity, at: at(10 + i) }]]));
  const map = { dessert: "counter" };
  // เมนูขายดี: ข้ามหมวดเคาน์เตอร์
  assert.deepEqual(topItems([o], 10, counterCategoryIds(cats, {})).map((t) => t.id).sort(), ["larb", "mango"]);
  assert.deepEqual(topItems([o], 10, counterCategoryIds(cats, map)).map((t) => t.id), ["larb"]);
  // เวลาเสิร์ฟ: ของฝากไม่นับเสมอ, map ว่าง = ของหวานเป็นอาหาร, ตั้งเคาน์เตอร์ = นับกับเครื่องดื่ม
  const before = serveSummary([o], cats);
  assert.equal(before.food.dineIn.pieces, 3);
  assert.equal(before.drink.dineIn.pieces, 1);
  const after = serveSummary([o], cats, undefined, map);
  assert.equal(after.food.dineIn.pieces, 1);
  assert.equal(after.drink.dineIn.pieces, 3);
});
