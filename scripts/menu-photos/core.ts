// โค้ดร่วมของสคริปต์รูปเมนู (ย้ายรูปที่กู้จาก cache, ดึงรูปเดิมจาก Supabase 11 ธ.ค., กู้จาก branch photo-backup)
// ใช้ Firebase Web SDK เหมือนสคริปต์อื่น — test กับ emulator ได้ (tests/rules/menuPhotosMigration.test.mjs)
// อ่าน: menuItems (public) + menuPhotos ทีละ id (public get) | เขียน: ต้องล็อกอินบัญชีร้าน (rules: isStaff)
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import { THUMB_SIDE } from "./convert";

export const MENU_PHOTO_THUMBS = "menuPhotoThumbs";

export const SUPABASE_PHOTO_MARK = "/storage/v1/object/public/menu-photos/";

export interface MenuRow {
  id: string;
  nameTh: string;
  nameEn: string;
  photo: string; // URL Supabase เดิม ("" = ไม่มี)
  photoVersion: number | undefined;
  active: boolean;
}

export interface PhotoDocInfo { version: number; temporary: boolean; source?: string; bytes: number }

export async function readMenuRows(db: Firestore): Promise<MenuRow[]> {
  const snap = await getDocs(collection(db, "menuItems"));
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, any>;
    return {
      id: d.id,
      nameTh: x.name?.th ?? "",
      nameEn: x.name?.en ?? "",
      photo: typeof x.photo === "string" ? x.photo : "",
      photoVersion: typeof x.photoVersion === "number" ? x.photoVersion : undefined,
      active: x.active !== false,
    };
  }).sort((a, b) => a.nameTh.localeCompare(b.nameTh, "th"));
}

export async function readPhotoInfo(db: Firestore, id: string): Promise<PhotoDocInfo | null> {
  const s = await getDoc(doc(db, "menuPhotos", id));
  if (!s.exists()) return null;
  const x = s.data() as Record<string, any>;
  return { version: x.version, temporary: x.temporary === true, source: x.source, bytes: typeof x.data === "string" ? x.data.length : 0 };
}

// path ในบัคเก็ต (เช่น "menuPhotos/1786896096865-77v1p.jpg") จาก URL Supabase เดิม — ไม่ใช่ URL Supabase = null
export function supabasePath(url: string): string | null {
  const i = url.indexOf(SUPABASE_PHOTO_MARK);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + SUPABASE_PHOTO_MARK.length).split("?")[0]);
}

// ต้องเติมรูปเดิมไหม: ยังไม่เคยมีรูปในระบบใหม่ (photoVersion ไม่มี) หรือรูปตอนนี้ติดธง "ชั่วคราว"
// photoVersion 0 = พนักงานลบรูปเอง → ไม่เติมกลับ | มีรูปจริงที่ไม่ใช่ชั่วคราว → ไม่ทับ
export type NeedReason = "no-photo-yet" | "temporary";
export function needsOriginal(row: MenuRow, info: PhotoDocInfo | null): NeedReason | null {
  if (!supabasePath(row.photo)) return null;
  if (row.photoVersion === undefined) return "no-photo-yet";
  if (row.photoVersion > 0 && info?.temporary) return "temporary";
  return null;
}

export interface Candidate { row: MenuRow; path: string; reason: NeedReason; expectVersion: number | undefined }

// อ่าน menuPhotos เฉพาะเมนูที่มีรูปอยู่แล้วและอาจเป็นรูปชั่วคราว (ไม่ list ทั้ง collection — rules ห้าม)
export async function findCandidates(db: Firestore, rows: MenuRow[]): Promise<{ candidates: Candidate[]; skipped: { row: MenuRow; why: string }[] }> {
  const candidates: Candidate[] = [];
  const skipped: { row: MenuRow; why: string }[] = [];
  for (const row of rows) {
    const path = supabasePath(row.photo);
    if (!path) continue;
    const info = row.photoVersion && row.photoVersion > 0 ? await readPhotoInfo(db, row.id) : null;
    const reason = needsOriginal(row, info);
    if (reason) candidates.push({ row, path, reason, expectVersion: row.photoVersion });
    else skipped.push({ row, why: row.photoVersion === 0 ? "พนักงานลบรูปแล้ว" : "มีรูปจริงแล้ว" });
  }
  return { candidates, skipped };
}

// เขียนรูป 1 เมนู: menuPhotos + photoVersion ใน transaction — ข้ามถ้ามีคนเปลี่ยนรูประหว่างรัน
// (photoVersion ไม่ตรงกับตอนวางแผน หรือรูปไม่ใช่ชั่วคราวแล้ว)
export async function writeOriginal(
  db: Firestore,
  c: Pick<Candidate, "row" | "expectVersion">,
  data: string,
  source: "cache-recovery" | "supabase-original",
  version = Date.now(),
  thumb?: string, // รูปย่อ (menuPhotoThumbs) เขียนใน transaction เดียวกัน | ไม่มี = ลบรูปย่อเก่า (สคริปต์ thumbs เติมทีหลัง)
): Promise<"written" | "changed" | "gone"> {
  const itemRef = doc(db, "menuItems", c.row.id);
  const photoRef = doc(db, "menuPhotos", c.row.id);
  const thumbRef = doc(db, MENU_PHOTO_THUMBS, c.row.id);
  return runTransaction(db, async (tx) => {
    const item = await tx.get(itemRef);
    if (!item.exists()) return "gone";
    const current = item.data().photoVersion;
    if (current !== c.expectVersion) return "changed";
    if (typeof current === "number" && current > 0) {
      const p = await tx.get(photoRef);
      if (p.exists() && p.data().temporary !== true) return "changed";
    }
    tx.set(photoRef, { data, version, updatedAt: serverTimestamp(), source });
    if (thumb) tx.set(thumbRef, { data: thumb, version, side: THUMB_SIDE, updatedAt: serverTimestamp() });
    else tx.delete(thumbRef);
    tx.update(itemRef, { photoVersion: version });
    return "written";
  });
}

// ─── กู้จาก branch photo-backup ───
export interface BackupManifest {
  kind: "menu-photos-backup";
  version: 1;
  createdAt: string;
  items: Record<string, { file: string; version: number; nameTh: string; nameEn: string; source?: string; temporary?: boolean }>;
}

// กู้เฉพาะเมนูที่ยังมีอยู่และ "ไม่มี doc รูป" ตอนนี้ — รูปที่มีอยู่ (อาจใหม่กว่าไฟล์สำรอง) ไม่ทับ
// ใช้เลขเวอร์ชันเดิมจากไฟล์สำรอง → เครื่องลูกค้าที่ cache รูปเวอร์ชันนั้นไว้ไม่ต้องโหลดใหม่
export async function planRestore(db: Firestore, rows: MenuRow[], manifest: BackupManifest) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const restore: { row: MenuRow; file: string; version: number }[] = [];
  const skipped: { id: string; name: string; why: string }[] = [];
  for (const [id, m] of Object.entries(manifest.items)) {
    const row = byId.get(id);
    if (!row) { skipped.push({ id, name: m.nameTh, why: "ไม่มีเมนูนี้แล้ว" }); continue; }
    if (row.photoVersion === 0) { skipped.push({ id, name: row.nameTh, why: "พนักงานลบรูปแล้ว" }); continue; }
    const info = await readPhotoInfo(db, id);
    if (info) { skipped.push({ id, name: row.nameTh, why: "มีรูปอยู่แล้ว" }); continue; }
    restore.push({ row, file: m.file, version: m.version });
  }
  return { restore, skipped };
}

export async function writeRestore(db: Firestore, row: MenuRow, data: string, version: number): Promise<"written" | "changed" | "gone"> {
  const itemRef = doc(db, "menuItems", row.id);
  const photoRef = doc(db, "menuPhotos", row.id);
  return runTransaction(db, async (tx) => {
    const item = await tx.get(itemRef);
    if (!item.exists()) return "gone";
    if ((await tx.get(photoRef)).exists()) return "changed";
    tx.set(photoRef, { data, version, updatedAt: serverTimestamp(), source: "restore" });
    tx.update(itemRef, { photoVersion: version });
    return "written";
  });
}

// ─── รูปย่อ (menuPhotoThumbs) ───
// ต้องย่อใหม่: มีรูป (photoVersion > 0) และรูปย่อไม่มี / เวอร์ชันไม่ตรงรูปเต็ม / ขนาด side ไม่ตรง THUMB_SIDE
// อ่าน menuPhotos + menuPhotoThumbs ทีละ id (public get) — ไม่ list collection
export interface ThumbTask { row: MenuRow; version: number; photoData: string; why: "missing" | "stale" | "resize" }
export async function planThumbs(db: Firestore, rows: MenuRow[]) {
  const todo: ThumbTask[] = [];
  let upToDate = 0;
  const skipped: { row: MenuRow; why: string }[] = [];
  for (const row of rows) {
    if (!(row.photoVersion && row.photoVersion > 0)) continue;
    const p = await getDoc(doc(db, "menuPhotos", row.id));
    const pd = p.exists() ? (p.data() as Record<string, any>) : null;
    if (!pd || typeof pd.data !== "string") { skipped.push({ row, why: "ไม่มี doc รูปเต็ม" }); continue; }
    if (pd.version !== row.photoVersion) { skipped.push({ row, why: "เวอร์ชันรูปเต็มไม่ตรงเมนู (กำลังเปลี่ยนรูป?)" }); continue; }
    const t = await getDoc(doc(db, MENU_PHOTO_THUMBS, row.id));
    const td = t.exists() ? (t.data() as Record<string, any>) : null;
    const why = !td ? "missing" : td.version !== pd.version ? "stale" : td.side !== THUMB_SIDE ? "resize" : null;
    if (why) todo.push({ row, version: pd.version, photoData: pd.data, why });
    else upToDate++;
  }
  return { todo, upToDate, skipped };
}

// เขียนรูปย่อ — ข้ามถ้ารูปเต็มเปลี่ยนเวอร์ชันระหว่างรัน
export async function writeThumb(db: Firestore, itemId: string, version: number, data: string): Promise<"written" | "changed"> {
  const photoRef = doc(db, "menuPhotos", itemId);
  const thumbRef = doc(db, MENU_PHOTO_THUMBS, itemId);
  return runTransaction(db, async (tx) => {
    const p = await tx.get(photoRef);
    if (!p.exists() || p.data().version !== version) return "changed";
    tx.set(thumbRef, { data, version, side: THUMB_SIDE, updatedAt: serverTimestamp() });
    return "written";
  });
}

// ─── 11 ธ.ค.: ต้นฉบับทุกรูปจาก Supabase → Storage photo-originals/ ───
// ทุกเมนูที่มี URL Supabase (รวมเมนูที่ซ่อน / พนักงานลบรูป / มีรูปจริงแล้ว) — ไม่ใช่เฉพาะที่ต้องเติมรูปแสดงผล
export function originalTargets(rows: MenuRow[]): { row: MenuRow; path: string }[] {
  return rows.flatMap((row) => {
    const path = supabasePath(row.photo);
    return path ? [{ row, path }] : [];
  });
}

const EXT_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic" };
// นามสกุล/ชนิดไฟล์ของต้นฉบับ: เชื่อ content-type จาก server ก่อน แล้วค่อยดูนามสกุลใน path
export function originalType(supaPath: string, contentType: string | null): { ext: string; contentType: string } {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const nameExt = supaPath.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "";
  if (ct.startsWith("image/")) {
    const byType = Object.entries(EXT_TYPES).find(([, t]) => t === ct)?.[0];
    const ext = byType ?? (nameExt || "img");
    return { ext: ext === "jpeg" ? "jpg" : ext, contentType: ct };
  }
  if (EXT_TYPES[nameExt]) return { ext: nameExt === "jpeg" ? "jpg" : nameExt, contentType: EXT_TYPES[nameExt] };
  return { ext: "jpg", contentType: "image/jpeg" };
}

// ชื่อไฟล์ใน Storage: เวอร์ชันรูปที่เพิ่งเขียน (ถ้าเมนูนี้ได้รูปแสดงผลรอบนี้) ไม่งั้นเวลาที่ไฟล์ถูกอัปขึ้น Supabase (Last-Modified)
export function originalTimestamp(newVersion: number | undefined, lastModified: string | null, fallback: number): number {
  if (newVersion) return newVersion;
  const t = lastModified ? Date.parse(lastModified) : NaN;
  return Number.isFinite(t) && t > 0 ? t : fallback;
}
