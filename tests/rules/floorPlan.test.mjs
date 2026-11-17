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

test("positions match the real floor plan (rotated 90° counter-clockwise, 2026-11-18)", () => {
  // ตารางละเอียดครึ่งช่องทั้งสองแนว: โต๊ะ 1 ช่อง = 2×2 | ทุกแถวในผังตอนนี้เป็นแถวเต็ม จึงแสดงแค่บรรทัดคี่
  const at = (zone) => {
    const f = FLOOR_PLAN.find((x) => x.zone === zone);
    const grid = Array.from({ length: f.rows * 2 }, () => Array(f.cols * 2).fill("."));
    for (const c of f.cells) {
      for (let r = 0; r < (c.rowSpan ?? 1) * 2; r++) for (let k = 0; k < (c.colSpan ?? 1) * 2; k++) grid[(c.row - 1) * 2 + r][(c.col - 1) * 2 + k] = c.table ?? "C";
    }
    const lines = grid.map((row) => row.join(" "));
    for (let i = 0; i < lines.length; i += 2) assert.equal(lines[i], lines[i + 1], `floor ${zone} half row ${i}`);
    return lines.filter((_, i) => i % 2 === 0);
  };
  // ชั้น 1 (3×5): ม้าหินอ่อนขวาบน, 1-3 / 1-2 / 1-1 คอลัมน์ขวา, 1-5 1-4 แถวกลาง, เคาน์เตอร์ (C) กว้าง 2 ช่องซ้ายล่าง
  assert.deepEqual(at(1), [
    ". . . . 3-1 3-1",
    ". . . . 1-3 1-3",
    "1-5 1-5 1-4 1-4 1-2 1-2",
    ". . . . 1-1 1-1",
    "C C C C . .",
  ]);
  // ชั้น 2 (4×4): แถวบน 2-1 2-2 2-3 2-4 | 2-9 ซ้าย 2-5 2-6 ขวา | 2-8 2-7 เหลื่อมครึ่งคอลัมน์ระหว่าง 2-2 กับ 2-3
  assert.deepEqual(at(2), [
    "2-1 2-1 2-2 2-2 2-3 2-3 2-4 2-4",
    "2-9 2-9 . . . . 2-5 2-5",
    ". . . 2-8 2-8 . 2-6 2-6",
    ". . . 2-7 2-7 . . .",
  ]);
  // หมุนจากผังเดิมจริง: ผังเดิม (คอลัมน์ c แถว r ในผังกว้าง W) → คอลัมน์ r แถว W − c − span + 2
  const OLD = {
    1: { W: 5, cells: { "1-5": [3, 1], "1-4": [3, 2], "1-1": [2, 3], "1-2": [3, 3], "1-3": [4, 3], "3-1": [5, 3] } },
    2: { W: 4, cells: { "2-9": [3, 1], "2-1": [4, 1], "2-2": [4, 2], "2-7": [1, 2.5], "2-8": [2, 2.5], "2-3": [4, 3], "2-6": [2, 4], "2-5": [3, 4], "2-4": [4, 4] } },
  };
  for (const [zone, { W, cells }] of Object.entries(OLD)) {
    const f = FLOOR_PLAN.find((x) => x.zone === Number(zone));
    for (const [id, [c, r]] of Object.entries(cells)) {
      const now = f.cells.find((x) => x.table === id);
      assert.deepEqual([now.col, now.row], [r, W - c + 1], id);
    }
  }
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
  assert.ok(floorPlanProblems([{ zone: 1, cols: 2, rows: 1, cells: [{ table: "1-1", col: 1.2, row: 1 }] }]).some((x) => x.includes("whole or .5")));
  // ครึ่งคอลัมน์ชนกัน
  const halfColOverlap = [{ zone: 1, cols: 2, rows: 1, cells: [{ table: "1-1", col: 1, row: 1 }, { table: "1-2", col: 1.5, row: 1 }] }];
  assert.ok(floorPlanProblems(halfColOverlap).some((x) => x.includes("1-2 overlaps 1-1")));
  // ครึ่งคอลัมน์ → ช่องตารางละเอียด
  const half = buildFloors([{ zone: 2, cols: 4, rows: 1, cells: [{ table: "2-8", col: 2.5, row: 1 }] }], TABLE_ZONES)[0];
  assert.deepEqual([half.colSteps, half.cells[0].col, half.cells[0].colSpan], [2, 4, 2]);
});
