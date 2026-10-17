// ─── Station tickets: แยกรายการในออเดอร์ไปตามจุดพิมพ์ ─────────────────────────
//
// ร้านมี 3 จุด แต่ละจุดมีแอป + เครื่องพิมพ์ของตัวเอง (หน้าที่ของเครื่องตั้งใน printerStore):
// - เคาน์เตอร์ (counter): เฉพาะหมวดที่ชื่อขึ้นต้นด้วย COUNTER_CATEGORY_PREFIXES (เครื่องดื่ม/ของฝาก)
// - ครัวนอก (outer): เมนูที่ชื่อขึ้นต้นด้วย OUTER_KITCHEN_ITEM_PREFIXES (ข้าวซอย/ขนมจีนน้ำเงี้ยว)
// - ครัวใน (inner): ที่เหลือทั้งหมด รวมเมนูที่หาหมวดไม่เจอ (หมวดถูกลบ)
//   ครัวใน/ครัวนอกเป็นคนละใบ (ตัดกระดาษ) แต่ละใบมีหัวใบครบในตัว
// - หน้าที่สำรองเผื่อเครื่องพิมพ์เสีย: "kitchen" = ครัวใน+ครัวนอกในใบเดียว (ครัวในบน ครัวนอกล่างสุด
//   คั่นด้วยเส้นฉีก — แบบเดิมตอนมี 2 จุด) และ "all" = ใบเคาน์เตอร์ + ใบครัวแบบ "kitchen"
// - Add-on แยก (ADDON_CATEGORY_ID เช่นค่าถุง) ติดไปทุกใบ/ทุกส่วนที่พิมพ์ — ออเดอร์ที่มีแต่ add-on
//   พิมพ์ทุกจุด (เคาน์เตอร์ ครัวใน ครัวนอก; "kitchen" พิมพ์ส่วนครัวในเท่านั้นแบบเดิม) เพราะบางทีใช้
//   add-on แทนของที่ไม่มีในเมนู
// - custom add-on ที่ผูกกับเมนู (ci.customNote) อยู่ในรายการเดียวกับเมนูนั้น จึงไปตามเมนูเอง
// - จุดที่ไม่มีรายการของตัวเองเลยไม่พิมพ์
// - ยังโหลดหมวดไม่เสร็จ (categories ว่าง) แยกไม่ได้ → ทุกเครื่องพิมพ์ใบ "ทุกรายการ" ใบเดียว
//
// ไฟล์นี้เป็นฟังก์ชันล้วน (ไม่แตะ Capacitor/เครื่องพิมพ์) — nativePrinter.ts แปลง TicketLine[]
// เป็น ESC/POS ส่วนการทดสอบแปลงเป็นข้อความธรรมดาได้โดยตรง

import type { CartItem, Category, Language, Order } from "../types";
import { T } from "../translations";
import { liveItems } from "../utils";
import { kitchenOptionSummary } from "./ticket";
import { ADDON_CATEGORY_ID, COUNTER_CATEGORY_PREFIXES, OUTER_KITCHEN_ITEM_PREFIXES } from "../constants";
import type { PrintRole } from "./printerStore";

export interface RoutedItems {
  counter: CartItem[];
  inner: CartItem[];
  outer: CartItem[];
  addons: CartItem[];
}

const startsWithAny = (text: string, prefixes: string[]) => {
  const s = text.trim();
  return prefixes.some((p) => s.startsWith(p));
};

export function routeOrderItems(order: Order, categories: Category[]): RoutedItems {
  const routed: RoutedItems = { counter: [], inner: [], outer: [], addons: [] };
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  liveItems(order.items).forEach((ci) => {
    if (ci.item.categoryId === ADDON_CATEGORY_ID) {
      routed.addons.push(ci);
      return;
    }
    const category = categoryById.get(ci.item.categoryId);
    if (category && startsWithAny(category.nameTh || "", COUNTER_CATEGORY_PREFIXES)) {
      routed.counter.push(ci);
    } else if (startsWithAny(ci.item.name.th || "", OUTER_KITCHEN_ITEM_PREFIXES)) {
      routed.outer.push(ci);
    } else {
      routed.inner.push(ci);
    }
  });
  return routed;
}

export type SectionKind = "counter" | "inner" | "outer" | "everything";

export interface TicketSection {
  kind: SectionKind;
  items: CartItem[];
}

// 1 ใบ = 1 ชิ้นกระดาษที่ตัด/ฉีกออกมา — ใบ "kitchen" อาจมี 2 ส่วน (ครัวใน + ครัวนอก) ในใบเดียว
export interface TicketPlan {
  station: "counter" | "kitchen" | "inner" | "outer" | "fallback";
  sections: TicketSection[];
}

// ใบที่เครื่องหน้าที่ role ต้องพิมพ์สำหรับออเดอร์นี้ — [] = ไม่มีอะไรของจุดนี้ ไม่ต้องพิมพ์
// โหมด "all" คืนใบเคาน์เตอร์ก่อนแล้วตามด้วยใบครัว (พิมพ์ต่อกันในงานเดียว)
export function planTickets(order: Order, role: PrintRole, categories: Category[]): TicketPlan[] {
  const all = liveItems(order.items);
  if (all.length === 0) return [];
  if (categories.length === 0) {
    return [{ station: "fallback", sections: [{ kind: "everything", items: all }] }];
  }

  const { counter, inner, outer, addons } = routeOrderItems(order, categories);
  const addonOnly = counter.length + inner.length + outer.length === 0;

  const counterPlan: TicketPlan | null =
    counter.length > 0 || addonOnly
      ? { station: "counter", sections: [{ kind: "counter", items: [...counter, ...addons] }] }
      : null;

  const kitchenSections: TicketSection[] = [];
  if (inner.length > 0 || addonOnly) kitchenSections.push({ kind: "inner", items: [...inner, ...addons] });
  if (outer.length > 0) kitchenSections.push({ kind: "outer", items: [...outer, ...addons] });
  const kitchenPlan: TicketPlan | null = kitchenSections.length > 0 ? { station: "kitchen", sections: kitchenSections } : null;

  // ครัวใน/ครัวนอกแยกเครื่อง — ออเดอร์ที่มีแต่ add-on พิมพ์ทั้งสองครัว (ต่างจาก "kitchen" ที่พิมพ์แค่ส่วนครัวใน)
  const innerPlan: TicketPlan | null =
    inner.length > 0 || addonOnly ? { station: "inner", sections: [{ kind: "inner", items: [...inner, ...addons] }] } : null;
  const outerPlan: TicketPlan | null =
    outer.length > 0 || addonOnly ? { station: "outer", sections: [{ kind: "outer", items: [...outer, ...addons] }] } : null;

  const plans =
    role === "counter" ? [counterPlan]
    : role === "inner" ? [innerPlan]
    : role === "outer" ? [outerPlan]
    : role === "kitchen" ? [kitchenPlan]
    : [counterPlan, kitchenPlan];
  return plans.filter((p): p is TicketPlan => p !== null);
}

// ─── Layout ──────────────────────────────────────────────────────────────────
// size: "wide" = GS! 0x10 (กว้าง x2) ใช้ทั้งใบเหมือนตั๋วครัวเดิม, "normal" เฉพาะบรรทัดว่างหัวใบกับเวลา
// wrap: ให้ nativePrinter ตัดบรรทัดตามคำ (ชื่อเมนู/ตัวเลือก/หมายเหตุ) — บรรทัดอื่นสั้นพออยู่แล้ว
// emphasis: "group" = ตัวเลือก/custom add-on (inverse), "underline" = หมายเหตุลูกค้า
export type TicketLine =
  | {
      kind: "text";
      text: string;
      size: "wide" | "normal";
      align: "left" | "center";
      bold?: boolean;
      emphasis?: "group" | "underline";
      wrap?: boolean;
    }
  | { kind: "rule" } // เส้นประเต็มความกว้าง (ขนาด wide)
  | { kind: "cut" };

const SECTION_TITLES: Record<SectionKind, { th: string; en: string }> = {
  counter: { th: "เคาน์เตอร์", en: "COUNTER" },
  inner: { th: "ครัวใน", en: "INNER" },
  outer: { th: "ครัวนอก", en: "OUTER" },
  everything: { th: "ทุกรายการ", en: "ALL ITEMS" },
};

export function ticketLabel(order: Order, lang: Language): string {
  // ไม่มีคำว่า "โต๊ะ" นำหน้า — เหลือแค่เลขโต๊ะ/ป้าย takeaway (ดูประวัติใน nativePrinter.ts)
  return order.isTakeaway ? order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน") : order.tableNumber;
}

// banner = บรรทัดใต้เลขโต๊ะ (ใบย้ายโต๊ะ: "ย้ายจาก 1-3 -> 2-5" ให้ครัวรู้ว่าไม่ใช่ออเดอร์ใหม่)
// ขนาดปกติ ตัวหนา ไม่กลับสี ไม่ wrap — ขนาด wide ได้แค่ ~15 ตัว/บรรทัด เคยแตกหลายบรรทัดอ่านยาก
// ขนาดปกติได้ 30 ตัว (LINE_WIDTH) "ย้ายจาก 1-10 -> 2-12" กว้าง ~19 ช่อง จึงอยู่บรรทัดเดียวเสมอ
function headerLines(order: Order, lang: Language, banner?: string): TicketLine[] {
  return [
    { kind: "text", text: ticketLabel(order, lang), size: "wide", align: "center", bold: true },
    ...(banner ? [{ kind: "text", text: banner, size: "normal", align: "center", bold: true } as TicketLine] : []),
    { kind: "text", text: order.timestamp.toLocaleString(lang === "th" ? "th-TH" : "en-US"), size: "normal", align: "center" },
  ];
}

function titleLine(kind: SectionKind, lang: Language): TicketLine {
  return { kind: "text", text: `** ${SECTION_TITLES[kind][lang]} **`, size: "wide", align: "center", bold: true };
}

const blank = (size: "wide" | "normal" = "wide"): TicketLine => ({ kind: "text", text: "", size, align: "left" });

function itemLines(items: CartItem[], lang: Language): TicketLine[] {
  const t = T[lang];
  const lines: TicketLine[] = [];
  items.forEach((ci, idx) => {
    const name = lang === "en" ? ci.item.name.en : ci.item.name.th;
    // ระดับ 1 ชื่อเมนูตัวหนา / ระดับ 2 ตัวเลือก + custom add-on (inverse) / ระดับ 3 หมายเหตุ (ขีดเส้นใต้)
    lines.push({ kind: "text", text: `${ci.quantity}x ${name}`, size: "wide", align: "left", bold: true, wrap: true });
    const opt = kitchenOptionSummary(ci, lang);
    if (opt) lines.push({ kind: "text", text: `  ${opt}`, size: "wide", align: "left", emphasis: "group", wrap: true });
    if (ci.note) lines.push({ kind: "text", text: `"${ci.note}"`, size: "wide", align: "left", emphasis: "underline", wrap: true });
    if (ci.customNote) {
      lines.push({
        kind: "text",
        text: `+ ${ci.customNote} (+${t.thb}${ci.customAddOnPrice || 0})`,
        size: "wide",
        align: "left",
        emphasis: "group",
        wrap: true,
      });
    }
    // เว้นบรรทัดระหว่างรายการ ไม่เว้นหลังรายการสุดท้าย (มีเส้นคั่นปิดอยู่แล้ว)
    if (idx < items.length - 1) lines.push(blank());
  });
  return lines;
}

const TOP_MARGIN_LINES = 5; // ขอบบนก่อนเนื้อหา (แทน spacer 30mm ของ JSX เดิม) — ใบเคาน์เตอร์ไม่เว้น (ดู topMarginLines)
const TEAR_GAP_LINES = 2;

// ใบเคาน์เตอร์เริ่มหัวใบทันที ไม่เว้นขอบบน (ประหยัดกระดาษ) — ใบครัว/ใบรวม/ใบย้ายของครัวเว้นเหมือนเดิม
// ใบย้ายโต๊ะใช้ layoutTicket ตัวเดียวกัน ใบย้ายของเคาน์เตอร์จึงไม่เว้นตามไปด้วย
export function topMarginLines(plan: TicketPlan): number {
  return plan.station === "counter" ? 0 : TOP_MARGIN_LINES;
}

export function layoutTicket(order: Order, plan: TicketPlan, lang: Language, banner?: string): TicketLine[] {
  const lines: TicketLine[] = [];
  for (let i = 0; i < topMarginLines(plan); i++) lines.push(blank("normal"));

  plan.sections.forEach((section, idx) => {
    if (idx === 0) {
      lines.push(...headerLines(order, lang, banner), { kind: "rule" }, titleLine(section.kind, lang), { kind: "rule" });
    } else {
      // จุดฉีก — ส่วนล่างพิมพ์เลขโต๊ะ/เวลาซ้ำ เพราะฉีกแยกไปแล้วต้องรู้ว่าของโต๊ะไหน
      for (let k = 0; k < TEAR_GAP_LINES; k++) lines.push(blank());
      lines.push({ kind: "text", text: lang === "en" ? "== TEAR HERE ==" : "= = ฉีกตรงนี้ = =", size: "wide", align: "center" });
      for (let k = 0; k < TEAR_GAP_LINES; k++) lines.push(blank());
      lines.push(titleLine(section.kind, lang), ...headerLines(order, lang, banner), { kind: "rule" });
    }
    lines.push(...itemLines(section.items, lang));
  });

  lines.push({ kind: "rule" }, { kind: "cut" });
  return lines;
}

const NO_ITEMS_MESSAGES: Record<PrintRole, { th: string; en: string }> = {
  all: { th: "ออเดอร์นี้ไม่มีรายการให้พิมพ์", en: "This order has no items to print." },
  counter: { th: "ออเดอร์นี้ไม่มีรายการของเคาน์เตอร์", en: "This order has no counter items." },
  kitchen: { th: "ออเดอร์นี้ไม่มีรายการของครัว", en: "This order has no kitchen items." },
  inner: { th: "ออเดอร์นี้ไม่มีรายการของครัวใน", en: "This order has no inner kitchen items." },
  outer: { th: "ออเดอร์นี้ไม่มีรายการของครัวนอก", en: "This order has no outer kitchen items." },
};

export function noItemsForRoleMessage(role: PrintRole, lang: Language): string {
  return NO_ITEMS_MESSAGES[role][lang];
}
