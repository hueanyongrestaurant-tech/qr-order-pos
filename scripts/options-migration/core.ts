// ─── แปลงตัวเลือกในตัว → กลุ่มตัวเลือกที่สร้างเอง (customGroups) ใน menuItems ─────────────
// ใช้ normalizeMenuItem ตัวเดียวกับแอป (src/app/menuOptions.ts) — ผลใน DB ตรงกับที่แอปแปลงตอนอ่านทุกตัวอักษร
// ไฟล์นี้ไม่ล็อกอิน/ไม่ผูกกับ project ใด: รับ db มาจากผู้เรียก (cli.ts = production, test = emulator)
//
// ความปลอดภัย:
// • ก่อนแปลงต้องมีไฟล์สำรอง (backup) ของทุกเมนู — apply เขียนเฉพาะเมนูที่ข้อมูลตอนนี้ "ตรงกับไฟล์สำรองทุกตัวอักษร"
//   (เช็คใน transaction) ถ้ามีใครแก้เมนูหลังสำรอง → ข้ามเมนูนั้นแล้วรายงาน ไม่เขียนทับ
// • แก้เฉพาะ field ตัวเลือก (OPTION_FIELDS) — ราคา/ชื่อ/สถานะขาย/สต็อก/รูป ไม่แตะ
// • rollback คืนค่า field ตัวเลือกจากไฟล์สำรอง + สร้างเมนูตัวอย่างที่ลบไปกลับคืนทั้ง doc
// • รันซ้ำได้: เมนูที่แปลงแล้วไม่มีอะไรต้องเขียน

import {
  collection, deleteField, doc, getDocs, runTransaction, setDoc, Timestamp, type Firestore,
} from "firebase/firestore";
import type { CustomGroup, MenuItem } from "../../src/app/types";
import {
  BUILTIN_GROUP_IDS, EGG_PRICE, hasLegacyOptions, isChoiceClosed, MEAT_CHOICES, normalizeMenuItem, OPTION_FIELDS,
} from "../../src/app/menuOptions";
import { ADD_ONS } from "../../src/app/constants";

// เมนูตัวอย่างเก่าตอนตั้งร้าน — อยู่ในหมวดที่ไม่มีแล้ว ไม่มีใครเห็น ลบทิ้งพร้อมรอบแปลง (มีในไฟล์สำรอง)
// ลบเฉพาะเมื่อ categoryId ไม่ตรงกับหมวดที่มีอยู่จริงด้วย (กันลบผิดตัวถ้าวันหลังมีใครใช้ id ซ้ำ)
export const DEMO_ITEM_IDS = ["a1", "a2", "a3", "c1", "c2", "d2", "d3", "ds1", "ds2", "n1", "n2", "n3", "n4", "nd1", "nd2", "r2", "s1", "s2"];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type DocData = Record<string, unknown>;

export interface BackupFile {
  kind: "menuItems-options-backup";
  version: 1;
  createdAt: string;
  categoryIds: string[];
  menuItems: { id: string; data: Json }[];
}

// ─── JSON ที่เทียบกันได้ + เก็บลงไฟล์ได้ (Timestamp เก็บเป็น object พิเศษ) ───
export function toJson(value: unknown): Json {
  if (value instanceof Timestamp) return { __timestamp: [value.seconds, value.nanoseconds] };
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = toJson(v);
    }
    return out;
  }
  return value as Json;
}

export function fromJson(value: Json): unknown {
  if (Array.isArray(value)) return value.map(fromJson);
  if (value && typeof value === "object") {
    const ts = (value as { __timestamp?: [number, number] }).__timestamp;
    if (Array.isArray(ts)) return new Timestamp(ts[0], ts[1]);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromJson(v)]));
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(toJson(a)) === JSON.stringify(toJson(b));

// ─── สำรอง ───
export async function takeBackup(db: Firestore, now = new Date()): Promise<BackupFile> {
  const [menuSnap, catSnap] = await Promise.all([getDocs(collection(db, "menuItems")), getDocs(collection(db, "categories"))]);
  return {
    kind: "menuItems-options-backup",
    version: 1,
    createdAt: now.toISOString(),
    categoryIds: catSnap.docs.map((d) => d.id).sort(),
    menuItems: menuSnap.docs.map((d) => ({ id: d.id, data: toJson(d.data()) })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

export function checkBackup(backup: BackupFile): void {
  if (backup?.kind !== "menuItems-options-backup" || backup.version !== 1 || !Array.isArray(backup.menuItems)) {
    throw new Error("ไฟล์สำรองไม่ถูกต้อง");
  }
}

// ─── แผน (ไม่เขียนอะไร) ───
export interface ItemPlan {
  id: string;
  nameTh: string;
  action: "convert" | "delete-demo";
  before: DocData;  // ข้อมูลตามไฟล์สำรอง (สำหรับเช็คว่ายังไม่มีใครแก้)
  patch: Record<string, unknown>; // field ตัวเลือกที่จะเขียน (undefined = ลบ field) — ว่างถ้า delete-demo
  after: MenuItem;  // หลังแปลง
  notes: string[];  // สรุปเป็นภาษาคน สำหรับ dry-run
}

export interface MigrationPlan {
  items: ItemPlan[];
  unchanged: number;
  problems: string[]; // ไม่ว่าง = ห้าม apply
}

function optionPatch(before: DocData, after: DocData): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of OPTION_FIELDS) {
    if (!same(before[k], after[k])) patch[k] = after[k];
  }
  return patch;
}

const label = (g: CustomGroup) => g.nameTh || g.nameEn || g.id;
const priceText = (n: number) => (n ? `+${n}` : "+0");

function describe(before: MenuItem, after: MenuItem): string[] {
  const notes: string[] = [];
  const oldGroupIds = new Set((before.customGroups || []).map((g) => g.id));
  for (const g of after.customGroups || []) {
    const flags = [
      g.type === "single" ? "เลือก 1" : "เลือกได้หลายอย่าง",
      g.required ? "ต้องเลือก" : "ไม่บังคับ",
      g.quickToggle ? "✓แสดงในหน้าจัดการเมนู" : "",
    ].filter(Boolean).join(", ");
    const choices = g.choices.map((c) => `${c.labelTh || c.labelEn} ${priceText(c.priceDelta)}${isChoiceClosed(c) ? " (ปิด)" : ""}`).join(" / ");
    const prev = (before.customGroups || []).find((x) => x.id === g.id);
    if (!oldGroupIds.has(g.id)) {
      notes.push(`ใหม่ [${label(g)}] ${flags}: ${choices}`);
    } else {
      const changes: string[] = [];
      if (prev?.defaultChoiceId) changes.push(`เอาค่าเริ่มต้น "${prev.choices.find((c) => c.id === prev.defaultChoiceId)?.labelTh ?? prev.defaultChoiceId}" ออก`);
      if (prev?.quickToggle === undefined) changes.push(g.quickToggle ? "ติ๊กแสดงในหน้าจัดการเมนู" : "ไม่ติ๊กแสดงในหน้าจัดการเมนู");
      const hidden = prev?.choices.filter((c) => c.active === false && !c.soldOut).map((c) => c.labelTh) || [];
      if (hidden.length) changes.push(`ซ่อน → ปิด: ${hidden.join(", ")}`);
      notes.push(`เดิม [${label(g)}] ${changes.length ? changes.join(" · ") : "ไม่เปลี่ยน (ล้าง field เก่า)"}`);
    }
  }
  return notes;
}

// ราคาทุกแบบที่ลูกค้าสั่งได้ตอนนี้ (แบบเดิม) ต้องเท่ากับราคาหลังแปลงเมื่อเลือกตัวเลือกที่ตรงกัน
function priceProblems(before: MenuItem, after: MenuItem): string[] {
  const problems: string[] = [];
  const group = (id: string) => (after.customGroups || []).find((g) => g.id === id);
  const delta = (gid: string, cid: string) => group(gid)?.choices.find((c) => c.id === cid)?.priceDelta;
  const name = before.name?.th || before.id;
  const expect = (what: string, oldDelta: number, newDelta: number | undefined) => {
    if (newDelta !== oldDelta) problems.push(`${name}: ${what} เดิม +${oldDelta} หลังแปลง ${newDelta === undefined ? "ไม่มี" : `+${newDelta}`}`);
  };
  if (before.hasMeatChoice) MEAT_CHOICES.forEach((m) => expect(m, before.meatPriceDeltas?.[m] || 0, delta(BUILTIN_GROUP_IDS.meat, m)));
  if (before.hasPortion) {
    expect("ธรรมดา", 0, delta(BUILTIN_GROUP_IDS.portion, "regular"));
    expect("พิเศษ", before.portionPriceDelta || 0, delta(BUILTIN_GROUP_IDS.portion, "special"));
  }
  if (before.hasEggAddon !== false) expect("ไข่ดาว", EGG_PRICE, delta(BUILTIN_GROUP_IDS.egg, "egg"));
  if (before.hasPlainAddOns !== false) ADD_ONS.forEach((a) => expect(a.id, a.price, delta(BUILTIN_GROUP_IDS.addOns, a.id)));
  // กลุ่มเดิม: ตัวเลือกและราคาต้องอยู่ครบ
  for (const g of before.customGroups || []) {
    for (const c of g.choices) expect(`${label(g)}/${c.labelTh}`, c.priceDelta, delta(g.id, c.id));
  }
  if (after.price !== before.price) problems.push(`${name}: ราคาเมนูเปลี่ยน`);
  return problems;
}

export function planMigration(backup: BackupFile): MigrationPlan {
  checkBackup(backup);
  const categoryIds = new Set(backup.categoryIds);
  const plan: MigrationPlan = { items: [], unchanged: 0, problems: [] };
  for (const { id, data } of backup.menuItems) {
    const before = fromJson(data) as DocData;
    const item = { id, ...before } as MenuItem;
    const nameTh = item.name?.th || id;
    if (DEMO_ITEM_IDS.includes(id)) {
      if (categoryIds.has(item.categoryId)) {
        plan.problems.push(`${id} (${nameTh}) อยู่ในรายชื่อเมนูตัวอย่าง แต่หมวดของมันมีอยู่จริง — ไม่ลบ ตรวจสอบก่อน`);
      } else {
        plan.items.push({ id, nameTh, action: "delete-demo", before, patch: {}, after: item, notes: ["ลบ (เมนูตัวอย่าง หมวดไม่มีแล้ว)"] });
      }
      continue;
    }
    if (!hasLegacyOptions(item)) { plan.unchanged++; continue; }
    const after = normalizeMenuItem(item);
    const { id: _id, ...afterData } = after;
    const patch = optionPatch(before, afterData as DocData);
    if (Object.keys(patch).length === 0) { plan.unchanged++; continue; }
    plan.problems.push(...priceProblems(item, after));
    plan.items.push({ id, nameTh, action: "convert", before, patch, after, notes: describe(item, after) });
  }
  return plan;
}

// ─── เขียนจริง ───
export interface RunResult {
  done: string[];
  skipped: { id: string; reason: string }[];
}

const toFirestorePatch = (patch: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? deleteField() : v]));

export async function applyMigration(db: Firestore, plan: MigrationPlan, onProgress?: (msg: string) => void): Promise<RunResult> {
  if (plan.problems.length > 0) throw new Error(`แผนมีปัญหา ${plan.problems.length} ข้อ — ไม่เขียนอะไรเลย`);
  const result: RunResult = { done: [], skipped: [] };
  for (const p of plan.items) {
    const ref = doc(db, "menuItems", p.id);
    const outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return "เมนูถูกลบไปแล้วหลังสำรอง";
      if (!same(snap.data(), p.before)) return "เมนูถูกแก้หลังสำรอง (สำรองใหม่แล้วรันอีกครั้ง)";
      if (p.action === "delete-demo") tx.delete(ref);
      else tx.update(ref, toFirestorePatch(p.patch));
      return null;
    });
    if (outcome) result.skipped.push({ id: p.id, reason: outcome });
    else result.done.push(p.id);
    onProgress?.(`${outcome ? "ข้าม" : "✓"} ${p.nameTh}${outcome ? ` — ${outcome}` : ""}`);
  }
  return result;
}

// คืนค่าตามไฟล์สำรอง: field ตัวเลือกกลับเป็นของเดิม (field อื่นที่แก้หลังแปลง เช่น ราคา/สถานะขาย ไม่แตะ)
// เมนูตัวอย่างที่ถูกลบ → สร้างกลับทั้ง doc | เมนูที่ field ตัวเลือกตรงกับสำรองอยู่แล้ว → ไม่เขียน
export async function rollbackMigration(db: Firestore, backup: BackupFile, onProgress?: (msg: string) => void): Promise<RunResult> {
  checkBackup(backup);
  const result: RunResult = { done: [], skipped: [] };
  for (const { id, data } of backup.menuItems) {
    const before = fromJson(data) as DocData;
    const nameTh = (before.name as { th?: string } | undefined)?.th || id;
    const ref = doc(db, "menuItems", id);
    const outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        if (!DEMO_ITEM_IDS.includes(id)) return "ไม่มีเมนูนี้แล้ว (ถูกลบโดยพนักงาน) — ไม่สร้างกลับ";
        tx.set(ref, before);
        return null;
      }
      const restore: Record<string, unknown> = {};
      const current = snap.data();
      for (const k of OPTION_FIELDS) if (!same(current[k], before[k])) restore[k] = before[k];
      if (Object.keys(restore).length === 0) return "ตรงกับสำรองอยู่แล้ว";
      tx.update(ref, toFirestorePatch(restore));
      return null;
    });
    if (outcome) result.skipped.push({ id, reason: outcome });
    else result.done.push(id);
    if (!outcome) onProgress?.(`↺ ${nameTh}`);
  }
  return result;
}

// ใช้ใน test: เขียน backup กลับทั้ง doc (จำลองข้อมูล production บน emulator)
export async function seedFromBackup(db: Firestore, backup: BackupFile): Promise<void> {
  for (const { id, data } of backup.menuItems) await setDoc(doc(db, "menuItems", id), fromJson(data) as DocData);
}
