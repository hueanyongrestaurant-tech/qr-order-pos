// รูปย่อ (menuPhotoThumbs) + persist() — src/app/menuPhotos.ts, scripts/menu-photos/core.ts กับ emulator (ไม่แตะ production)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { setTestDb } from "../../src/lib/firebase";
import {
  THUMB_SIDE, applyPhotoChange, createMemoryPhotoStore, createPhotoLoader, deletePhotoInBatch,
  fetchMenuPhotoDoc, fetchMenuThumbDoc, loadMenuThumb, requestPersistentStorage,
} from "../../src/app/menuPhotos";
import {
  findCandidates, originalTargets, originalTimestamp, originalType, planThumbs, readMenuRows, writeOriginal, writeThumb,
} from "../../scripts/menu-photos/core";
import { dataUrlToBuffer, toThumbDataUrl, toWebpDataUrl } from "../../scripts/menu-photos/convert";
import sharp from "sharp";

const WEBP = (n = 2000) => `data:image/webp;base64,${"A".repeat(n)}`;
const SUPA = (id) => `https://ayfwvhgvnbixwfaovlzk.supabase.co/storage/v1/object/public/menu-photos/menuPhotos/${id}.jpg?v=1`;
const item = (id, extra = {}) => ({ categoryId: "c", name: { th: `เมนู ${id}`, en: `Item ${id}` }, description: { th: "", en: "" }, price: 50, photo: "", ...extra });

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ */ },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const guest = () => env.unauthenticatedContext().firestore();
const staff = () => env.authenticatedContext("staff", { email: "admin@hueanyong.local" }).firestore();
const owner = () => env.authenticatedContext("owner", { email: "owner@hueanyong.local" }).firestore();
const other = () => env.authenticatedContext("x", { email: "someone@gmail.com" }).firestore();
const seed = (fn) => env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
const thumbDoc = (extra = {}) => ({ data: WEBP(500), version: 5, side: 240, ...extra });

// ─── rules ───
test("thumb rules: guest gets one, nobody lists, only shop accounts write", async () => {
  await seed((db) => setDoc(doc(db, "menuPhotoThumbs", "a"), thumbDoc()));
  await assertSucceeds(getDoc(doc(guest(), "menuPhotoThumbs", "a")));
  await assertFails(getDocs(collection(guest(), "menuPhotoThumbs")));
  await assertFails(getDocs(collection(owner(), "menuPhotoThumbs")));
  for (const db of [guest(), other()]) {
    await assertFails(setDoc(doc(db, "menuPhotoThumbs", "b"), thumbDoc()));
    await assertFails(deleteDoc(doc(db, "menuPhotoThumbs", "a")));
  }
  await assertSucceeds(setDoc(doc(staff(), "menuPhotoThumbs", "b"), thumbDoc()));
  await assertSucceeds(setDoc(doc(owner(), "menuPhotoThumbs", "b"), thumbDoc({ version: 6 })));
  await assertSucceeds(deleteDoc(doc(staff(), "menuPhotoThumbs", "b")));
});

test("thumb rules: size limit 30,000, format, fields", async () => {
  const P = "data:image/webp;base64,".length;
  await assertSucceeds(setDoc(doc(staff(), "menuPhotoThumbs", "max"), thumbDoc({ data: WEBP(30000 - P) })));
  await assertFails(setDoc(doc(staff(), "menuPhotoThumbs", "big"), thumbDoc({ data: WEBP(30001 - P) })));
  await assertFails(setDoc(doc(staff(), "menuPhotoThumbs", "png"), thumbDoc({ data: "data:image/png;base64,AAAA" })));
  await assertFails(setDoc(doc(staff(), "menuPhotoThumbs", "extra"), thumbDoc({ source: "upload" })));
  await assertFails(setDoc(doc(staff(), "menuPhotoThumbs", "v0"), thumbDoc({ version: 0 })));
  await assertFails(setDoc(doc(staff(), "menuPhotoThumbs", "side"), thumbDoc({ side: "240" })));
  await assertSucceeds(setDoc(doc(staff(), "menuPhotoThumbs", "noside"), { data: WEBP(10), version: 1 }));
});

// ─── บันทึกแบบแอป ───
async function saveLikeApp(db, id, change, prevVersion, now) {
  setTestDb(db);
  const batch = writeBatch(db);
  const fields = applyPhotoChange(batch, id, change, prevVersion, now);
  batch.set(doc(db, "menuItems", id), { ...item(id, { photo: SUPA(id) }), ...fields });
  await batch.commit();
  return fields;
}

test("app save: thumb written with the same version; replace without thumb removes the old thumb; remove deletes both", async () => {
  const db = staff();
  await saveLikeApp(db, "a", { data: WEBP(100), thumb: WEBP(20) }, undefined, 1000);
  let t = (await getDoc(doc(db, "menuPhotoThumbs", "a"))).data();
  assert.equal(t.data, WEBP(20));
  assert.equal(t.version, 1000);
  assert.equal(t.side, THUMB_SIDE);
  // original (File) ไม่ถูกเขียนลง Firestore
  await saveLikeApp(db, "a", { data: WEBP(110), thumb: WEBP(21), original: { name: "x.jpg", size: 9 } }, 1000, 1500);
  assert.equal((await getDoc(doc(db, "menuPhotos", "a"))).data().original, undefined);
  assert.equal((await getDoc(doc(db, "menuPhotoThumbs", "a"))).data().version, 1500);
  // ย่อไม่สำเร็จ → ไม่มีรูปย่อ (ดีกว่ารูปย่อเก่า)
  await saveLikeApp(db, "a", { data: WEBP(120) }, 1500, 2000);
  assert.equal((await getDoc(doc(db, "menuPhotoThumbs", "a"))).exists(), false);
  await saveLikeApp(db, "a", { data: WEBP(130), thumb: WEBP(22) }, 2000, 3000);
  await saveLikeApp(db, "a", null, 3000);
  assert.equal((await getDoc(doc(db, "menuPhotos", "a"))).exists(), false);
  assert.equal((await getDoc(doc(db, "menuPhotoThumbs", "a"))).exists(), false);
});

test("deleting a menu item deletes photo + thumb", async () => {
  const db = staff();
  await saveLikeApp(db, "a", { data: WEBP(), thumb: WEBP(10) }, undefined, 10);
  const batch = writeBatch(db);
  batch.delete(doc(db, "menuItems", "a"));
  deletePhotoInBatch(batch, "a");
  await batch.commit();
  assert.equal((await getDoc(doc(db, "menuPhotoThumbs", "a"))).exists(), false);
});

// ─── โหลดในหน้ารายการ: รูปย่อก่อน ไม่มี/เก่า → รูปเต็ม ───
function loaders(db) {
  const calls = [];
  const thumbs = createPhotoLoader(createMemoryPhotoStore(), async (id) => { calls.push(`t:${id}`); setTestDb(db); return fetchMenuThumbDoc(id); }, { rejectOlder: true });
  const full = createPhotoLoader(createMemoryPhotoStore(), async (id) => { calls.push(`f:${id}`); setTestDb(db); return fetchMenuPhotoDoc(id); });
  return { calls, thumbs, full };
}

test("list view: thumb when current, full photo when thumb missing or older; misses are remembered", async () => {
  await seed(async (db) => {
    await setDoc(doc(db, "menuPhotos", "a"), { data: WEBP(100), version: 7 });
    await setDoc(doc(db, "menuPhotoThumbs", "a"), thumbDoc({ data: WEBP(10), version: 7 }));
    await setDoc(doc(db, "menuPhotos", "b"), { data: WEBP(200), version: 9 }); // ไม่มีรูปย่อ (ยังไม่รันสคริปต์)
    await setDoc(doc(db, "menuPhotos", "c"), { data: WEBP(300), version: 12 }); // แอปเก่าเปลี่ยนรูป รูปย่อค้างเวอร์ชันเก่า
    await setDoc(doc(db, "menuPhotoThumbs", "c"), thumbDoc({ data: WEBP(30), version: 11 }));
  });
  const db = guest();
  const { calls, thumbs, full } = loaders(db);
  assert.equal(await loadMenuThumb("a", 7, thumbs, full), WEBP(10));
  assert.equal(await loadMenuThumb("b", 9, thumbs, full), WEBP(200));
  assert.equal(await loadMenuThumb("c", 12, thumbs, full), WEBP(300), "stale thumb never shown");
  assert.deepEqual(calls, ["t:a", "t:b", "f:b", "t:c", "f:c"]);
  // จอเดิมเรนเดอร์ซ้ำ (ตะกร้า) — ไม่อ่านอะไรเพิ่ม
  await loadMenuThumb("b", 9, thumbs, full);
  await loadMenuThumb("c", 12, thumbs, full);
  assert.equal(calls.length, 5);
});

// ─── persist() ───
test("persist(): asked once per page", async () => {
  let asked = 0;
  const nav = (ua, persisted = false) => ({
    userAgent: ua,
    storage: { persisted: async () => persisted, persist: async () => { asked++; return true; } },
  });
  requestPersistentStorage(nav("Mozilla/5.0 (iPhone) Safari"));
  requestPersistentStorage(nav("Mozilla/5.0 (iPhone) Safari"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(asked, 1, "once per page");
});

// ─── สคริปต์ thumbs ───
async function realPhoto(w = 1200, h = 900) {
  const jpg = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="#2a6"/><text x="40" y="120" font-size="90">ข้าวผัด</text></svg>`) }])
    .jpeg({ quality: 92 }).toBuffer();
  return jpg;
}

test("thumbs script: plans missing / stale / resized only, writes with the photo's version, skips if the photo changed", async () => {
  const full = await toWebpDataUrl(await realPhoto());
  await seed(async (db) => {
    for (const [id, v] of [["miss", 1], ["ok", 2], ["stale", 3], ["resize", 4], ["moving", 5]]) {
      await setDoc(doc(db, "menuItems", id), item(id, { photoVersion: v }));
      await setDoc(doc(db, "menuPhotos", id), { data: full.dataUrl, version: v });
    }
    await setDoc(doc(db, "menuPhotoThumbs", "ok"), thumbDoc({ version: 2, side: THUMB_SIDE }));
    await setDoc(doc(db, "menuPhotoThumbs", "stale"), thumbDoc({ version: 1, side: THUMB_SIDE }));
    await setDoc(doc(db, "menuPhotoThumbs", "resize"), thumbDoc({ version: 4, side: 200 }));
    await setDoc(doc(db, "menuItems", "none"), item("none", { photoVersion: 0 }));
    await setDoc(doc(db, "menuItems", "old"), item("old", { photo: SUPA("old") })); // ยังรอ 11 ธ.ค.
  });
  const db = guest(); // dry-run อ่านแบบสาธารณะได้
  const rows = await readMenuRows(db);
  const { todo, upToDate, skipped } = await planThumbs(db, rows);
  assert.deepEqual(todo.map((t) => `${t.row.id}:${t.why}`).sort(), ["miss:missing", "moving:missing", "resize:resize", "stale:stale"]);
  assert.equal(upToDate, 1);
  assert.equal(skipped.length, 0);

  const out = await toThumbDataUrl(dataUrlToBuffer(full.dataUrl));
  assert.ok(out.bytes <= 15 * 1024 && Math.max(out.width, out.height) === THUMB_SIDE);
  // guest เขียนไม่ได้
  await assertFails(writeThumb(guest(), "miss", 1, out.dataUrl));
  const s = owner();
  assert.equal(await writeThumb(s, "miss", 1, out.dataUrl), "written");
  // รูปเต็มเปลี่ยนระหว่างรัน
  await seed((d) => setDoc(doc(d, "menuPhotos", "moving"), { data: full.dataUrl, version: 50 }));
  assert.equal(await writeThumb(s, "moving", 5, out.dataUrl), "changed");
  const t = (await getDoc(doc(s, "menuPhotoThumbs", "miss"))).data();
  assert.equal(t.version, 1);
  assert.equal(t.side, THUMB_SIDE);
  // รันซ้ำ: เหลือแค่ที่ยังไม่ได้ทำ
  const again = await planThumbs(db, await readMenuRows(db));
  assert.deepEqual(again.todo.map((x) => x.row.id).sort(), ["resize", "stale"]);
  assert.equal(again.skipped.length, 1, "moving: menu version ≠ photo version → skipped");
});

test("11 Dec: writeOriginal writes the thumb in the same transaction", async () => {
  await seed((db) => setDoc(doc(db, "menuItems", "w"), item("w", { photo: SUPA("w") })));
  const s = owner();
  const rows = await readMenuRows(s);
  const { candidates } = await findCandidates(s, rows);
  assert.equal(await writeOriginal(s, candidates[0], WEBP(50), "supabase-original", 777, WEBP(9)), "written");
  const t = (await getDoc(doc(s, "menuPhotoThumbs", "w"))).data();
  assert.equal(t.version, 777);
  assert.equal(t.data, WEBP(9));
  assert.equal((await getDoc(doc(s, "menuItems", "w"))).data().photoVersion, 777);
});

test("11 Dec: originals target EVERY item with a Supabase URL (hidden, removed, already replaced)", async () => {
  await seed(async (db) => {
    await setDoc(doc(db, "menuItems", "wait"), item("wait", { photo: SUPA("wait") }));
    await setDoc(doc(db, "menuItems", "real"), item("real", { photo: SUPA("real"), photoVersion: 9 }));
    await setDoc(doc(db, "menuItems", "removed"), item("removed", { photo: SUPA("removed"), photoVersion: 0 }));
    await setDoc(doc(db, "menuItems", "hidden"), item("hidden", { photo: SUPA("hidden"), active: false }));
    await setDoc(doc(db, "menuItems", "none"), item("none"));
    await setDoc(doc(db, "menuItems", "data"), item("data", { photo: "data:image/jpeg;base64,AAAA" }));
  });
  const rows = await readMenuRows(guest());
  assert.deepEqual(originalTargets(rows).map((t) => t.row.id).sort(), ["hidden", "real", "removed", "wait"]);
  assert.equal(originalTargets(rows).find((t) => t.row.id === "wait").path, "menuPhotos/wait.jpg");
});

test("11 Dec: original file type + timestamp", () => {
  assert.deepEqual(originalType("menuPhotos/a.jpg", "image/jpeg"), { ext: "jpg", contentType: "image/jpeg" });
  assert.deepEqual(originalType("menuPhotos/a.jpg", "image/png"), { ext: "png", contentType: "image/png" });
  assert.deepEqual(originalType("menuPhotos/a.webp", "application/octet-stream"), { ext: "webp", contentType: "image/webp" });
  assert.deepEqual(originalType("menuPhotos/a", null), { ext: "jpg", contentType: "image/jpeg" });
  assert.equal(originalTimestamp(123, "Wed, 21 Oct 2026 07:28:00 GMT", 1), 123, "display version wins");
  assert.equal(originalTimestamp(undefined, "Wed, 21 Oct 2026 07:28:00 GMT", 1), Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"));
  assert.equal(originalTimestamp(undefined, "garbage", 42), 42);
});
