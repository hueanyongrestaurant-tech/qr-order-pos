// "ที่สั่งไปแล้ว" (src/app/tableView.ts) + ชื่อโต๊ะ (src/app/tables.ts) — ตรรกะล้วน ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTableView, decodeTableView, encodeTableView, isTableTokenShape, newTableToken, pendingSentOrders,
  PENDING_SHOW_MS, TABLE_VIEW_VERSION, TOKEN_LENGTH,
} from "../../src/app/tableView";
import { allTableIds, buildZones, isKnownTable, tableButtonLabel, tableShort, tableTitle, ZONES } from "../../src/app/tables";
import { readLinkParams } from "../../src/app/customerLink";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const sizeGroup = {
  id: "size", nameTh: "ขนาด", nameEn: "Size", type: "single", required: true,
  choices: [{ id: "reg", labelTh: "ธรรมดา", labelEn: "Regular", priceDelta: 0 }, { id: "sp", labelTh: "พิเศษ", labelEn: "Special", priceDelta: 20 }],
};
const khaoSoi = { id: "ks", categoryId: "food", name: { th: "ข้าวซอย", en: "Khao soi" }, description: { th: "", en: "" }, photo: "", price: 70, ...noBuiltins, customGroups: [sizeGroup] };
const tea = { id: "tea", categoryId: "drinks", name: { th: "ชาไทย", en: "Thai tea" }, description: { th: "", en: "" }, photo: "", price: 45, ...noBuiltins, customGroups: [] };
let n = 0;
const line = (item, quantity, size, extra = {}) => ({ cartId: `c${n++}`, item, quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: size ? { size: [size] } : {}, ...extra });
const order = (id, table, status, minute, items, extra = {}) => ({ id, tableNumber: table, status, timestamp: new Date(2026, 9, 22, 12, minute), items, ...extra });

test("buildTableView: merges same item + options across rounds, keeps order of first appearance", () => {
  const orders = [
    order("b", "1-3", "awaiting-payment", 10, [line(tea, 1), line(khaoSoi, 1, "sp")]),
    order("a", "1-3", "in-progress", 5, [line(khaoSoi, 2, "sp")]),
  ];
  const v = buildTableView(orders, "1-3");
  assert.deepEqual(v.lines.map((l) => [l.th, l.optTh, l.qty, l.amount]), [
    ["ข้าวซอย", "พิเศษ", 3, 270],
    ["ชาไทย", "", 1, 45],
  ]);
  assert.equal(v.total, 315);
  assert.deepEqual(v.orderIds, ["a", "b"]);
});

test("buildTableView: skips voided lines, paid/cancelled orders, takeaway and other tables", () => {
  const orders = [
    order("a", "1-3", "in-progress", 1, [line(khaoSoi, 2, "reg"), line(khaoSoi, 1, "reg", { voided: true })]),
    order("paid", "1-3", "paid", 2, [line(tea, 5)]),
    order("cancel", "1-3", "cancelled", 3, [line(tea, 5)]),
    order("tk", "1-3", "in-progress", 4, [line(tea, 5)], { isTakeaway: true }),
    order("other", "2-1", "in-progress", 5, [line(tea, 5)]),
  ];
  const v = buildTableView(orders, "1-3");
  assert.deepEqual(v.lines.map((l) => [l.th, l.qty]), [["ข้าวซอย", 2]]);
  assert.equal(v.total, 140);
  assert.deepEqual(v.orderIds, ["a"]);
});

test("buildTableView: no serve status in the output", () => {
  const v = buildTableView([order("a", "1-3", "in-progress", 1, [line(tea, 2)], { servedAt: { x: new Date() }, servedUnits: { x: { count: 1 } } })], "1-3");
  assert.deepEqual(Object.keys(v.lines[0]).sort(), ["amount", "en", "optEn", "optTh", "qty", "th"]);
});

test("buildTableView: after a table move, the items show at the new table and the old one is empty", () => {
  const moved = [order("a", "2-5", "in-progress", 1, [line(tea, 2)], { movedFrom: "1-3", moveId: "m1" })];
  assert.equal(buildTableView(moved, "1-3").lines.length, 0);
  assert.equal(buildTableView(moved, "2-5").total, 90);
});

test("encode/decode round trip; same content = same hash", () => {
  const v = buildTableView([order("a", "1-3", "in-progress", 1, [line(tea, 2)])], "1-3");
  const e1 = encodeTableView(v);
  const e2 = encodeTableView(JSON.parse(JSON.stringify(v)));
  assert.equal(e1.hash, e2.hash);
  const back = decodeTableView({ version: TABLE_VIEW_VERSION, data: e1.data, updatedAtMs: 5000 }, 1000);
  assert.equal(back.total, 90);
  assert.equal(back.updatedAtMs, 5000);
});

test("decodeTableView: bill closed after the summary was written → empty (old bill never shows)", () => {
  const e = encodeTableView(buildTableView([order("a", "1-3", "in-progress", 1, [line(tea, 2)])], "1-3"));
  const v = decodeTableView({ version: TABLE_VIEW_VERSION, data: e.data, updatedAtMs: 1000 }, 2000);
  assert.deepEqual([v.lines.length, v.total, v.orderIds.length], [0, 0, 0]);
  // ไม่รู้เวลาปิดบิล (อ่าน baseline ไม่ได้) = แสดงตามสรุป
  assert.equal(decodeTableView({ version: TABLE_VIEW_VERSION, data: e.data, updatedAtMs: 1000 }, null).total, 90);
});

test("decodeTableView: wrong version or broken data → null", () => {
  assert.equal(decodeTableView({ version: 99, data: "{}", updatedAtMs: 1 }, 0), null);
  assert.equal(decodeTableView({ version: TABLE_VIEW_VERSION, data: "not json", updatedAtMs: 1 }, 0), null);
  assert.equal(decodeTableView(undefined, 0), null);
});

test("pendingSentOrders: shows only this phone's orders not yet in the summary, for up to 10 minutes", () => {
  const sent = [
    { id: "in", sentAt: 0, lines: [] },
    { id: "new", sentAt: 1000, lines: [] },
    { id: "old", sentAt: 0, lines: [] },
  ];
  const view = { lines: [], total: 0, orderIds: ["in"], updatedAtMs: 100 };
  assert.deepEqual(pendingSentOrders(sent, view, 2000).map((s) => s.id), ["new", "old"]);
  assert.deepEqual(pendingSentOrders(sent, view, PENDING_SHOW_MS + 500).map((s) => s.id), ["new"]);
});

test("pendingSentOrders: summary rewritten after sending without this order (moved/cancelled/closed) → not pending", () => {
  const sent = [{ id: "x", sentAt: 1000, lines: [], viewUpdatedAtMs: 500 }];
  assert.deepEqual(pendingSentOrders(sent, { lines: [], total: 0, orderIds: [], updatedAtMs: 500 }, 2000).map((s) => s.id), ["x"]);
  assert.deepEqual(pendingSentOrders(sent, { lines: [], total: 0, orderIds: [], updatedAtMs: 900 }, 2000), []);
});

test("newTableToken: right length, allowed letters, different every time", () => {
  const a = newTableToken();
  const b = newTableToken();
  assert.equal(a.length, TOKEN_LENGTH);
  assert.ok(isTableTokenShape(a));
  assert.notEqual(a, b);
  assert.ok(!isTableTokenShape("1-3"));
  assert.ok(!isTableTokenShape(a + "x"));
});

test("readLinkParams: ?t= and ?table= are read; bad legacy table ignored", () => {
  assert.deepEqual(readLinkParams("?t=abc&s=1"), { token: "abc", legacyTable: null });
  assert.deepEqual(readLinkParams("?table=1-3"), { token: null, legacyTable: "1-3" });
  assert.deepEqual(readLinkParams("?table=abc"), { token: null, legacyTable: null });
  assert.deepEqual(readLinkParams(""), { token: null, legacyTable: null });
});

test("tables: ม้าหินอ่อน is 3-1 and shows its name everywhere", () => {
  assert.ok(allTableIds().includes("3-1"));
  assert.equal(allTableIds().length, 15);
  assert.equal(tableTitle("3-1", "th"), "ม้าหินอ่อน");
  assert.equal(tableShort("3-1", "th"), "ม้าหินอ่อน");
  assert.equal(tableTitle("3-1", "en"), "Marble bench");
  assert.equal(tableTitle("1-3", "th"), "โต๊ะ 1-3");
  assert.equal(tableShort("1-3", "th"), "1-3");
  assert.equal(tableTitle("9-9", "th"), "โต๊ะ 9-9"); // นอกผัง = เหมือนเดิม
  assert.ok(!isKnownTable("9-9"));
  const zone3 = ZONES.find((z) => z.zone === 3);
  assert.equal(tableButtonLabel(zone3.tables[0], "th"), "ม้าหินอ่อน");
  assert.equal(tableButtonLabel(ZONES[0].tables[2], "th"), "3");
});

test("tables: every table id passes the orders rule format", () => {
  allTableIds().forEach((id) => assert.match(id, /^[0-9]+-[0-9]+$/));
});

test("buildZones: adding a zone/table is one config row", () => {
  const z = buildZones([{ zone: 4, name: { th: "สวน", en: "Garden" }, tables: 2, tableNames: { 2: { th: "ศาลา", en: "Pavilion" } } }]);
  assert.deepEqual(z[0].tables.map((t) => [t.id, t.name?.th ?? null]), [["4-1", null], ["4-2", "ศาลา"]]);
});
