// โค้ดร่วมของสคริปต์รูปเมนู (ย้ายรูปที่กู้จาก cache, ดึงรูปเดิมจาก Supabase 11 ธ.ค., กู้จาก branch photo-backup)
// ใช้ Firebase Web SDK เหมือนสคริปต์อื่น — test กับ emulator ได้ (tests/rules/menuPhotosMigration.test.mjs)
// อ่าน: menuItems (public) + menuPhotos ทีละ id (public get) | เขียน: ต้องล็อกอินบัญชีร้าน (rules: isStaff)
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

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
): Promise<"written" | "changed" | "gone"> {
  const itemRef = doc(db, "menuItems", c.row.id);
  const photoRef = doc(db, "menuPhotos", c.row.id);
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
