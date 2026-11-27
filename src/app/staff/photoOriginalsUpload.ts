// ตัวส่งต้นฉบับรูปขึ้น Cloud Storage — import แบบ dynamic จาก photoOriginals.ts เท่านั้น
// (firebase/storage ไม่เข้า bundle ของหน้าลูกค้า)
import { connectStorageEmulator, getStorage, ref, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { firebaseApp, usingEmulator } from "../../lib/firebase";
import type { QueuedOriginal } from "./photoOriginals";

let _storage: FirebaseStorage | undefined;
function storage() {
  if (!_storage) {
    _storage = getStorage(firebaseApp);
    if (usingEmulator) connectStorageEmulator(_storage, "127.0.0.1", 9199);
  }
  return _storage;
}

export async function uploadOriginal(e: QueuedOriginal, target: FirebaseStorage = storage()) {
  await uploadBytes(ref(target, e.key), e.blob, {
    contentType: e.contentType,
    customMetadata: {
      itemId: e.itemId,
      photoVersion: String(e.version),
      source: "upload",
      originalName: e.name.slice(0, 200),
    },
  });
}
