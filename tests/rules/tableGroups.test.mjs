// ผังโต๊ะที่แสดง (TABLE_GROUPS) — ม้าหินอ่อน (3-1) อยู่ใต้ชั้น 1 แต่เลขภายใน/ชื่อ/ลิงก์ไม่เปลี่ยน ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { TABLE_ZONES } from "../../src/app/constants";
import {
  TABLE_GROUPS, ZONES, allTableIds, buildTableGroups, isKnownTable, tableButtonLabel, tableShort, tableTitle, tablesTitle, zoneTitle,
} from "../../src/app/tables";
import { readLinkParams } from "../../src/app/customerLink";

const ids = (g) => g.tables.map((t) => t.id);

test("ม้าหินอ่อน (3-1) is listed under Floor 1 after table 5, with no heading of its own", () => {
  assert.deepEqual(TABLE_GROUPS.map((g) => zoneTitle(g, "th")), ["ชั้น 1", "ชั้น 2"]);
  assert.deepEqual(TABLE_GROUPS.map((g) => zoneTitle(g, "en")), ["Floor 1", "Floor 2"]);
  assert.deepEqual(ids(TABLE_GROUPS[0]), ["1-1", "1-2", "1-3", "1-4", "1-5", "3-1"]);
  assert.deepEqual(ids(TABLE_GROUPS[1]), ["2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-7", "2-8", "2-9"]);
  assert.equal(tableButtonLabel(TABLE_GROUPS[0].tables[5], "th"), "ม้าหินอ่อน");
  assert.equal(tableButtonLabel(TABLE_GROUPS[0].tables[5], "en"), "Marble bench");
});

test("every table appears exactly once in the grids, ids unchanged", () => {
  const shown = TABLE_GROUPS.flatMap(ids);
  assert.equal(new Set(shown).size, shown.length);
  assert.deepEqual([...shown].sort(), [...allTableIds()].sort());
  // โซนจริงไม่เปลี่ยน: 3-1 ยังเป็นโซน 3 ลำดับ 1
  assert.deepEqual(ZONES.map((z) => z.zone), [1, 2, 3]);
  assert.deepEqual(ids(ZONES[2]), ["3-1"]);
  assert.ok(isKnownTable("3-1"));
  assert.ok(allTableIds().includes("3-1"));
});

test("names on tickets / receipts / history unchanged", () => {
  assert.equal(tableTitle("3-1", "th"), "ม้าหินอ่อน");
  assert.equal(tableTitle("3-1", "en"), "Marble bench");
  assert.equal(tableShort("3-1", "th"), "ม้าหินอ่อน");
  assert.equal(tableTitle("1-5", "th"), "โต๊ะ 1-5");
  assert.equal(tablesTitle(["1-2", "3-1"], "th"), "โต๊ะ 1-2 + ม้าหินอ่อน");
});

test("QR links still carry the same table: legacy ?table=3-1 and token links untouched", () => {
  assert.deepEqual(readLinkParams("?table=3-1"), { token: null, legacyTable: "3-1" });
  assert.equal(readLinkParams("?t=abcDEF123").token, "abcDEF123");
});

test("buildTableGroups: bad showUnder keeps its own heading (no table lost); no showUnder = same as zones", () => {
  const plain = TABLE_ZONES.map(({ showUnder, ...z }) => z);
  assert.deepEqual(buildTableGroups(plain).map(ids), ZONES.map(ids));
  const bad = [
    { zone: 1, name: { th: "ชั้น 1", en: "F1" }, tables: 2 },
    { zone: 2, name: { th: "a", en: "a" }, tables: 1, showUnder: 9 }, // ไม่มีโซน 9
    { zone: 3, name: { th: "b", en: "b" }, tables: 1, showUnder: 4 },
    { zone: 4, name: { th: "c", en: "c" }, tables: 1, showUnder: 1 }, // 3 ชี้ไป 4 ที่ย้ายไปแล้ว → 3 อยู่เอง
  ];
  assert.deepEqual(buildTableGroups(bad).map(ids), [["1-1", "1-2", "4-1"], ["2-1"], ["3-1"]]);
});
