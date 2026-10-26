// ─── เมนูกระดาษ A4 (หน้า "พิมพ์เมนู" ฝั่งพนักงาน) — logic ล้วน ไม่แตะ Firebase (test ได้) ───
// สร้างจากเมนูในระบบทุกครั้งที่เปิดหน้า ราคาจึงตรงกับในแอปเสมอ
// • 2 ชุด พิมพ์แยกกัน: อาหาร / เครื่องดื่ม — ของฝากไปอยู่ชุดเครื่องดื่ม (ขายที่เคาน์เตอร์เหมือนกัน ชุดนี้สั้นกว่า มีที่เหลือ)
//   แยกตามชื่อหมวดภาษาไทย ชุดเดียวกับที่ส่งพิมพ์เคาน์เตอร์ (COUNTER_CATEGORY_PREFIXES)
// • ไม่เอาหมวด/เมนูที่ซ่อน — เมนูที่ "หมด" ชั่วคราวยังพิมพ์ (กระดาษใช้นาน) ตัวเลือกที่ปิดชั่วคราวก็ยังพิมพ์ด้วยเหตุผลเดียวกัน
// • ตัวเลือกที่ราคาต่างกัน: กลุ่ม "ต้องเลือก" แบบเลือกได้ 1 ที่ราคาไม่เท่ากัน → แยกราคา เช่น "หมู/ไก่ 79 · ทะเล 99"
//   ตัวเลือกเสริมที่มีราคา (ไข่ดาว ฯลฯ) → บรรทัดเล็ก "เพิ่ม: ไข่ดาว +15" | จาน/ช้อน/แก้วเปล่า ไม่พิมพ์

import type { Category, CustomGroup, MenuItem } from "../../src/app/types";
import { ADDON_CATEGORY_ID, COUNTER_CATEGORY_PREFIXES } from "../../src/app/constants";
import { BUILTIN_GROUP_IDS, normalizeMenuItem } from "../../src/app/menuOptions";

export type PrintSet = "food" | "drinks";

export interface PrintVariant { label: string; price: number }
export interface PrintItem {
  id: string;
  nameTh: string;
  nameEn: string;
  price: number | null;      // null = ราคาแยกตามตัวเลือก (ดู variants)
  variants: PrintVariant[];  // ว่าง = ราคาเดียว
  extras: string[];          // "ไข่ดาว +15"
}
export interface PrintSection {
  id: string;
  nameTh: string;
  nameEn: string;
  items: PrintItem[];
}

export const printSetOf = (category: Pick<Category, "nameTh">): PrintSet =>
  COUNTER_CATEGORY_PREFIXES.some((p) => (category.nameTh || "").startsWith(p)) ? "drinks" : "food";

const fmtDelta = (d: number) => (d > 0 ? `+${d}` : `${d}`);

// ราคาของเมนูเดียว (เมนูผ่าน normalizeMenuItem แล้ว)
export function printPrice(item: MenuItem): Pick<PrintItem, "price" | "variants" | "extras"> {
  const groups = (normalizeMenuItem(item).customGroups ?? []).filter((g) => g.choices.length > 0);
  const deltas = (g: CustomGroup) => [...new Set(g.choices.map((c) => c.priceDelta || 0))];
  const required = groups.filter((g) => g.required && g.type === "single");
  // ต้องเลือก + ราคาเท่ากันทุกตัว (ส่วนใหญ่ = 0) → บวกเข้าราคาตั้งต้น | ราคาไม่เท่ากัน → กลุ่มแรกแยกราคา กลุ่มต่อไปเป็นบรรทัดเพิ่ม
  const varied = required.filter((g) => deltas(g).length > 1);
  const base = item.price + required.filter((g) => deltas(g).length === 1).reduce((s, g) => s + deltas(g)[0], 0);
  const extras: string[] = [];
  varied.slice(1).forEach((g) => {
    const min = Math.min(...deltas(g));
    g.choices.filter((c) => (c.priceDelta || 0) !== min).forEach((c) => extras.push(`${c.labelTh} ${fmtDelta((c.priceDelta || 0) - min)}`));
  });
  const minOthers = varied.slice(1).reduce((s, g) => s + Math.min(...deltas(g)), 0);
  groups
    .filter((g) => !(g.required && g.type === "single") && g.id !== BUILTIN_GROUP_IDS.addOns)
    .forEach((g) => g.choices.filter((c) => (c.priceDelta || 0) !== 0).forEach((c) => extras.push(`${c.labelTh} ${fmtDelta(c.priceDelta)}`)));
  const uniqueExtras = [...new Set(extras)];
  if (varied.length === 0) return { price: base + minOthers, variants: [], extras: uniqueExtras };
  // ตัวเลือกที่ราคาเท่ากันรวมเป็นบรรทัดเดียว เรียงถูก → แพง (ในราคาเดียวกันเรียงตามลำดับในเมนู)
  const byPrice = new Map<number, string[]>();
  varied[0].choices.forEach((c) => {
    const p = base + minOthers + (c.priceDelta || 0);
    byPrice.set(p, [...(byPrice.get(p) ?? []), c.labelTh]);
  });
  const variants = [...byPrice].sort(([a], [b]) => a - b).map(([price, labels]) => ({ label: labels.join("/"), price }));
  return { price: null, variants, extras: uniqueExtras };
}

// หมวด (เรียงตาม order) → เมนู (เรียงตาม order เหมือนหน้าจัดการเมนู) แยก 2 ชุด
export function buildPrintMenu(categories: Category[], items: MenuItem[]): Record<PrintSet, PrintSection[]> {
  const out: Record<PrintSet, PrintSection[]> = { food: [], drinks: [] };
  [...categories]
    .filter((c) => c.active !== false && c.id !== ADDON_CATEGORY_ID)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((c) => {
      const list = items
        .filter((m) => m.categoryId === c.id && m.active !== false)
        .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999) || a.name.en.localeCompare(b.name.en));
      if (list.length === 0) return;
      out[printSetOf(c)].push({
        id: c.id,
        nameTh: c.nameTh,
        nameEn: c.nameEn,
        items: list.map((m) => ({ id: m.id, nameTh: m.name.th.trim(), nameEn: (m.name.en || "").trim(), ...printPrice(m) })),
      });
    });
  return out;
}

// ─── จัดหน้า: ใส่หมวดลงคอลัมน์ทีละหมวด (ความสูงวัดจากหน้าจอจริง หน่วย px) ───
// หมวดที่ไม่พอที่เหลือในคอลัมน์: ที่เหลือน้อย (< SPLIT_MIN_FREE ของคอลัมน์) และทั้งหมวดลงคอลัมน์ใหม่ได้ → ขึ้นคอลัมน์ใหม่
// ไม่งั้นแบ่งหมวด (ต่อคอลัมน์ถัดไปพร้อมหัวหมวด "(ต่อ)") — ท่อนละอย่างน้อย MIN_PIECE รายการ ไม่ให้หัวหมวดค้างท้ายคอลัมน์
export interface PackSection { heading: number; items: number[] }
export interface PackPiece { section: number; from: number; to: number; cont: boolean }
export type PackPage = PackPiece[][]; // [คอลัมน์][ท่อน]

const SPLIT_MIN_FREE = 0.3;
const MIN_PIECE = 2;

export function packMenu(sections: PackSection[], capacity: (page: number) => number, columns: number): PackPage[] {
  const pages: PackPage[] = [[[]]];
  let used = 0;
  const page = () => pages.length - 1;
  const col = () => pages[page()][pages[page()].length - 1];
  const cap = () => capacity(page());
  const nextColumn = () => {
    if (pages[page()].length < columns) pages[page()].push([]);
    else pages.push([[]]);
    used = 0;
  };
  const freshCap = () => (pages[page()].length < columns ? cap() : capacity(page() + 1));
  const sum = (s: PackSection, from: number, to: number) => s.items.slice(from, to).reduce((a, b) => a + b, 0);

  sections.forEach((s, si) => {
    let from = 0;
    while (from < s.items.length) {
      const rest = s.heading + sum(s, from, s.items.length);
      const free = cap() - used;
      if (rest <= free) {
        col().push({ section: si, from, to: s.items.length, cont: from > 0 });
        used += rest;
        return;
      }
      if (used > 0 && (free < cap() * SPLIT_MIN_FREE && rest <= freshCap())) { nextColumn(); continue; }
      // ใส่ได้กี่รายการในที่เหลือ
      let to = from;
      let h = s.heading;
      while (to < s.items.length && h + s.items[to] <= free) { h += s.items[to]; to++; }
      const left = s.items.length - to;
      if (left > 0 && left < MIN_PIECE && to - from > MIN_PIECE) { to -= MIN_PIECE - left; } // ท่อนหลังอย่างน้อย MIN_PIECE
      if (to - from < Math.min(MIN_PIECE, s.items.length - from)) {
        if (used > 0) { nextColumn(); continue; }
        to = Math.max(to, from + 1); // รายการเดียวสูงกว่าทั้งคอลัมน์ — ใส่ไปเลย (ล้นดีกว่าวนไม่จบ)
      }
      col().push({ section: si, from, to, cont: from > 0 });
      from = to;
      nextColumn();
    }
  });
  // ตัดคอลัมน์/หน้าว่างท้ายสุด
  while (pages.length > 1 && pages[page()].every((c) => c.length === 0)) pages.pop();
  return pages.map((p) => p.filter((c, i) => c.length > 0 || i === 0));
}
