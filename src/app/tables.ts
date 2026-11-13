// ─── ชื่อโต๊ะที่แสดง — อ่านผังจาก TABLE_ZONES (constants.ts) ─────────────────────────
// ข้อมูลใน Firestore เก็บเลขโต๊ะภายในเสมอ ("1-3", "3-1") — ชื่อที่แสดงคำนวณตอนวาดจอ/พิมพ์เท่านั้น
// โต๊ะที่ไม่อยู่ในผัง (เลขเก่า) แสดงเป็น "โต๊ะ <เลข>" ตามเดิม

import { FLOOR_PLAN, TABLE_ZONES, type FloorPlanFloor, type TableZoneConfig } from "./constants";
import type { Language } from "./types";

export interface TableDef {
  id: string; // เลขโต๊ะภายใน "<zone>-<ลำดับ>"
  n: number; // ลำดับในโซน
  name?: { th: string; en: string };
}

export interface TableZone {
  zone: number;
  name: { th: string; en: string };
  tables: TableDef[];
}

export function buildZones(config: TableZoneConfig[]): TableZone[] {
  return config.map((z) => ({
    zone: z.zone,
    name: z.name,
    tables: Array.from({ length: z.tables }, (_, i) => ({
      id: `${z.zone}-${i + 1}`,
      n: i + 1,
      ...(z.tableNames?.[i + 1] ? { name: z.tableNames[i + 1] } : {}),
    })),
  }));
}

// หัวข้อในผังโต๊ะ (หน้าเลือกโต๊ะ/ย้ายโต๊ะ/ลิงก์โต๊ะ/สถิติ): โซนที่มี showUnder ไปต่อท้ายโซนเป้าหมาย ไม่มีหัวข้อของตัวเอง
// showUnder ชี้ไปโซนที่ไม่มี / โซนที่ตัวเองก็ไปอยู่ใต้คนอื่น = ใช้หัวข้อของตัวเองตามเดิม (โต๊ะไม่หายจากผัง)
export function buildTableGroups(config: TableZoneConfig[]): TableZone[] {
  const zones = buildZones(config);
  const hosts = new Set(config.filter((z) => z.showUnder === undefined).map((z) => z.zone));
  const movedTo = (z: TableZoneConfig) =>
    z.showUnder !== undefined && z.showUnder !== z.zone && hosts.has(z.showUnder) ? z.showUnder : null;
  return zones
    .filter((_, i) => movedTo(config[i]) === null)
    .map((group) => ({
      ...group,
      tables: [
        ...group.tables,
        ...zones.filter((_, i) => movedTo(config[i]) === group.zone).flatMap((z) => z.tables),
      ],
    }));
}

// ZONES = โซนจริงตามเลขโต๊ะ | TABLE_GROUPS = หัวข้อที่แสดงในผังโต๊ะ
export const ZONES: TableZone[] = buildZones(TABLE_ZONES);
export const TABLE_GROUPS: TableZone[] = buildTableGroups(TABLE_ZONES);
const BY_ID = new Map(ZONES.flatMap((z) => z.tables).map((t) => [t.id, t]));

export const allTableIds = (): string[] => ZONES.flatMap((z) => z.tables.map((t) => t.id));
export const isKnownTable = (id: string): boolean => BY_ID.has(id);

const pick = (name: { th: string; en: string }, lang: Language) => (lang === "en" ? name.en || name.th : name.th);

// ชื่อเต็ม: "โต๊ะ 1-3" / "Table 1-3" / "ม้าหินอ่อน"
export function tableTitle(id: string, lang: Language): string {
  const def = BY_ID.get(id);
  if (def?.name) return pick(def.name, lang);
  return `${lang === "en" ? "Table" : "โต๊ะ"} ${id}`;
}

// ชื่อสั้น (ที่ที่มีคำว่า "โต๊ะ" กำกับอยู่แล้ว หรือที่แคบ เช่นหัวตั๋วครัว): "1-3" / "ม้าหินอ่อน"
export function tableShort(id: string, lang: Language): string {
  const def = BY_ID.get(id);
  return def?.name ? pick(def.name, lang) : id;
}

// ปุ่มในผังโต๊ะ (หัวข้อโซนบอกชั้นอยู่แล้ว): "3" / "ม้าหินอ่อน"
export function tableButtonLabel(def: TableDef, lang: Language): string {
  return def.name ? pick(def.name, lang) : String(def.n);
}

export const zoneTitle = (zone: TableZone, lang: Language): string => pick(zone.name, lang);

// true = โต๊ะมีชื่อของตัวเอง — ที่ที่ปกติเขียนคำว่า "โต๊ะ" กำกับเลข ไม่ต้องเขียน
export const isNamedTable = (id: string): boolean => !!BY_ID.get(id)?.name;

// ชื่อบิลรวมโต๊ะ: ["1-2","1-3"] → "โต๊ะ 1-2 + 1-3" (คำว่า "โต๊ะ" ครั้งเดียว) · โต๊ะที่มีชื่อเองใช้ชื่อนั้น เช่น "โต๊ะ 1-2 + ม้าหินอ่อน"
// โต๊ะเดียว = tableTitle เหมือนเดิม
export function tablesTitle(ids: string[], lang: Language): string {
  let saidTable = false;
  return ids
    .map((id) => {
      if (BY_ID.get(id)?.name) return tableTitle(id, lang);
      if (saidTable) return id;
      saidTable = true;
      return tableTitle(id, lang);
    })
    .join(" + ");
}

// ─── ผังร้านจริง (FLOOR_PLAN ใน constants.ts) ─────────────────────────────────
export interface FloorCell {
  table?: TableDef; // ไม่มี = ป้าย (เคาน์เตอร์) กดไม่ได้
  label?: { th: string; en: string };
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}
export interface Floor {
  key: string;
  name: { th: string; en: string };
  cols: number;
  rows: number; // จำนวนแถวโต๊ะ (ใช้คิดสัดส่วนความสูง)
  rowSteps: number; // ช่องตารางต่อ 1 แถวโต๊ะ: 2 = มีโต๊ะวางครึ่งแถว (row: 2.5) — row/rowSpan ของ cells นับเป็นช่องตารางแล้ว
  cells: FloorCell[];
}
const HALF = 2;
const isHalf = (n: number) => Number.isInteger(n * HALF);

// ปัญหาของผัง (ว่าง = ใช้ได้): โต๊ะซ้ำ / เลขที่ไม่มีจริง / โต๊ะที่ขาด / ช่องเกินขอบ / ช่องทับกัน
export function floorPlanProblems(plan: FloorPlanFloor[], config: TableZoneConfig[] = TABLE_ZONES): string[] {
  const known = new Set(buildZones(config).flatMap((z) => z.tables.map((t) => t.id)));
  const zones = new Set(config.map((z) => z.zone));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of plan) {
    if (!zones.has(f.zone)) problems.push(`floor zone ${f.zone} not in TABLE_ZONES`);
    const used = new Map<string, string>();
    for (const c of f.cells) {
      const what = c.table ?? c.label?.en ?? "?";
      if (c.table) {
        if (seen.has(c.table)) problems.push(`table ${c.table} listed twice`);
        if (!known.has(c.table)) problems.push(`table ${c.table} does not exist`);
        seen.add(c.table);
      }
      const cs = c.colSpan ?? 1;
      const rs = c.rowSpan ?? 1;
      if (!isHalf(c.row) || !isHalf(rs) || !Number.isInteger(c.col) || !Number.isInteger(cs)) problems.push(`${what} row must be whole or .5, col whole`);
      if (c.col < 1 || c.row < 1 || c.col + cs - 1 > f.cols || c.row + rs - 1 > f.rows) problems.push(`${what} outside floor ${f.zone}`);
      for (let x = c.col; x < c.col + cs; x++) {
        for (let y = c.row; y < c.row + rs; y += 1 / HALF) {
          const k = `${x},${y}`;
          if (used.has(k)) problems.push(`${what} overlaps ${used.get(k)} on floor ${f.zone}`);
          used.set(k, what);
        }
      }
    }
  }
  for (const id of known) if (!seen.has(id)) problems.push(`table ${id} missing from the floor plan`);
  return problems;
}

// ผังที่วาดจริง: ช่องที่อ้างโต๊ะไม่มีจริงถูกข้าม | โต๊ะที่ลืมใส่ผัง ไปเรียงในหัวข้อ "อื่นๆ" ท้ายผัง (ไม่มีโต๊ะหาย)
export function buildFloors(plan: FloorPlanFloor[], config: TableZoneConfig[] = TABLE_ZONES): Floor[] {
  const zones = buildZones(config);
  const byId = new Map(zones.flatMap((z) => z.tables).map((t) => [t.id, t]));
  const placed = new Set<string>();
  const floors: Floor[] = plan.map((f) => ({
    key: String(f.zone),
    name: config.find((z) => z.zone === f.zone)?.name ?? { th: `ชั้น ${f.zone}`, en: `Floor ${f.zone}` },
    cols: f.cols,
    rows: f.rows,
    rowSteps: HALF,
    cells: f.cells.flatMap((c): FloorCell[] => {
      // แถวครึ่ง (row 2.5) → ตารางละเอียด 2 ช่องต่อแถว: แถว r เริ่มช่อง (r-1)*2+1 สูง rowSpan*2 ช่อง
      const base = { col: c.col, row: Math.round((c.row - 1) * HALF) + 1, colSpan: c.colSpan ?? 1, rowSpan: Math.round((c.rowSpan ?? 1) * HALF) };
      if (!c.table) return [{ ...base, label: c.label }];
      const def = byId.get(c.table);
      if (!def || placed.has(c.table)) return [];
      placed.add(c.table);
      return [{ ...base, table: def }];
    }),
  }));
  const rest = zones.flatMap((z) => z.tables).filter((t) => !placed.has(t.id));
  if (rest.length > 0) {
    const cols = 5;
    floors.push({
      key: "other",
      name: { th: "อื่นๆ", en: "Other" },
      cols,
      rows: Math.ceil(rest.length / cols),
      rowSteps: 1,
      cells: rest.map((t, i) => ({ table: t, col: (i % cols) + 1, row: Math.floor(i / cols) + 1, colSpan: 1, rowSpan: 1 })),
    });
  }
  return floors;
}

export const FLOORS: Floor[] = buildFloors(FLOOR_PLAN);
export const floorTitle = (floor: Floor, lang: Language): string => pick(floor.name, lang);
// ปุ่มในผังร้าน: เลขเต็ม "1-3" (ผังไม่ได้เรียงเป็นแถว เลขลำดับอย่างเดียวอ่านยาก) / "ม้าหินอ่อน"
export const floorButtonLabel = (def: TableDef, lang: Language): string => (def.name ? pick(def.name, lang) : def.id);
