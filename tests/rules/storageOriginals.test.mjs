// storage.rules + ตัวส่งต้นฉบับของแอป (photoOriginalsUpload.ts) + ฟังก์ชันสคริปต์ (scripts/menu-photos/storageOriginals.ts)
// กับ Storage emulator เท่านั้น — ไม่แตะ production
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, getMetadata, listAll, ref, uploadBytes } from "firebase/storage";
import { uploadOriginal } from "../../src/app/staff/photoOriginalsUpload";
import { createMemoryOriginalsStore, createOriginalsQueue } from "../../src/app/staff/photoOriginals";
import { downloadOriginal, hasSupabaseOriginal, listOriginals, uploadSupabaseOriginal } from "../../scripts/menu-photos/storageOriginals";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    storage: { rules: readFileSync(new URL("../../../storage.rules", import.meta.url), "utf8") /* รันจาก out/ */ },
  });
});
after(async () => { await env?.cleanup(); });
// clearStorage ของ emulator ไม่ล้างไฟล์ระหว่าง test — ใช้ id เมนูไม่ซ้ำกันแทน
let seq = 0;
let A, B;
beforeEach(() => { seq++; A = `a${seq}-${Date.now()}`; B = `b${seq}-${Date.now()}`; });

// modular instance จาก context ของ rules-unit-testing (มี token ของบัญชีนั้นอยู่แล้ว)
const st = (ctx) => ctx.storage()._delegate ?? ctx.storage();
const guest = () => st(env.unauthenticatedContext());
const staff = () => st(env.authenticatedContext("staff", { email: "admin@hueanyong.local" }));
const owner = () => st(env.authenticatedContext("owner", { email: "owner@hueanyong.local" }));
const other = () => st(env.authenticatedContext("x", { email: "someone@gmail.com" }));

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const put = (s, path, data = JPG, contentType = "image/jpeg") => uploadBytes(ref(s, path), data, { contentType });

test("storage rules: staff + owner create images under photo-originals/; guests and other accounts cannot", async () => {
  await assertSucceeds(put(staff(), `photo-originals/${A}/1.jpg`));
  await assertSucceeds(put(owner(), `photo-originals/${A}/2.heic`, JPG, "image/heic"));
  await assertFails(put(guest(), `photo-originals/${A}/3.jpg`));
  await assertFails(put(other(), `photo-originals/${A}/4.jpg`));
});

test("storage rules: images only, < 25 MB, not empty", async () => {
  await assertFails(put(staff(), `photo-originals/${A}/x.txt`, JPG, "text/plain"));
  await assertFails(put(staff(), `photo-originals/${A}/x.html`, JPG, "text/html"));
  await assertFails(put(staff(), `photo-originals/${A}/empty.jpg`, new Uint8Array(0)));
  await assertSucceeds(put(staff(), `photo-originals/${A}/ok.jpg`, new Uint8Array(25 * 1024 * 1024 - 1)));
  await assertFails(put(staff(), `photo-originals/${A}/big.jpg`, new Uint8Array(25 * 1024 * 1024)));
});

test("storage rules: no overwrite, no delete — for anyone", async () => {
  await assertSucceeds(put(staff(), `photo-originals/${A}/1.jpg`));
  await assertFails(put(staff(), `photo-originals/${A}/1.jpg`, new Uint8Array([9, 9, 9])));
  await assertFails(put(owner(), `photo-originals/${A}/1.jpg`, new Uint8Array([9, 9, 9])));
  await assertFails(deleteObject(ref(staff(), `photo-originals/${A}/1.jpg`)));
  await assertFails(deleteObject(ref(owner(), `photo-originals/${A}/1.jpg`)));
  assert.deepEqual([...new Uint8Array(await getBytes(ref(owner(), `photo-originals/${A}/1.jpg`)))], [...JPG], "original untouched");
});

test("storage rules: read + list = owner only", async () => {
  await assertSucceeds(put(staff(), `photo-originals/${A}/1.jpg`));
  await assertSucceeds(getBytes(ref(owner(), `photo-originals/${A}/1.jpg`)));
  await assertSucceeds(listAll(ref(owner(), "photo-originals")));
  for (const s of [staff(), guest(), other()]) {
    await assertFails(getBytes(ref(s, `photo-originals/${A}/1.jpg`)));
    await assertFails(getMetadata(ref(s, `photo-originals/${A}/1.jpg`)));
    await assertFails(listAll(ref(s, "photo-originals")));
  }
});

test("storage rules: every other path denied", async () => {
  for (const s of [staff(), owner()]) {
    await assertFails(put(s, "menu/1.jpg"));
    await assertFails(put(s, "photo-originals/1.jpg"), "must be inside an item folder");
    await assertFails(put(s, `photo-originals/${A}/b/1.jpg`), "no deeper folders");
  }
});

test("app: queued original uploads with the version name + metadata; owner sees it", async () => {
  const s = staff();
  const store = createMemoryOriginalsStore();
  const q = createOriginalsQueue(store, (e) => uploadOriginal(e, s));
  const blob = new Blob([JPG], { type: "image/jpeg" });
  Object.defineProperty(blob, "name", { value: "IMG_2026.jpg" });
  assert.equal(await q.enqueue(A, 1786896096865, blob), "queued");
  assert.deepEqual(await q.flush(), { uploaded: 1, failed: 0 });
  assert.equal(store.map.size, 0);
  const m = await getMetadata(ref(owner(), `photo-originals/${A}/1786896096865.jpg`));
  assert.equal(m.size, JPG.length, "same size — not compressed");
  assert.equal(m.contentType, "image/jpeg");
  assert.equal(m.customMetadata.originalName, "IMG_2026.jpg");
  assert.equal(m.customMetadata.photoVersion, "1786896096865");
  assert.equal(m.customMetadata.source, "upload");
});

test("app: guest upload fails as 'unauthorized' and stays queued", async () => {
  const store = createMemoryOriginalsStore();
  const q = createOriginalsQueue(store, (e) => uploadOriginal(e, guest()));
  await q.enqueue(A, 5, new Blob([JPG], { type: "image/jpeg" }));
  assert.deepEqual(await q.flush(), { uploaded: 0, failed: 1 });
  assert.equal(q.getState().lastError, "unauthorized");
  assert.equal(store.map.size, 1);
});

test("script: Supabase originals upload once (re-run skips), owner lists + downloads everything", async () => {
  const o = owner();
  const data = new Uint8Array(JPG);
  assert.equal(await hasSupabaseOriginal(o, A, "menuPhotos/a.jpg"), false);
  const p = await uploadSupabaseOriginal(o, { itemId: A, timestamp: 1700000000000, ext: "jpg", contentType: "image/jpeg", supabasePath: "menuPhotos/a.jpg", data });
  assert.equal(p, `photo-originals/${A}/1700000000000.jpg`);
  assert.equal(await hasSupabaseOriginal(o, A, "menuPhotos/a.jpg"), true);
  assert.equal(await hasSupabaseOriginal(o, A, "menuPhotos/a.v2.jpg"), false, "a different Supabase file is not the same original");
  await put(staff(), `photo-originals/${B}/5.png`, JPG, "image/png");
  const all = await listOriginals(o);
  const mine = all.filter((f) => f.itemId === A || f.itemId === B);
  assert.deepEqual(mine.map((f) => f.path), [`photo-originals/${A}/1700000000000.jpg`, `photo-originals/${B}/5.png`]);
  assert.deepEqual(mine.map((f) => f.itemId), [A, B]);
  assert.deepEqual([...new Uint8Array(await downloadOriginal(o, mine[1].path))], [...JPG]);
  await assert.rejects(listOriginals(staff()), "staff cannot list");
});
