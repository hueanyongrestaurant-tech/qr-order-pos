// ─── ชื่อโต๊ะที่แสดง — อ่านผังจาก TABLE_ZONES (constants.ts) ─────────────────────────
// ข้อมูลใน Firestore เก็บเลขโต๊ะภายในเสมอ ("1-3", "3-1") — ชื่อที่แสดงคำนวณตอนวาดจอ/พิมพ์เท่านั้น
// โต๊ะที่ไม่อยู่ในผัง (เลขเก่า) แสดงเป็น "โต๊ะ <เลข>" ตามเดิม

import { TABLE_ZONES, type TableZoneConfig } from "./constants";
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

export const ZONES: TableZone[] = buildZones(TABLE_ZONES);
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
