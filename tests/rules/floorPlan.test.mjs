// ผังร้านจริง (FLOOR_PLAN) — ทุกโต๊ะอยู่ในผังครั้งเดียว เลขโต๊ะไม่เปลี่ยน ตำแหน่งตามแบบร้าน ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR_PLAN, TABLE_ZONES } from "../../src/app/constants";
import { FLOORS, allTableIds, buildFloors, floorButtonLabel, floorPlanProblems, floorTitle } from "../../src/app/tables";

const EXPECTED_IDS = ["1-1", "1-2", "1-3", "1-4", "1-5", "2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-7", "2-8", "2-9", "3-1"];
const placed = (floors) => floors.flatMap((f) => f.cells.filter((c) => c.table).map((c) => c.table.id));

test("floor plan has every table exactly once, ids unchanged, no overlaps", () => {
  assert.deepEqual([...allTableIds()].sort(), EXPECTED_IDS); // เลขโต๊ะภายในเดิมทั้งหมด (QR/ประวัติ/สถิติผูกกับเลขนี้)
  assert.deepEqual(floorPlanProblems(FLOOR_PLAN), []);
  const ids = placed(FLOORS);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), EXPECTED_IDS);
  assert.ok(!FLOORS.some((f) => f.key === "other"), "no table falls into the fallback group");
});

test("positions match the real floor plan", () => {
  const at = (zone) => {
    const f = FLOOR_PLAN.find((x) => x.zone === zone);
    // ตารางละเอียดครึ่งแถว: แถวโต๊ะ 1 แถว = 2 บรรทัด
    const grid = Array.from({ length: f.rows * 2 }, () => Array(f.cols).fill("."));
    for (const c of f.cells) {
      for (let r = 0; r < (c.rowSpan ?? 1) * 2; r++) for (let k = 0; k < (c.colSpan ?? 1); k++) grid[(c.row - 1) * 2 + r][c.col - 1 + k] = c.table ?? "C";
    }
    return grid.map((row) => row.join(" "));
  };
  // ชั้น 1: เคาน์เตอร์ (C) สูง 2 ช่องซ้ายบน, 1-5 / 1-4 คอลัมน์กลาง, แถวล่าง 1-1 1-2 1-3 ม้าหินอ่อน
  assert.deepEqual(at(1), [
    "C . 1-5 . .",
    "C . 1-5 . .",
    "C . 1-4 . .",
    "C . 1-4 . .",
    ". 1-1 1-2 1-3 3-1",
    ". 1-1 1-2 1-3 3-1",
  ]);
  // ชั้น 2: 2-9 2-1 / 2-2 / 2-3 / 2-6 2-5 2-4 — 2-7 2-8 เหลื่อมครึ่งแถวระหว่าง 2-2 กับ 2-3
  assert.deepEqual(at(2), [
    ". . 2-9 2-1",
    ". . 2-9 2-1",
    ". . . 2-2",
    "2-7 2-8 . 2-2",
    "2-7 2-8 . 2-3",
    ". . . 2-3",
    ". 2-6 2-5 2-4",
    ". 2-6 2-5 2-4",
  ]);
  const counter = FLOORS[0].cells.find((c) => !c.table);
  assert.equal(counter.label.th, "เคาน์เตอร์"); // ป้าย ไม่ใช่โต๊ะ (กดไม่ได้)
  assert.deepEqual(FLOORS.map((f) => floorTitle(f, "th")), ["ชั้น 1", "ชั้น 2"]);
  const bench = FLOORS[0].cells.find((c) => c.table?.id === "3-1");
  assert.equal(floorButtonLabel(bench.table, "th"), "ม้าหินอ่อน");
  assert.equal(floorButtonLabel(FLOORS[0].cells.find((c) => c.table?.id === "1-3").table, "th"), "1-3");
});

test("a broken plan is reported, and a forgotten table still shows (fallback group)", () => {
  const broken = [
    { zone: 1, cols: 2, rows: 1, cells: [{ table: "1-1", col: 1, row: 1 }, { table: "1-1", col: 2, row: 1 }, { table: "9-9", col: 3, row: 1 }] },
  ];
  const p = floorPlanProblems(broken);
  assert.ok(p.some((x) => x.includes("1-1 listed twice")));
  assert.ok(p.some((x) => x.includes("9-9 does not exist")));
  assert.ok(p.some((x) => x.includes("outside")));
  assert.ok(p.some((x) => x.includes("1-2 missing")));
  const floors = buildFloors(broken, TABLE_ZONES);
  assert.deepEqual([...placed(floors)].sort(), EXPECTED_IDS); // ไม่มีโต๊ะหาย
  assert.equal(floors.at(-1).key, "other");
  const overlap = [{ zone: 1, cols: 2, rows: 2, cells: [{ label: { th: "x", en: "x" }, col: 1, row: 1, rowSpan: 2 }, { table: "1-1", col: 1, row: 2 }] }];
  assert.ok(floorPlanProblems(overlap).some((x) => x.includes("overlaps")));
  // ครึ่งแถวชนกัน / ค่าแปลกๆ ถูกจับได้
  const halfOverlap = [{ zone: 1, cols: 1, rows: 2, cells: [{ table: "1-1", col: 1, row: 1 }, { table: "1-2", col: 1, row: 1.5 }] }];
  assert.ok(floorPlanProblems(halfOverlap).some((x) => x.includes("1-2 overlaps 1-1")));
  assert.ok(floorPlanProblems([{ zone: 1, cols: 1, rows: 2, cells: [{ table: "1-1", col: 1, row: 1.3 }] }]).some((x) => x.includes("whole or .5")));
});
