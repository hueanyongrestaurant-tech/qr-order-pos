// ─── ของเตรียม = สต็อกร่วมหลายเมนู (logic ล้วน ไม่แตะ Firestore — ทดสอบได้) ─────────────────────
// ของที่ทำไว้เป็นหม้อ/ชุดแล้วใช้หลายเมนู — สั่งเมนูที่ผูกไว้ 1 จาน หักของเตรียม 1
// เก็บใน collection stock เดียวกับสต็อกรายเมนู: stock/prep_xxx = { kind: "prep", name, remaining?, alertAt? }
//   ไม่มี remaining = ไม่จำกัด (ไม่ตัด) | rules ของ stock เดิมใช้ได้เลย ไม่ต้องแก้ firestore.rules
// ผูกได้ 2 ระดับ (ไหลไปกับ menu snapshot — ลูกค้าเห็นแค่ id ไม่เห็นจำนวน):
//   • ทั้งเมนู: menuItems.prepIds — ทุกจานหัก | หมด = เมนูขึ้น "หมด" (ธง soldOutByPrep ที่เมนู)
//   • ตัวเลือก: customGroups[].choices[].prepIds — หักเฉพาะจานที่เลือกตัวนี้ | หมด = ปิดเฉพาะตัวเลือก (ธงที่ตัวเลือก)
//     กลุ่ม "ต้องเลือก" ที่ปิดหมดทุกตัว เมนูขึ้นหมดตามกฎเดิม (requiredGroupAllClosed)
// กติกาเหมือนสต็อกรายเมนู: หักเฉพาะตอนกดสั่ง ไม่คืนเมื่อยกเลิก ใช้สวิตช์ระบบสต็อกตัวเดียวกัน
// เมนูมีทั้งสต็อกของตัวเองและของเตรียมได้ — หมดเมื่ออันใดอันหนึ่งเหลือ 0

import type { CartItem, CustomChoice, CustomGroup, MenuItem } from "./types";
import type { StockEntry } from "./stock";
import { cartItemSelections, isChoiceClosed, normalizeMenuItem } from "./menuOptions";

export const PREP_ID_PREFIX = "prep_";
export const isPrepId = (id: string) => id.startsWith(PREP_ID_PREFIX);

export interface PrepEntry {
  name: string;
  remaining?: number; // ไม่มี = ไม่จำกัด
  alertAt?: number;
}

// ตัวเลือกหนึ่งตัวในเมนู — key = "groupId:choiceId" ใช้ใน Set
export interface ChoiceRef {
  menuId: string;
  groupId: string;
  choiceId: string;
}
export const choiceKey = (groupId: string, choiceId: string) => `${groupId}:${choiceId}`;

// เหลือ 0 หรือติดลบ = เมนู/ตัวเลือกที่ผูกขึ้น "หมด" (ไม่จำกัด/ไม่มี doc แล้ว = ไม่หมด)
export function prepIsOut(prep: PrepEntry | undefined): boolean {
  return prep?.remaining !== undefined && prep.remaining <= 0;
}

const unique = (ids: string[]) => [...new Set(ids)];
const groupsOf = (item: MenuItem) => normalizeMenuItem(item).customGroups ?? [];

// ของเตรียมทุกตัวที่เมนูนี้ผูกไว้ (ทั้งเมนู + ทุกตัวเลือก)
export function allPrepLinks(item: MenuItem): string[] {
  return unique([...(item.prepIds ?? []), ...groupsOf(item).flatMap((g) => g.choices.flatMap((c) => c.prepIds ?? []))]);
}

// ของเตรียมของตัวเลือกที่รายการในตะกร้าเลือกไว้ (ดูจากเมนู item — ข้อมูลล่าสุดที่มี ไม่ใช่สำเนาในตะกร้า)
export function selectedChoicePrepIds(item: MenuItem, ci: CartItem): string[] {
  const selections = cartItemSelections(ci);
  return unique(groupsOf(item).flatMap((g) =>
    g.choices.filter((c) => (selections[g.id] ?? []).includes(c.id)).flatMap((c) => c.prepIds ?? [])));
}

// stock doc ระดับเมนูที่ลูกค้าต้องตัด (สต็อกของเมนูเอง + ของเตรียมที่ผูกทั้งเมนู) — ดูจากฟิลด์ในเมนูอย่างเดียว
export function guestStockDocIds(item: MenuItem | undefined): string[] {
  if (!item) return [];
  return [...(item.stockTracked ? [item.id] : []), ...(item.prepTracked ? item.prepIds ?? [] : [])];
}

// stock doc ที่ต้องตัดสำหรับรายการนี้ในตะกร้าลูกค้า (ระดับเมนู + ตัวเลือกที่เลือก) — doc ที่ไม่มีอยู่/ไม่จำกัด transaction ข้ามเอง
export function guestLineDocIds(item: MenuItem | undefined, ci: CartItem): string[] {
  if (!item) return [];
  return unique([...guestStockDocIds(item), ...(item.prepTracked ? selectedChoicePrepIds(item, ci) : [])]);
}

// เหมือน guestLineDocIds แต่ฝั่งพนักงานสั่งแทน — มีข้อมูล stock ในเครื่อง ตัดเฉพาะที่ตั้งจำนวนไว้จริง
export function staffLineDocIds(
  item: MenuItem | undefined,
  ci: CartItem,
  enabled: boolean,
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
): string[] {
  if (!enabled) return [];
  const preps = item ? [...(item.prepIds ?? []), ...selectedChoicePrepIds(item, ci)] : [];
  return unique([
    ...(stockMap.has(ci.item.id) ? [ci.item.id] : []),
    ...preps.filter((p) => prepMap.get(p)?.remaining !== undefined),
  ]);
}

// เมนูที่ใช้ของเตรียมนี้ (ระดับเมนูหรือตัวเลือกใดก็ได้)
export function menusUsingPrep<M extends MenuItem>(menus: M[], prepId: string): M[] {
  return menus.filter((m) => allPrepLinks(m).includes(prepId));
}

// ที่ผูกของเตรียมนี้ไว้: ทั้งเมนู (menuIds) และรายตัวเลือก (choices)
export function prepLinks(menus: MenuItem[], prepId: string): { menuIds: string[]; choices: ChoiceRef[] } {
  const menuIds: string[] = [];
  const choices: ChoiceRef[] = [];
  menus.forEach((m) => {
    if (m.prepIds?.includes(prepId)) menuIds.push(m.id);
    groupsOf(m).forEach((g) => g.choices.forEach((c) => {
      if (c.prepIds?.includes(prepId)) choices.push({ menuId: m.id, groupId: g.id, choiceId: c.id });
    }));
  });
  return { menuIds, choices };
}

// ผูก/ถอดของเตรียมกับตัวเลือก ให้ตรงกับ wanted (Set ของ choiceKey) — คืน customGroups ใหม่ หรือ null ถ้าไม่มีอะไรเปลี่ยน
// wanted = ว่าง = ถอดออกจากทุกตัวเลือก (ใช้ตอนลบของเตรียม)
export function setPrepOnChoices(groups: CustomGroup[], prepId: string, wanted: Set<string>): CustomGroup[] | null {
  let changed = false;
  const next = groups.map((g) => ({
    ...g,
    choices: g.choices.map((c) => {
      const has = !!c.prepIds?.includes(prepId);
      const want = wanted.has(choiceKey(g.id, c.id));
      if (has === want) return c;
      changed = true;
      const ids = want ? [...(c.prepIds ?? []), prepId] : (c.prepIds ?? []).filter((p) => p !== prepId);
      const { prepIds: _old, ...rest } = c;
      return ids.length > 0 ? { ...rest, prepIds: ids } : rest;
    }),
  }));
  return changed ? next : null;
}

// ผูก/ถอดของเตรียม = prepTracked (ไม่มีของเตรียมผูกเลย = ไม่ใส่ฟิลด์) — links = allPrepLinks ของเมนูหลังเปลี่ยน
export function prepTrackedFor(enabled: boolean, links: string[] | undefined): boolean {
  return enabled && (links?.length ?? 0) > 0;
}

// สิ่งที่ต้องเขียนตามของเตรียมตอนนี้ (เครื่องพนักงานทำแทนลูกค้าที่เขียน menuItems ไม่ได้)
// • close / reopen: ระดับเมนู — ผูกทั้งเมนูกับของเตรียมที่หมด → หมด + ธง | ไม่หมดแล้วและมีธง (และสต็อกของเมนูเองไม่เป็น 0) → เปิด
// • groups: customGroups ใหม่ของเมนูที่ตัวเลือกต้องปิด/เปิด — กติกาเดียวกันแต่ธงอยู่ที่ตัวเลือก
// เมนู/ตัวเลือกที่พนักงานปิดเองไม่มีธง จึงปิดต่อไป | เมนูที่ซ่อนอยู่ไม่แตะ
export function prepSoldOutChanges(
  menus: MenuItem[],
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
): { close: string[]; reopen: string[]; groups: Map<string, CustomGroup[]> } {
  const close: string[] = [];
  const reopen: string[] = [];
  const groups = new Map<string, CustomGroup[]>();
  const anyOut = (ids: string[] | undefined) => (ids ?? []).some((p) => prepIsOut(prepMap.get(p)));
  menus.forEach((m) => {
    if (m.active === false) return;
    if (anyOut(m.prepIds)) {
      if (!m.soldOut) close.push(m.id);
    } else if (m.soldOut && m.soldOutByPrep) {
      const own = stockMap.get(m.id);
      if (!own || own.remaining > 0) reopen.push(m.id);
    }
    let changed = false;
    const next = groupsOf(m).map((g) => ({
      ...g,
      choices: g.choices.map((c) => {
        if (!c.prepIds?.length && !c.soldOutByPrep) return c;
        if (anyOut(c.prepIds)) {
          if (isChoiceClosed(c)) return c;
          changed = true;
          return { ...c, soldOut: true, soldOutByPrep: true };
        }
        if (!c.soldOutByPrep || !isChoiceClosed(c)) return c;
        changed = true;
        const { soldOut: _s, active: _a, soldOutByPrep: _f, ...rest } = c;
        return rest;
      }),
    }));
    if (changed) groups.set(m.id, next);
  });
  return { close, reopen, groups };
}

// doc ที่เพิ่งหมด/ไม่พอ → ทำเมนูในเครื่องลูกค้าให้เห็นว่าหมดทันที (ไม่ต้องรอ cache / เครื่องพนักงาน)
// ผูกทั้งเมนู (หรือสต็อกของเมนูเอง) = เมนูหมด | ผูกแค่ตัวเลือก = ปิดเฉพาะตัวเลือกนั้น (ไม่ติดธง — แค่ในเครื่อง)
export function localSoldOutPatch(menus: MenuItem[], outDocIds: string[]): Map<string, Partial<MenuItem>> {
  const out = new Set(outDocIds);
  const patch = new Map<string, Partial<MenuItem>>();
  menus.forEach((m) => {
    if (out.has(m.id) || (m.prepIds ?? []).some((p) => out.has(p))) {
      patch.set(m.id, { soldOut: true });
      return;
    }
    let changed = false;
    const next = groupsOf(m).map((g) => ({
      ...g,
      choices: g.choices.map((c) => {
        if (isChoiceClosed(c) || !(c.prepIds ?? []).some((p) => out.has(p))) return c;
        changed = true;
        return { ...c, soldOut: true };
      }),
    }));
    if (changed) patch.set(m.id, { customGroups: next });
  });
  return patch;
}

export interface StockAlert {
  id: string;
  name: string;
  remaining: number;
  menuCount?: number; // ของเตรียม: จำนวนเมนูที่ขายอยู่ซึ่งผูกไว้ (ทั้งเมนูหรือตัวเลือก)
}

// แถบเตือนหน้าออเดอร์ (เฉพาะพนักงาน ระบบสต็อกปิด = ว่าง):
// • out = หมดเพราะสต็อก — สต็อกของเมนูเหลือ ≤ 0 หรือของเตรียมเหลือ ≤ 0 (แสดงชื่อของเตรียม ไม่ไล่ทุกเมนูที่ผูก)
// • low = ใกล้หมด (≤ ที่ตั้งเตือน ยังไม่ถึง 0)
// เมนูที่พนักงานกด "หมด" เองไม่มาจากสต็อก จึงไม่อยู่ในนี้ | เมนูที่ซ่อน/ลบไปแล้ว และของเตรียมที่ไม่มีเมนูขายอยู่ผูกไว้ ไม่แสดง
export function buildStockAlerts(
  enabled: boolean,
  menus: MenuItem[],
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
  nameOf: (m: MenuItem) => string,
): { out: StockAlert[]; low: StockAlert[] } {
  const out: StockAlert[] = [];
  const low: StockAlert[] = [];
  if (!enabled) return { out, low };
  const add = (alert: StockAlert, alertAt: number | undefined) => {
    if (alert.remaining <= 0) out.push(alert);
    else if (alertAt !== undefined && alert.remaining <= alertAt) low.push(alert);
  };
  stockMap.forEach((entry, id) => {
    const m = menus.find((x) => x.id === id);
    if (!m || m.active === false) return;
    add({ id, name: nameOf(m), remaining: entry.remaining }, entry.alertAt);
  });
  prepMap.forEach((prep, id) => {
    if (prep.remaining === undefined) return;
    const menuCount = menusUsingPrep(menus, id).filter((m) => m.active !== false).length;
    if (menuCount === 0) return;
    add({ id, name: prep.name, remaining: prep.remaining, menuCount }, prep.alertAt);
  });
  const byName = (a: StockAlert, b: StockAlert) => a.name.localeCompare(b.name, "th");
  return { out: out.sort(byName), low: low.sort((a, b) => a.remaining - b.remaining || byName(a, b)) };
}

// ปิดขายที่ไม่ได้มาจากสต็อก (แถบ "หมดแล้ว" หน้าออเดอร์ แสดงต่อจาก out ของ buildStockAlerts) — ไม่ขึ้นกับสวิตช์ระบบสต็อก
// • choices ไม่มี = ทั้งเมนูหมด (พนักงานกด "หมด" เอง หรือหมดเพราะสต็อกตอนระบบสต็อกปิดอยู่)
// • choices = ตัวเลือกที่ปิดอยู่ เช่น แกงอ่อม: เนื้อ (เมนูยังขาย)
// ระบบสต็อกเปิด: เมนู/ตัวเลือกที่หมดเพราะสต็อกของตัวเองหรือของเตรียมที่ out แสดงอยู่แล้ว ไม่ซ้ำ | เมนูที่ซ่อนไม่แสดง
export interface ClosedAlert {
  id: string;
  name: string;
  choices?: string[];
}

export function buildClosedAlerts(
  enabled: boolean,
  menus: MenuItem[],
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
  nameOf: (m: MenuItem) => string,
  labelOf: (c: CustomChoice) => string = (c) => c.labelTh || c.labelEn,
): ClosedAlert[] {
  const prepOut = (ids: string[] | undefined) => enabled && (ids ?? []).some((p) => prepIsOut(prepMap.get(p)));
  const out: ClosedAlert[] = [];
  menus.forEach((m) => {
    if (m.active === false) return;
    if (m.soldOut) {
      const own = stockMap.get(m.id);
      const byStock = enabled && ((own !== undefined && own.remaining <= 0) || prepOut(m.prepIds));
      if (!byStock) out.push({ id: m.id, name: nameOf(m) });
      return;
    }
    const choices = groupsOf(m).flatMap((g) =>
      g.choices.filter((c) => isChoiceClosed(c) && !(c.soldOutByPrep && prepOut(c.prepIds))).map(labelOf));
    if (choices.length > 0) out.push({ id: m.id, name: nameOf(m), choices: unique(choices) });
  });
  // ทั้งเมนูก่อน แล้วค่อยตัวเลือก — ในแต่ละกลุ่มเรียงตามชื่อ
  return out.sort((a, b) => Number(!!a.choices) - Number(!!b.choices) || a.name.localeCompare(b.name, "th"));
}
