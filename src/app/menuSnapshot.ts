// ─── Menu snapshot: เมนู+หมวดที่ลูกค้าเห็น รวมไว้ใน doc เดียว ─────────────────────
// ลูกค้าสแกน QR 1 ครั้ง = อ่าน doc นี้ 1 read แทนการอ่าน menuItems + categories ทุก doc (~120 reads)
// เก็บที่ status/menuSnapshot เพราะ rules ของ /status อ่านได้ทุกคน เขียนได้เฉพาะพนักงานที่ล็อกอินอยู่แล้ว
// (ไม่ต้องแก้ firestore.rules)
//
// ผู้เขียน: เครื่องพนักงานทุกเครื่องที่เปิดอยู่ (ดู effect ใน App.tsx) — คำนวณจากข้อมูลที่ listener
// menuItems/categories มีอยู่ในหน่วยความจำแล้ว ไม่อ่านเพิ่ม แล้วเขียนเฉพาะตอน hash เปลี่ยน
// ข้อมูลเก็บเป็น JSON string ฟิลด์เดียว — เลี่ยงข้อจำกัดชนิดข้อมูลของ Firestore (undefined, array ซ้อน)
// และวัดขนาดได้ตรง

import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Category, MenuItem } from "./types";

const SNAPSHOT_REF = () => doc(db, "status", "menuSnapshot");
// doc Firestore จำกัด 1 MiB — เผื่อที่ให้ฟิลด์อื่น ถ้าเกินนี้ปิด snapshot ให้ลูกค้ากลับไปอ่านแบบเดิม
const MAX_SNAPSHOT_BYTES = 900 * 1024;
const SNAPSHOT_VERSION = 1;

type SnapshotMenuItem = MenuItem & { active?: boolean };

export interface MenuSnapshotData {
  categories: Category[];
  menuItems: SnapshotMenuItem[];
}

export interface BuiltMenuSnapshot {
  json: string;
  hash: string;
  bytes: number;
}

// JSON ที่เรียง key เสมอ — เครื่องพนักงานทุกเครื่องได้ hash เดียวกันจากข้อมูลเดียวกัน (ไม่เขียนซ้ำเพราะลำดับ field ต่างกัน)
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (v as Record<string, unknown>)[k];
        return acc;
      }, {});
    }
    return v;
  });
}

// FNV-1a 32-bit — แค่ไว้เทียบว่าเนื้อหาเปลี่ยนหรือยัง ไม่ใช่ความปลอดภัย
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// เฉพาะที่ลูกค้าเห็น: ไม่เอาหมวด/เมนูที่ซ่อน (เมนู "หมด" ยังอยู่ ลูกค้าต้องเห็นป้ายหมด)
// ตัดรูป base64 ทิ้ง (doc บวม) — รูปที่เป็น URL (Supabase/Unsplash id) เก็บไว้ตามเดิม
export function buildMenuSnapshot(categories: Category[], menuItems: SnapshotMenuItem[]): BuiltMenuSnapshot {
  const data: MenuSnapshotData = {
    categories: categories
      .filter((c) => c.active !== false)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    menuItems: menuItems
      .filter((m) => m.active !== false)
      .map((m) => (typeof m.photo === "string" && m.photo.startsWith("data:") ? { ...m, photo: "" } : m))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  const json = stableStringify(data);
  return { json, hash: fnv1a(json), bytes: new TextEncoder().encode(json).length };
}

// hash ของ snapshot ที่อยู่บน server ตอนนี้ (1 read) — null = ยังไม่มี doc
export async function readMenuSnapshotHash(): Promise<string | null> {
  const snap = await getDoc(SNAPSHOT_REF());
  const hash = snap.data()?.hash;
  return typeof hash === "string" ? hash : null;
}

// ใหญ่เกิน → เขียนเป็น disabled (ไม่มี data) ลูกค้าจะ fallback ไปอ่าน menuItems แบบเดิม ไม่ใช่เห็นเมนูค้าง
// merge: true — ไม่แตะฟิลด์ killSwitch ที่เจ้าของร้านตั้งเองใน Firebase Console (ดู readMenuSnapshot)
export async function writeMenuSnapshot(built: BuiltMenuSnapshot): Promise<void> {
  const base = { version: SNAPSHOT_VERSION, hash: built.hash, bytes: built.bytes, updatedAt: serverTimestamp() };
  if (built.bytes > MAX_SNAPSHOT_BYTES) {
    console.error(`menuSnapshot too large (${built.bytes} bytes) — disabled, customers fall back to menuItems`);
    await setDoc(SNAPSHOT_REF(), { ...base, disabled: true, data: "" }, { merge: true });
    return;
  }
  await setDoc(SNAPSHOT_REF(), { ...base, disabled: false, data: built.json }, { merge: true });
}

// ฝั่งลูกค้า: null = ไม่มี/ปิดอยู่/ข้อมูลเสีย → ผู้เรียกต้อง fallback ไปอ่าน menuItems/categories เอง
// สวิตช์ฉุกเฉินไม่ต้องแก้โค้ด: ใน Firebase Console เพิ่มฟิลด์ killSwitch (boolean) = true ใน status/menuSnapshot
// → ลูกค้าทุกคนกลับไปอ่านแบบเดิมทันที และค้างอยู่อย่างนั้น (แอปไม่เคยเขียนทับฟิลด์นี้) ลบฟิลด์ทิ้ง = เปิดกลับ
export async function readMenuSnapshot(): Promise<MenuSnapshotData | null> {
  const snap = await getDoc(SNAPSHOT_REF());
  const raw = snap.data();
  if (!raw || raw.killSwitch === true || raw.disabled || raw.version !== SNAPSHOT_VERSION || typeof raw.data !== "string") return null;
  try {
    const parsed = JSON.parse(raw.data) as Partial<MenuSnapshotData>;
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.menuItems)) return null;
    if (parsed.categories.length === 0 || parsed.menuItems.length === 0) return null;
    return {
      categories: [...parsed.categories].sort((a, b) => a.order - b.order),
      menuItems: parsed.menuItems,
    };
  } catch {
    return null;
  }
}
