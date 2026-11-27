// รูปเมนูเก็บใน Firestore (แทน Supabase Storage ตั้งแต่ 25 พ.ย. 69)
// ─────────────────────────────────────────────────────────────────────────────
// • menuPhotos/{itemId} = { data: "data:image/webp;base64,...", version, updatedAt, source?, temporary? }
//   doc แยกจาก menuItems — menuItems เก็บแค่ photoVersion (ไม่มีรูปใน menuItems เด็ดขาด: listener เมนูโหลดทุกครั้งที่เปิดแอป)
// • photoVersion: ไม่มีฟิลด์ = ยังไม่เคยมีรูปในระบบใหม่ (รูปเดิมยังอยู่บน Supabase — สคริปต์ 11 ธ.ค. เติมให้)
//                 0 = พนักงานลบรูปเอง (สคริปต์ 11 ธ.ค. ไม่เติมกลับ) | > 0 = มีรูป (ค่า = เวลาที่อัปโหลด ms ใช้เป็นเลขเวอร์ชัน)
//   เลขเวอร์ชันเปลี่ยนเฉพาะตอนเปลี่ยนรูปจริง — ไม่ใช่การต่อ ?v=Date.now() ตอนแสดงผล
// • เครื่องลูกค้าเก็บรูปไว้ใน IndexedDB ตาม itemId + version → เปิดซ้ำ = ไม่ดาวน์โหลดเลย, เปลี่ยนรูป = เวอร์ชันใหม่ = โหลดใหม่ครั้งเดียว
// • โหลดเฉพาะรูปที่อยู่บนจอ (ดู components/MenuPhoto.tsx) | โหลดไม่ได้ = แสดงช่องว่างสวยๆ สั่งอาหารได้ตามปกติ
// • item.photo (URL Supabase เดิม) ไม่แตะ ไม่ใช้แสดงผลแล้ว — เก็บไว้ให้สคริปต์ 11 ธ.ค. รู้ว่าต้องไปดาวน์โหลดรูปไหน
import { doc, getDoc, serverTimestamp, type WriteBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { MenuItem } from "./types";

export const MENU_PHOTOS = "menuPhotos";
// รูปย่อสำหรับหน้ารายการเมนู/ตะกร้า (ดู loadMenuThumb) — รูปเต็มโหลดเฉพาะตอนเปิดรายละเอียดเมนู
// menuPhotoThumbs/{itemId} = { data, version (= เวอร์ชันรูปเต็มที่ใช้ย่อ), side, updatedAt }
// ไม่มี / เวอร์ชันเก่ากว่า photoVersion (เช่น แอปเวอร์ชันเก่าเปลี่ยนรูป) → หน้ารายการใช้รูปเต็มแทน
export const MENU_PHOTO_THUMBS = "menuPhotoThumbs";
export const THUMB_SIDE = 240; // px ด้านยาว — เปลี่ยนค่า = สคริปต์ menuphotos:thumbs ย่อใหม่ทุกรูป (เช็คจาก side)
export const THUMB_TARGET_BYTES = 15 * 1024;
// ต้องตรงกับ firestore.rules (menuPhotoThumbs: data.size() <= ...)
export const THUMB_MAX_DATA_URL_LENGTH = 30_000;
export const PHOTO_MAX_SIDE = 600; // px ด้านยาว
export const PHOTO_TARGET_BYTES = 40 * 1024; // เป้าขนาดไฟล์ (ไบต์จริง ไม่ใช่ความยาว base64)
// ต้องตรงกับ firestore.rules (menuPhotos: data.size() <= ...) — ความยาวสตริง data URL ทั้งก้อน ≈ 87 KB ไฟล์จริง
export const PHOTO_MAX_DATA_URL_LENGTH = 120_000;

export type PhotoSource = "upload" | "cache-recovery" | "supabase-original" | "restore";
export interface MenuPhotoThumbDoc { data: string; version: number; side?: number; updatedAt?: unknown }
export interface MenuPhotoDoc {
  data: string;
  version: number;
  updatedAt?: unknown;
  source?: PhotoSource;
  temporary?: boolean; // true = รูปชั่วคราว ให้สคริปต์ 11 ธ.ค. แทนด้วยรูปเดิมจาก Supabase
}

// เมนูนี้ควรมี "ช่องรูป" ไหม — มีรูปในระบบใหม่ หรือยังรอรูปเดิมจาก Supabase (แสดงช่องว่างไปก่อน)
// ไม่เคยมีรูปเลย / พนักงานลบรูปแล้ว = การ์ดไม่มีช่องรูป (หน้าตาแบบเดิม)
export function hasPhotoSlot(item: Pick<MenuItem, "photo" | "photoVersion">): boolean {
  if (typeof item.photoVersion === "number") return item.photoVersion > 0;
  return typeof item.photo === "string" && item.photo.startsWith("http");
}

export function photoVersionOf(item: Pick<MenuItem, "photoVersion">): number | null {
  return typeof item.photoVersion === "number" && item.photoVersion > 0 ? item.photoVersion : null;
}

export function isLegacyPhotoUrl(photo: string | undefined): boolean {
  return typeof photo === "string" && photo.startsWith("http");
}

// ─── cache บนเครื่อง ───
export interface PhotoCacheStore {
  get(itemId: string): Promise<{ version: number; data: string } | undefined>;
  put(itemId: string, version: number, data: string): Promise<void>;
}

// เก็บได้รูปละเวอร์ชันเดียวต่อเมนู (key = itemId) — เวอร์ชันใหม่ทับของเก่าเอง cache ไม่โตเรื่อยๆ
export function createIdbPhotoStore(dbName = "menu-photo-cache"): PhotoCacheStore {
  let opening: Promise<IDBDatabase | null> | undefined;
  const open = () => {
    opening ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("photos");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null); // private mode / ถูกปิด — ใช้ได้แค่ cache ในหน่วยความจำ
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return opening;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> => {
    const idb = await open();
    if (!idb) return undefined;
    return new Promise<T | undefined>((resolve) => {
      try {
        const req = fn(idb.transaction("photos", mode).objectStore("photos"));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  };
  return {
    get: (itemId) => run<{ version: number; data: string }>("readonly", (s) => s.get(itemId)),
    put: async (itemId, version, data) => { await run("readwrite", (s) => s.put({ version, data }, itemId)); },
  };
}

export function createMemoryPhotoStore(): PhotoCacheStore & { map: Map<string, { version: number; data: string }> } {
  const map = new Map<string, { version: number; data: string }>();
  return {
    map,
    get: async (id) => map.get(id),
    put: async (id, version, data) => { map.set(id, { version, data }); },
  };
}

// ─── ตัวโหลด ───
// อ่าน Firestore เฉพาะตอน cache บนเครื่องไม่มีเวอร์ชันนี้ | หลายจอขอรูปเดียวกันพร้อมกัน = อ่านครั้งเดียว
// คืน null = ไม่มีรูป/โหลดไม่ได้ (ผู้เรียกแสดงช่องว่าง) — ไม่ throw
// rejectOlder (รูปย่อ): doc เวอร์ชันเก่ากว่าที่ขอ = ถือว่าไม่มี (ผู้เรียกไปใช้รูปเต็มแทน) และจำไว้ทั้ง session ไม่อ่านซ้ำ
export function createPhotoLoader(
  store: PhotoCacheStore,
  fetchDoc: (itemId: string) => Promise<{ data: string; version?: number } | null>,
  opts: { rejectOlder?: boolean } = {},
) {
  const inflight = new Map<string, Promise<string | null>>();
  const memory = new Map<string, { version: number; data: string }>();
  const missing = new Map<string, number>(); // itemId → เวอร์ชันที่ขอแล้วไม่มี (rejectOlder เท่านั้น)
  const load = (itemId: string, version: number): Promise<string | null> => {
    const mem = memory.get(itemId);
    if (mem && mem.version === version) return Promise.resolve(mem.data);
    if (missing.get(itemId) === version) return Promise.resolve(null);
    const key = `${itemId}@${version}`;
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const cached = await store.get(itemId).catch(() => undefined);
        if (cached && cached.version === version && typeof cached.data === "string") {
          memory.set(itemId, cached);
          return cached.data;
        }
        const fresh = await fetchDoc(itemId);
        if (!fresh || typeof fresh.data !== "string" || !fresh.data.startsWith("data:image/")
          || (opts.rejectOlder && !(typeof fresh.version === "number" && fresh.version >= version))) {
          if (opts.rejectOlder) missing.set(itemId, version);
          return null;
        }
        // doc อาจใหม่กว่าเวอร์ชันที่เมนูบอก (เพิ่งเปลี่ยนรูป) — เก็บตามเวอร์ชันของ doc จริง
        const v = typeof fresh.version === "number" ? fresh.version : version;
        const entry = { version: v, data: fresh.data };
        memory.set(itemId, entry);
        await store.put(itemId, v, fresh.data).catch(() => undefined);
        return fresh.data;
      } catch (err) {
        console.warn("menu photo load failed", itemId, err);
        return null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
  // รูปที่อยู่ในหน่วยความจำแล้ว (แสดงทันทีไม่ต้องกระพริบ)
  const peek = (itemId: string, version: number) => {
    const mem = memory.get(itemId);
    return mem && mem.version === version ? mem.data : null;
  };
  return { load, peek };
}

export async function fetchMenuPhotoDoc(itemId: string): Promise<MenuPhotoDoc | null> {
  const snap = await getDoc(doc(db, MENU_PHOTOS, itemId));
  return snap.exists() ? (snap.data() as MenuPhotoDoc) : null;
}

export async function fetchMenuThumbDoc(itemId: string): Promise<MenuPhotoThumbDoc | null> {
  const snap = await getDoc(doc(db, MENU_PHOTO_THUMBS, itemId));
  return snap.exists() ? (snap.data() as MenuPhotoThumbDoc) : null;
}

let _loader: ReturnType<typeof createPhotoLoader> | undefined;
export function menuPhotoLoader() {
  if (!_loader) {
    _loader = createPhotoLoader(createIdbPhotoStore(), fetchMenuPhotoDoc);
    requestPersistentStorage();
  }
  return _loader;
}

let _thumbLoader: ReturnType<typeof createPhotoLoader> | undefined;
export function menuThumbLoader() {
  if (!_thumbLoader) {
    _thumbLoader = createPhotoLoader(createIdbPhotoStore("menu-photo-thumb-cache"), fetchMenuThumbDoc, { rejectOlder: true });
    requestPersistentStorage();
  }
  return _thumbLoader;
}

// รูปย่อก่อน ไม่มี/เก่า → รูปเต็ม (MenuPhoto size="thumb")
export function loadMenuThumb(
  itemId: string,
  version: number,
  thumbs = menuThumbLoader(),
  full = menuPhotoLoader(),
): Promise<string | null> {
  return thumbs.load(itemId, version).then((t) => t ?? full.load(itemId, version));
}

// ขอให้เบราว์เซอร์ไม่ลบ cache รูปเองตอนพื้นที่เหลือน้อย — ครั้งเดียวต่อการเปิดหน้า เงียบๆ ไม่ได้ก็ไม่เป็นไร
// Firefox เด้งหน้าต่างถามผู้ใช้ → ข้าม (ลูกค้าสแกน QR ไม่ควรเจอคำถามแปลกๆ)
// iPhone Safari: ไม่กันการลบข้อมูลเว็บที่ไม่ได้เปิด 7 วัน (ยกเว้นเว็บที่เพิ่มลงหน้าจอโฮม) — แต่ไม่เสียหาย
let persistAsked = false;
export function requestPersistentStorage(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator) {
  if (persistAsked || !nav) return;
  persistAsked = true;
  try {
    if (/firefox|fxios/i.test(nav.userAgent || "")) return;
    const s = nav.storage;
    if (!s?.persist || !s.persisted) return;
    s.persisted().then((already) => (already ? undefined : s.persist())).catch(() => undefined);
  } catch {
    /* ไม่รองรับ — ข้าม */
  }
}

// ─── พนักงานเปลี่ยน/ลบรูป — เขียนลง batch เดียวกับการบันทึกเมนู ───
// change: undefined = ไม่แตะรูป | null = ลบรูป | { data } = รูปใหม่ (บีบอัดแล้ว)
// thumb = รูปย่อ (THUMB_SIDE) เขียนคู่กันใน batch เดียว | original = ไฟล์ที่พนักงานเลือก (ส่งขึ้น Storage ทีหลัง ดู staff/photoOriginals.ts)
export type PhotoChange = undefined | null | { data: string; thumb?: string; temporary?: boolean; original?: File };

// คืนค่าที่ต้องใส่ใน menuItems (photoVersion) — ผู้เรียก spread ลงใน set ของ menuItems
export function applyPhotoChange(
  batch: WriteBatch,
  itemId: string,
  change: PhotoChange,
  prevVersion: number | undefined,
  now = Date.now(),
): { photoVersion?: number } {
  const ref = doc(db, MENU_PHOTOS, itemId);
  const thumbRef = doc(db, MENU_PHOTO_THUMBS, itemId);
  if (change === undefined) return prevVersion === undefined ? {} : { photoVersion: prevVersion };
  if (change === null) {
    batch.delete(ref);
    batch.delete(thumbRef);
    return { photoVersion: 0 };
  }
  // เวอร์ชันต้องเพิ่มขึ้นเสมอ (ลบแล้วอัปใหม่ก็ไม่ชนเวอร์ชันเก่าที่ค้างใน cache เครื่องลูกค้า)
  const version = Math.max(now, (prevVersion ?? 0) + 1);
  batch.set(ref, {
    data: change.data,
    version,
    updatedAt: serverTimestamp(),
    source: "upload",
    ...(change.temporary ? { temporary: true } : {}),
  });
  // ย่อไม่สำเร็จ (ไม่มี thumb) → ลบรูปย่อเก่าทิ้ง หน้ารายการใช้รูปเต็มแทน (ดีกว่าโชว์รูปเก่า)
  if (change.thumb) batch.set(thumbRef, { data: change.thumb, version, side: THUMB_SIDE, updatedAt: serverTimestamp() });
  else batch.delete(thumbRef);
  return { photoVersion: version };
}

// ลบเมนูทั้งตัว — ลบรูปไปด้วยใน batch เดียวกัน
export function deletePhotoInBatch(batch: WriteBatch, itemId: string) {
  batch.delete(doc(db, MENU_PHOTOS, itemId));
  batch.delete(doc(db, MENU_PHOTO_THUMBS, itemId));
}

// ─── บีบอัดในเบราว์เซอร์ ───
export const dataUrlBytes = (dataUrl: string) => {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
};

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// WebP ด้านยาวไม่เกิน 600px ลดคุณภาพทีละขั้นจนไม่เกิน ~40 KB (ยังเกินที่คุณภาพต่ำสุด → ย่อขนาดลงอีก)
// เบราว์เซอร์ที่เข้ารหัส WebP ไม่ได้ (Safari) → ได้ JPEG แทน (rules รับทั้งคู่)
export async function compressMenuPhoto(file: Blob): Promise<string> {
  const img = await loadImage(file);
  let side = PHOTO_MAX_SIDE;
  let best = "";
  for (let round = 0; round < 3; round++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
      let out = canvas.toDataURL("image/webp", q);
      if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", q);
      best = out;
      if (dataUrlBytes(out) <= PHOTO_TARGET_BYTES) return out;
    }
    side = Math.round(side * 0.8);
  }
  if (best.length > PHOTO_MAX_DATA_URL_LENGTH) throw new Error("photo too large after compression");
  return best;
}

// รูปย่อ: ด้านยาว THUMB_SIDE ลดคุณภาพจน ≤ ~15 KB (ส่วนใหญ่ ~5 KB) — WebP, Safari ได้ JPEG
export async function compressMenuThumb(file: Blob): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let best = "";
  for (const q of [0.7, 0.6, 0.5, 0.4]) {
    let out = canvas.toDataURL("image/webp", q);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", q);
    best = out;
    if (dataUrlBytes(out) <= THUMB_TARGET_BYTES) break;
  }
  if (best.length > THUMB_MAX_DATA_URL_LENGTH) throw new Error("thumbnail too large");
  return best;
}
