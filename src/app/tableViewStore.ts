// ─── ลิงก์โต๊ะ (?t=รหัส) + สรุป "ที่สั่งไปแล้ว" ใน Firestore ───────────────────────────────
//
// tableViews/{token} — 1 doc ต่อโต๊ะ: { table, version, data (JSON ของ TableViewData), hash, createdAt, updatedAt }
//  • id ของ doc = รหัสสุ่มในลิงก์/QR — ลูกค้า "get" ได้เฉพาะ doc ที่รู้รหัส แต่ "list" ไม่ได้ (firestore.rules)
//    → คนเปลี่ยน URL เดาโต๊ะอื่นไม่ได้ และห้ามย้ายไปไว้ใน /status (ทุกคน list ได้ = รหัสทุกโต๊ะรั่ว)
//  • สร้างรหัสใหม่ = สร้าง doc ใหม่ + ลบ doc เก่าใน batch เดียว → ลิงก์เก่าใช้ไม่ได้ทันที
//  • เครื่องพนักงานเขียนสรุปด้วย updateDoc เสมอ (ไม่ใช่ setDoc) — เครื่องที่ยังจำรหัสเก่าอยู่จะเขียนไม่สำเร็จ (not-found)
//    แทนที่จะสร้าง doc ของรหัสเก่าขึ้นมาใหม่ให้ลิงก์ที่ถูกยกเลิกกลับมาใช้ได้
//
// status/qrConfig — { legacyTableUrl: boolean } สวิตช์ลิงก์แบบเดิม (?table=1-3) ไม่มี doc/ไม่มีฟิลด์ = เปิด

import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { encodeTableView, newTableToken, TABLE_VIEW_VERSION, type EncodedTableView } from "./tableView";

export const TABLE_VIEWS = "tableViews";
const viewRef = (token: string) => doc(db, TABLE_VIEWS, token);
export const QR_CONFIG_REF = () => doc(db, "status", "qrConfig");

export interface TableLink {
  token: string;
  hash: string; // hash ของสรุปที่อยู่บน server ตอนอ่าน — เครื่องพนักงานเทียบก่อนเขียน
}

// ฝั่งพนักงาน: รหัสของทุกโต๊ะ (อ่านครั้งเดียวตอนเปิดแอป/เปิดหน้าลิงก์โต๊ะ — ไม่ฟังค้าง ไม่มี read ตามทุกการเขียนสรุป)
// โต๊ะเดียวมีหลาย doc (สองเครื่องสร้างพร้อมกัน) — ใช้ตัวที่สร้างล่าสุด
export async function listTableLinks(): Promise<Map<string, TableLink>> {
  const snap = await getDocs(collection(db, TABLE_VIEWS));
  const best = new Map<string, TableLink & { createdMs: number }>();
  snap.docs.forEach((d) => {
    const raw = d.data();
    if (typeof raw.table !== "string") return;
    const createdMs = raw.createdAt?.toMillis ? raw.createdAt.toMillis() : 0;
    const cur = best.get(raw.table);
    if (!cur || createdMs > cur.createdMs) {
      best.set(raw.table, { token: d.id, hash: typeof raw.hash === "string" ? raw.hash : "", createdMs });
    }
  });
  return new Map([...best].map(([table, { token, hash }]) => [table, { token, hash }]));
}

export async function writeTableView(token: string, encoded: EncodedTableView): Promise<void> {
  await updateDoc(viewRef(token), {
    version: TABLE_VIEW_VERSION,
    data: encoded.data,
    hash: encoded.hash,
    updatedAt: serverTimestamp(),
  });
}

// สร้างลิงก์ครั้งแรก หรือสร้างรหัสใหม่แทนของเดิม (oldToken) — สรุปปัจจุบันติดไปกับรหัสใหม่เลย
export async function createTableLink(table: string, oldToken: string | null, encoded: EncodedTableView): Promise<string> {
  const token = newTableToken();
  const batch = writeBatch(db);
  batch.set(viewRef(token), {
    table,
    version: TABLE_VIEW_VERSION,
    data: encoded.data,
    hash: encoded.hash,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (oldToken) batch.delete(viewRef(oldToken));
  await batch.commit();
  return token;
}

export const emptyTableView = (): EncodedTableView => encodeTableView({ lines: [], total: 0, orderIds: [] });

// ─── ฝั่งลูกค้า ───
export interface FetchedTableLink {
  table: string;
  version: unknown;
  data: unknown;
  updatedAtMs: number;
}

// null = ไม่มี doc (รหัสผิด/ถูกยกเลิก) | throw = อ่านไม่ได้ (เน็ต/timeout)
export async function fetchTableLink(token: string, timeoutMs: number): Promise<FetchedTableLink | null> {
  const snap = await withTimeout(getDoc(viewRef(token)), timeoutMs);
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (typeof raw.table !== "string") return null;
  return {
    table: raw.table,
    version: raw.version,
    data: raw.data,
    updatedAtMs: raw.updatedAt?.toMillis ? raw.updatedAt.toMillis() : 0,
  };
}

// อ่านสวิตช์ลิงก์แบบเดิม — อ่านไม่ได้ = ถือว่าเปิด (เป็นสวิตช์หน้าจอ ไม่ใช่ตัวกันความปลอดภัย ห้ามทำให้ลูกค้าสั่งไม่ได้)
export async function readLegacyTableUrlEnabled(timeoutMs: number): Promise<boolean> {
  try {
    const snap = await withTimeout(getDoc(QR_CONFIG_REF()), timeoutMs);
    return snap.data()?.legacyTableUrl !== false;
  } catch {
    return true;
  }
}

export async function setLegacyTableUrlEnabled(enabled: boolean): Promise<void> {
  await setDoc(QR_CONFIG_REF(), { legacyTableUrl: enabled }, { merge: true });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
