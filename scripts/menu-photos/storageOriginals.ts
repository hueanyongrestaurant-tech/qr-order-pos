// ต้นฉบับรูปใน Cloud Storage (photo-originals/) สำหรับสคริปต์ — อัป (บัญชีร้าน) / list + ดาวน์โหลด (เจ้าของเท่านั้น)
// storage.rules: create = isStaff, read/list = isOwner, ทับ/ลบไม่ได้
import { getBytes, getMetadata, listAll, ref, uploadBytes, type FirebaseStorage } from "firebase/storage";

export const ORIGINALS_PREFIX = "photo-originals";

export interface StoredOriginal { path: string; itemId: string; name: string }

// ทุกไฟล์ใต้ photo-originals/ (2 ชั้น: {itemId}/{ไฟล์})
export async function listOriginals(storage: FirebaseStorage): Promise<StoredOriginal[]> {
  const top = await listAll(ref(storage, ORIGINALS_PREFIX));
  const out: StoredOriginal[] = [];
  for (const p of top.prefixes) {
    const inner = await listAll(p);
    for (const f of inner.items) out.push({ path: f.fullPath, itemId: p.name, name: f.name });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ต้นฉบับจาก Supabase ไฟล์นี้ (supabasePath) เคยอัปให้เมนูนี้แล้วหรือยัง — รันซ้ำได้ไม่อัปซ้ำ
export async function hasSupabaseOriginal(storage: FirebaseStorage, itemId: string, supabasePath: string): Promise<boolean> {
  const list = await listAll(ref(storage, `${ORIGINALS_PREFIX}/${itemId}`));
  for (const f of list.items) {
    const m = await getMetadata(f);
    if (m.customMetadata?.supabasePath === supabasePath) return true;
  }
  return false;
}

export async function uploadSupabaseOriginal(
  storage: FirebaseStorage,
  o: { itemId: string; timestamp: number; ext: string; contentType: string; supabasePath: string; data: Uint8Array },
): Promise<string> {
  const path = `${ORIGINALS_PREFIX}/${o.itemId}/${o.timestamp}.${o.ext}`;
  await uploadBytes(ref(storage, path), o.data, {
    contentType: o.contentType,
    customMetadata: { itemId: o.itemId, source: "supabase-original", supabasePath: o.supabasePath },
  });
  return path;
}

export async function downloadOriginal(storage: FirebaseStorage, path: string): Promise<ArrayBuffer> {
  return getBytes(ref(storage, path));
}
