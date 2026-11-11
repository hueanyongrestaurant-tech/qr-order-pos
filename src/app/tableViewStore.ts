// ─── ลิงก์โต๊ะ (?t=รหัส) + สรุป "ที่สั่งไปแล้ว" ใน Firestore ───────────────────────────────
//
// tableViews/{token} — 1 doc ต่อโต๊ะ: { table, version, data (JSON ของ TableViewData), hash, createdAt, updatedAt }
//  • id ของ doc = รหัสสุ่มในลิงก์/QR — ลูกค้า "get" ได้เฉพาะ doc ที่รู้รหัส แต่ "list" ไม่ได้ (firestore.rules)
//    → คนเปลี่ยน URL เดาโต๊ะอื่นไม่ได้ และห้ามย้ายไปไว้ใน /status (ทุกคน list ได้ = รหัสทุกโต๊ะรั่ว)
//  • สร้างลิงก์ (createMissingTableLinks) ห้ามแทน/ลบลิงก์ที่มีอยู่เด็ดขาด — QR ที่พิมพ์ติดโต๊ะผูกกับรหัสเดิม
//    เช็คบน server ใน transaction (ล็อกด้วย counters/tableLinkLock) โต๊ะที่มีลิงก์แล้วข้ามไปเฉยๆ
//  • สร้างรหัสใหม่แทนของเดิม (regenerateTableLink) เป็นปุ่มแยก ต้องยืนยันว่า QR ที่พิมพ์ไว้จะใช้ไม่ได้
//    ลบเฉพาะรหัสที่หน้าจอแสดงอยู่ และเฉพาะเมื่อบน server ยังเป็นรหัสนั้นของโต๊ะนั้นจริง
//  • เครื่องพนักงานเขียนสรุปด้วย updateDoc เสมอ (ไม่ใช่ setDoc) — เครื่องที่ยังจำรหัสเก่าอยู่จะเขียนไม่สำเร็จ (not-found)
//    แทนที่จะสร้าง doc ของรหัสเก่าขึ้นมาใหม่ให้ลิงก์ที่ถูกยกเลิกกลับมาใช้ได้
//
// status/qrConfig — { legacyTableUrl: boolean } สวิตช์ลิงก์แบบเดิม (?table=1-3) ไม่มี doc/ไม่มีฟิลด์ = เปิด

import {
  collection, doc, getDoc, getDocFromServer, getDocsFromServer, limit, query, runTransaction, serverTimestamp, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { withTimeout } from "./timeout";
import { encodeTableView, newTableToken, TABLE_VIEW_VERSION, type EncodedTableView } from "./tableView";

export const TABLE_VIEWS = "tableViews";
const viewRef = (token: string) => doc(db, TABLE_VIEWS, token);
export const QR_CONFIG_REF = () => doc(db, "status", "qrConfig");
// ตัวกันชนของการสร้าง/เปลี่ยนลิงก์ — สองเครื่องกดพร้อมกัน transaction ชนกันที่ doc นี้ เครื่องหลังลองใหม่แล้วเห็นลิงก์ของเครื่องแรก
// ไม่ใช่ล็อกที่ "ถือไว้": ไม่มีเครื่องไหนเขียนว่ากำลังถือ แล้วค่อยมาปลดทีหลัง — doc นี้ถูกอ่าน+เขียนใน transaction เดียวกับลิงก์
// (สำเร็จทั้งก้อนหรือไม่เกิดอะไรเลย) เครื่องดับกลางคัน = ไม่มีอะไรถูกเขียน จึงไม่มีทางค้าง ไม่ต้องมีวันหมดอายุ
// ค่าใน doc (seq/lastTable/at) ไม่ถูกใช้ตัดสินอะไร — เนื้อหาเก่า/แปลกแค่ไหนก็สร้างลิงก์ได้ (แบบเดียวกับ TABLE_MOVE_GUARD ของการย้ายโต๊ะ)
// counters = เฉพาะพนักงานอ่าน/เขียน (firestore.rules) ไม่มีรหัสลิงก์อยู่ในนี้
const LINK_LOCK_REF = () => doc(db, "counters", "tableLinkLock");

const nextSeq = (seq: unknown) => (typeof seq === "number" && Number.isFinite(seq) ? seq : 0) + 1;

export interface TableLink {
  token: string;
  hash: string; // hash ของสรุปที่อยู่บน server ตอนอ่าน — เครื่องพนักงานเทียบก่อนเขียน
}

// ฝั่งพนักงาน: รหัสของทุกโต๊ะ (อ่านครั้งเดียวตอนเปิดแอป/เปิดหน้าลิงก์โต๊ะ — ไม่ฟังค้าง ไม่มี read ตามทุกการเขียนสรุป)
// อ่านจาก server เท่านั้น: ออฟไลน์ = throw (ไม่ใช่รายการว่างจาก cache ที่ทำให้ดูเหมือน "ยังไม่มีลิงก์")
// โต๊ะเดียวมีหลาย doc (ข้อมูลเก่าก่อนมีล็อก) — ใช้ตัวที่สร้างล่าสุด
export async function listTableLinks(): Promise<Map<string, TableLink>> {
  const snap = await getDocsFromServer(collection(db, TABLE_VIEWS));
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

const newViewData = (table: string, encoded: EncodedTableView) => ({
  table,
  version: TABLE_VIEW_VERSION,
  data: encoded.data,
  hash: encoded.hash,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

// โต๊ะนี้มีลิงก์บน server แล้วหรือยัง (อ่าน server เท่านั้น — ออฟไลน์ = throw ไม่สร้าง)
async function serverHasLink(table: string): Promise<boolean> {
  const snap = await getDocsFromServer(query(collection(db, TABLE_VIEWS), where("table", "==", table), limit(1)));
  return !snap.empty;
}

export interface CreateLinksResult {
  created: string[];
  skipped: string[]; // มีลิงก์อยู่แล้วบน server — ไม่แตะเลย
}

// สร้างลิงก์ให้โต๊ะที่ยังไม่มีเท่านั้น — ไม่มีทางแทน/ลบลิงก์เดิม
// ทีละโต๊ะใน transaction: อ่านล็อก → เช็ค server ว่าโต๊ะยังไม่มีลิงก์ → เขียนลิงก์ใหม่ + ขยับล็อก
// อีกเครื่องสร้างให้โต๊ะเดียวกันพร้อมกัน: ล็อกเปลี่ยน → transaction นี้ลองใหม่ → เห็นลิงก์ของอีกเครื่อง → ข้าม
export async function createMissingTableLinks(tables: string[], encoded: EncodedTableView = emptyTableView()): Promise<CreateLinksResult> {
  const result: CreateLinksResult = { created: [], skipped: [] };
  for (const table of tables) {
    const made = await runTransaction(db, async (tx) => {
      const lock = await tx.get(LINK_LOCK_REF());
      if (await serverHasLink(table)) return false;
      tx.set(LINK_LOCK_REF(), { seq: nextSeq(lock.data()?.seq), lastTable: table, at: serverTimestamp() });
      tx.set(viewRef(newTableToken()), newViewData(table, encoded));
      return true;
    });
    (made ? result.created : result.skipped).push(table);
  }
  return result;
}

export class LinkChangedError extends Error {
  constructor() {
    super("link-changed");
    this.name = "LinkChangedError";
  }
}

// สร้างรหัสใหม่แทนรหัสเดิมของโต๊ะ (QR ที่พิมพ์ไว้จะใช้ไม่ได้) — เรียกหลังพนักงานยืนยันชัดเจนเท่านั้น
// ลบเฉพาะ oldToken ที่หน้าจอแสดงอยู่ และเฉพาะเมื่อบน server ยังเป็นของโต๊ะนี้ ไม่งั้น LinkChangedError (ไม่แตะอะไร)
export async function regenerateTableLink(table: string, oldToken: string, encoded: EncodedTableView = emptyTableView()): Promise<string> {
  return runTransaction(db, async (tx) => {
    const lock = await tx.get(LINK_LOCK_REF());
    const old = await tx.get(viewRef(oldToken));
    if (!old.exists() || old.data()?.table !== table) throw new LinkChangedError();
    const token = newTableToken();
    tx.set(LINK_LOCK_REF(), { seq: nextSeq(lock.data()?.seq), lastTable: table, at: serverTimestamp() });
    tx.set(viewRef(token), newViewData(table, encoded));
    tx.delete(viewRef(oldToken));
    return token;
  });
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

// ฝั่งพนักงาน (สวิตช์ในหน้าตั้งค่า): อ่านจาก server เท่านั้น อ่านไม่ได้/เกินเวลา = throw ให้หน้าจอขึ้นข้อความ+ลองใหม่
// (ไม่เดาค่า — ต่างจากฝั่งลูกค้าข้างบนที่ถือว่าเปิดไว้ก่อน)
export async function readLegacyTableUrlForStaff(timeoutMs: number): Promise<boolean> {
  const snap = await withTimeout(getDocFromServer(QR_CONFIG_REF()), timeoutMs);
  return snap.data()?.legacyTableUrl !== false;
}

export async function setLegacyTableUrlEnabled(enabled: boolean): Promise<void> {
  await setDoc(QR_CONFIG_REF(), { legacyTableUrl: enabled }, { merge: true });
}
