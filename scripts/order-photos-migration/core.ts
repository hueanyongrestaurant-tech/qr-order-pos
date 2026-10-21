// ─── ลบรูป base64 ที่ฝังอยู่ในรายการของออเดอร์เก่า (orders/*.items[].item.photo) ─────────────
// ออเดอร์ก่อน 2026-09-11 เก็บรูปเมนูทั้งรูปไว้ในทุกรายการ (~163KB/ออเดอร์) — หน้าประวัติ/สถิติต้องดาวน์โหลดทั้งหมด
// ออเดอร์ใหม่ไม่มีแล้ว (stripItemPhoto ตอนส่ง) สคริปต์นี้ทำให้ออเดอร์เก่าเหมือนกัน: photo = "" แบบเดียวกับออเดอร์ใหม่
// ไฟล์นี้ไม่ล็อกอิน/ไม่ผูกกับ project ใด: รับ db มาจากผู้เรียก (cli.ts = production, test = emulator)
//
// ความปลอดภัย:
// • แก้เฉพาะ items[i].item.photo ที่ขึ้นต้นด้วย "data:" → "" — ราคา/จำนวน/สถานะ/เวลา/ฟิลด์อื่นทุกตัวไม่แตะ
//   (เขียน field items ทั้งก้อน เพราะ Firestore แก้ element ใน array ตรงๆ ไม่ได้ — ก้อนใหม่ = ก้อนเดิมที่เปลี่ยนแค่ photo)
// • ก่อนลบต้องมีไฟล์สำรอง: เก็บรูปทุกรูปที่จะลบ (รูปซ้ำเก็บครั้งเดียว) + ลายนิ้วมือของออเดอร์ทั้ง doc
//   apply เขียนเฉพาะออเดอร์ที่ข้อมูลตอนนี้ตรงกับตอนสำรองทุกตัวอักษร (เช็คใน transaction) ไม่ตรง = ข้าม ไม่เขียนทับ
// • rollback ใส่รูปกลับเฉพาะรายการที่ตำแหน่ง + cartId ตรงกัน และ photo ยังว่างอยู่
// • รันซ้ำได้: ออเดอร์ที่ลบรูปแล้วไม่มีอะไรต้องเขียน

import { createHash } from "node:crypto";
import { collection, doc, getDocs, runTransaction, type Firestore } from "firebase/firestore";
import { toJson } from "../options-migration/core";

type DocData = Record<string, unknown>;
type Line = { cartId?: unknown; item?: { photo?: unknown } & Record<string, unknown> } & Record<string, unknown>;

export interface PhotoBackupFile {
  kind: "orders-photos-backup";
  version: 1;
  createdAt: string;
  scanned: number;                 // ออเดอร์ทั้งหมดที่อ่าน
  photos: Record<string, string>;  // hash → รูป (data URL) รูปซ้ำเก็บครั้งเดียว
  orders: {
    id: string;
    createdAt: string | null;      // เวลาออเดอร์ (ไว้แสดงใน dry-run)
    fingerprint: string;           // sha256 ของทั้ง doc ตอนสำรอง
    bytes: number;                 // ขนาด doc โดยประมาณ (JSON)
    lines: { index: number; cartId: string; photo: string }[]; // photo = hash
  }[];
  otherDataUrls: string[];         // ออเดอร์ที่มี "data:" อยู่ที่อื่นนอก items[].item.photo (ไม่แตะ แค่รายงาน)
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const fingerprint = (data: unknown) => sha256(JSON.stringify(toJson(data)));
const isDataUrl = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:");

// มี "data:" ที่อื่นในออเดอร์ไหม (ไม่นับ items[].item.photo)
function hasOtherDataUrl(value: unknown, path: string[] = []): boolean {
  if (isDataUrl(value)) return !(path.length === 4 && path[0] === "items" && path[2] === "item" && path[3] === "photo");
  if (Array.isArray(value)) return value.some((v, i) => hasOtherDataUrl(v, [...path, String(i)]));
  if (value && typeof value === "object" && !("toDate" in (value as object))) {
    return Object.entries(value as DocData).some(([k, v]) => hasOtherDataUrl(v, [...path, k]));
  }
  return false;
}

// ─── สำรอง (อ่านทุกออเดอร์ 1 ครั้ง) ───
export async function takePhotoBackup(db: Firestore, now = new Date()): Promise<PhotoBackupFile> {
  const snap = await getDocs(collection(db, "orders"));
  const backup: PhotoBackupFile = {
    kind: "orders-photos-backup", version: 1, createdAt: now.toISOString(),
    scanned: snap.size, photos: {}, orders: [], otherDataUrls: [],
  };
  snap.docs.forEach((d) => {
    const data = d.data();
    if (hasOtherDataUrl(data)) backup.otherDataUrls.push(d.id);
    const items = Array.isArray(data.items) ? (data.items as Line[]) : [];
    const lines: PhotoBackupFile["orders"][number]["lines"] = [];
    items.forEach((ci, index) => {
      const photo = ci?.item?.photo;
      if (!isDataUrl(photo)) return;
      const hash = sha256(photo);
      backup.photos[hash] = photo;
      lines.push({ index, cartId: String(ci.cartId ?? ""), photo: hash });
    });
    if (lines.length === 0) return;
    const created = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
    backup.orders.push({
      id: d.id,
      createdAt: created ? created.toISOString() : null,
      fingerprint: fingerprint(data),
      bytes: JSON.stringify(toJson(data)).length,
      lines,
    });
  });
  backup.orders.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  return backup;
}

export function checkPhotoBackup(backup: PhotoBackupFile): void {
  if (backup?.kind !== "orders-photos-backup" || backup.version !== 1 || !Array.isArray(backup.orders) || !backup.photos) {
    throw new Error("ไฟล์สำรองไม่ถูกต้อง");
  }
  for (const o of backup.orders) {
    for (const l of o.lines) if (!backup.photos[l.photo]) throw new Error(`ไฟล์สำรองไม่ครบ: ไม่มีรูปของ ${o.id}`);
  }
}

// ─── สรุป (ไม่เขียนอะไร) ───
export interface PhotoPlanSummary {
  scanned: number;
  orders: number;
  lines: number;
  distinctPhotos: number;
  bytesBefore: number;   // รวมขนาดออเดอร์ที่จะแก้ ก่อนลบ
  bytesAfter: number;    // หลังลบ (โดยประมาณ)
  firstAt: string | null;
  lastAt: string | null;
}

export function summarizePhotoBackup(backup: PhotoBackupFile): PhotoPlanSummary {
  checkPhotoBackup(backup);
  const bytesBefore = backup.orders.reduce((s, o) => s + o.bytes, 0);
  const removed = backup.orders.reduce((s, o) => s + o.lines.reduce((t, l) => t + backup.photos[l.photo].length, 0), 0);
  const dates = backup.orders.map((o) => o.createdAt).filter((d): d is string => !!d);
  return {
    scanned: backup.scanned,
    orders: backup.orders.length,
    lines: backup.orders.reduce((s, o) => s + o.lines.length, 0),
    distinctPhotos: Object.keys(backup.photos).length,
    bytesBefore,
    bytesAfter: bytesBefore - removed,
    firstAt: dates[0] ?? null,
    lastAt: dates[dates.length - 1] ?? null,
  };
}

// ─── เขียนจริง ───
export interface PhotoRunResult {
  done: string[];
  skipped: { id: string; reason: string }[];
}

export async function applyPhotoStrip(db: Firestore, backup: PhotoBackupFile, onProgress?: (msg: string) => void): Promise<PhotoRunResult> {
  checkPhotoBackup(backup);
  const result: PhotoRunResult = { done: [], skipped: [] };
  for (const [n, o] of backup.orders.entries()) {
    const ref = doc(db, "orders", o.id);
    const outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return "ไม่มีออเดอร์นี้แล้ว";
      const data = snap.data();
      if (fingerprint(data) !== o.fingerprint) return "ออเดอร์ถูกแก้หลังสำรอง (สำรองใหม่แล้วรันอีกครั้ง)";
      const strip = new Set(o.lines.map((l) => l.index));
      const items = (data.items as Line[]).map((ci, i) => (strip.has(i) ? { ...ci, item: { ...ci.item, photo: "" } } : ci));
      tx.update(ref, { items });
      return null;
    });
    if (outcome) result.skipped.push({ id: o.id, reason: outcome });
    else result.done.push(o.id);
    if (outcome) onProgress?.(`ข้าม ${o.id} — ${outcome}`);
    else if ((n + 1) % 25 === 0 || n === backup.orders.length - 1) onProgress?.(`✓ ${n + 1}/${backup.orders.length}`);
  }
  return result;
}

// ใส่รูปกลับตามไฟล์สำรอง — เฉพาะรายการที่ตำแหน่ง + cartId ตรง และ photo ยังเป็น "" (ไม่ทับรูปที่มีอยู่)
export async function rollbackPhotoStrip(db: Firestore, backup: PhotoBackupFile, onProgress?: (msg: string) => void): Promise<PhotoRunResult> {
  checkPhotoBackup(backup);
  const result: PhotoRunResult = { done: [], skipped: [] };
  for (const [n, o] of backup.orders.entries()) {
    const ref = doc(db, "orders", o.id);
    const outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return "ไม่มีออเดอร์นี้แล้ว";
      const items = [...((snap.data().items as Line[]) ?? [])];
      let restored = 0;
      for (const l of o.lines) {
        const ci = items[l.index];
        if (!ci || String(ci.cartId ?? "") !== l.cartId || ci.item?.photo !== "") continue;
        items[l.index] = { ...ci, item: { ...ci.item, photo: backup.photos[l.photo] } };
        restored++;
      }
      if (restored === 0) return "ไม่มีรายการที่ต้องคืน";
      tx.update(ref, { items });
      return null;
    });
    if (outcome) result.skipped.push({ id: o.id, reason: outcome });
    else result.done.push(o.id);
    if ((n + 1) % 25 === 0 || n === backup.orders.length - 1) onProgress?.(`↺ ${n + 1}/${backup.orders.length}`);
  }
  return result;
}

// ─── ขนาดออเดอร์ (อ่านอย่างเดียว) — ใช้ประเมินว่าเปิดหน้าสถิติ "ทั้งหมดที่ผ่านมา" ครั้งแรกต้องดาวน์โหลดเท่าไหร่ ───
// bytes = ขนาด JSON ของข้อมูลจริง (UTF-8) — ที่ส่งผ่านเน็ตจริงมากกว่านี้ราว 1.5–2 เท่า (Firestore ห่อทุกค่าด้วยชนิดข้อมูล)
export interface OrderSizeReport {
  count: number;
  totalBytes: number;
  maxBytes: number;
  byMonth: { month: string; count: number; bytes: number }[];
  largest: { id: string; createdAt: string | null; bytes: number }[];
}

export function measureOrders(docs: { id: string; data: DocData }[], top = 5): OrderSizeReport {
  const months = new Map<string, { count: number; bytes: number }>();
  const sized = docs.map(({ id, data }) => {
    const created = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
    const createdAt = created ? created.toISOString() : null;
    const bytes = Buffer.byteLength(JSON.stringify(toJson(data)), "utf8");
    const month = createdAt ? createdAt.slice(0, 7) : "ไม่มีวันที่";
    const m = months.get(month) ?? { count: 0, bytes: 0 };
    m.count++;
    m.bytes += bytes;
    months.set(month, m);
    return { id, createdAt, bytes };
  });
  return {
    count: sized.length,
    totalBytes: sized.reduce((s, o) => s + o.bytes, 0),
    maxBytes: Math.max(0, ...sized.map((o) => o.bytes)),
    byMonth: [...months].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
    largest: [...sized].sort((a, b) => b.bytes - a.bytes).slice(0, top),
  };
}

export async function measureAllOrders(db: Firestore): Promise<OrderSizeReport> {
  const snap = await getDocs(collection(db, "orders"));
  return measureOrders(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
}
