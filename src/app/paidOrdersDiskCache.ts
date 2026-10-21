// ─── cache ออเดอร์ที่ชำระแล้วรายวันบนเครื่อง (IndexedDB) — ใช้กับส่วนวิเคราะห์ "ทั้งหมดที่ผ่านมา" ของหน้าสถิติ ───
// เหตุผล: ดึงทุกออเดอร์ตั้งแต่เปิดร้านทุกครั้งที่เปิดแอป = หลายพัน reads (+ doc เก่าที่ยังมีรูป base64 หนักมาก)
// เก็บเฉพาะวันที่ "ปิดแล้วจริง" (เก่ากว่าเมื่อวาน) — วันนั้นไม่เปลี่ยนอีก ยกเว้นบิลย้อนหลัง ซึ่ง utils.ts เช็คด้วย query เล็กๆ
// ออเดอร์ที่เก็บตัดรูปแล้ว (stripItemPhoto) | IndexedDB เก็บ Date ได้ตรงๆ (structured clone) ไม่ต้องแปลง
// ทุกอย่างพลาดได้เงียบๆ (โหมดส่วนตัว/พื้นที่เต็ม/เบราว์เซอร์ไม่รองรับ) → คืนค่าว่าง ใช้ cache ในหน่วยความจำ + ดึงจาก server ตามเดิม

import type { Order } from "./types";

const DB_NAME = "hueanyong-paid-orders";
const DAYS = "days";   // key = "YYYY-MM-DD" → Order[]
const META = "meta";   // key → ค่า (lastSync: number, firstDay: string)

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DAYS);
        req.result.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) { resolve(undefined); return; }
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

// วันในช่วง [startKey, endKey] ที่มีใน cache
export async function readDiskDays(startKey: string, endKey: string): Promise<Map<string, Order[]>> {
  const out = new Map<string, Order[]>();
  if (startKey > endKey || typeof IDBKeyRange === "undefined") return out;
  const range = IDBKeyRange.bound(startKey, endKey);
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>(DAYS, "readonly", (s) => s.getAllKeys(range)),
    run<Order[][]>(DAYS, "readonly", (s) => s.getAll(range)),
  ]);
  if (!keys || !values || keys.length !== values.length) return out;
  keys.forEach((k, i) => out.set(String(k), values[i]));
  return out;
}

export async function writeDiskDays(days: Map<string, Order[]>): Promise<void> {
  if (days.size === 0) return;
  await run(DAYS, "readwrite", (s) => { days.forEach((orders, k) => s.put(orders, k)); });
}

export async function deleteDiskDays(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await run(DAYS, "readwrite", (s) => { keys.forEach((k) => s.delete(k)); });
}

export async function clearDiskDays(): Promise<void> {
  await run(DAYS, "readwrite", (s) => s.clear());
}

export async function readMeta<T>(key: string): Promise<T | undefined> {
  return run<T>(META, "readonly", (s) => s.get(key));
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await run(META, "readwrite", (s) => s.put(value, key));
}
