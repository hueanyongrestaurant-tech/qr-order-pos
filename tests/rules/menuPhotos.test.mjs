// รูปเมนูใน Firestore (src/app/menuPhotos.ts + scripts/menu-photos/core.ts) กับ emulator — ไม่แตะ production
import { readFileSync, existsSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { setTestDb } from "../../src/lib/firebase";
import {
  applyPhotoChange, createMemoryPhotoStore, createPhotoLoader, deletePhotoInBatch, fetchMenuPhotoDoc, hasPhotoSlot, photoVersionOf,
} from "../../src/app/menuPhotos";
import { findCandidates, planRestore, readMenuRows, writeOriginal, writeRestore } from "../../scripts/menu-photos/core";
import { toWebpDataUrl } from "../../scripts/menu-photos/convert";

const WEBP = (n = 2000) => `data:image/webp;base64,${"A".repeat(n)}`;
const SUPA = (id) => `https://ayfwvhgvnbixwfaovlzk.supabase.co/storage/v1/object/public/menu-photos/menuPhotos/${id}.jpg?v=1`;
const item = (id, extra = {}) => ({ categoryId: "c", name: { th: `เมนู ${id}`, en: `Item ${id}` }, description: { th: "", en: "" }, price: 50, photo: "", ...extra });

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const guest = () => env.unauthenticatedContext().firestore();
const staff = () => env.authenticatedContext("staff", { email: "admin@hueanyong.local" }).firestore();
const owner = () => env.authenticatedContext("owner", { email: "owner@hueanyong.local" }).firestore();
const other = () => env.authenticatedContext("x", { email: "someone@gmail.com" }).firestore();
const seed = (fn) => env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
const photoDoc = (extra = {}) => ({ data: WEBP(), version: 5, ...extra });

// ─── rules ───
test("rules: guest can get one photo, cannot list the collection", async () => {
  await seed((db) => setDoc(doc(db, "menuPhotos", "a"), photoDoc()));
  await assertSucceeds(getDoc(doc(guest(), "menuPhotos", "a")));
  await assertSucceeds(getDoc(doc(guest(), "menuPhotos", "missing")));
  await assertFails(getDocs(collection(guest(), "menuPhotos")));
  await assertFails(getDocs(collection(staff(), "menuPhotos")), "list denied for everyone");
});

test("rules: guest / non-shop account cannot write", async () => {
  await seed((db) => setDoc(doc(db, "menuPhotos", "a"), photoDoc()));
  for (const db of [guest(), other()]) {
    await assertFails(setDoc(doc(db, "menuPhotos", "b"), photoDoc()));
    await assertFails(setDoc(doc(db, "menuPhotos", "a"), photoDoc({ version: 6 })));
    await assertFails(deleteDoc(doc(db, "menuPhotos", "a")));
  }
});

test("rules: staff and owner can create / replace / delete", async () => {
  await assertSucceeds(setDoc(doc(staff(), "menuPhotos", "a"), photoDoc({ source: "upload" })));
  await assertSucceeds(setDoc(doc(owner(), "menuPhotos", "a"), photoDoc({ version: 6, data: "data:image/jpeg;base64,/9j/AAAA", temporary: true })));
  await assertSucceeds(deleteDoc(doc(staff(), "menuPhotos", "a")));
});

test("rules: oversize / wrong format / extra fields denied", async () => {
  await assertSucceeds(setDoc(doc(staff(), "menuPhotos", "max"), photoDoc({ data: WEBP(120000 - "data:image/webp;base64,".length) })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "big"), photoDoc({ data: WEBP(120001 - "data:image/webp;base64,".length) })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "png"), photoDoc({ data: "data:image/png;base64,AAAA" })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "url"), photoDoc({ data: "https://evil.example/x.jpg" })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "svg"), photoDoc({ data: "data:image/webp;base64,AA<script>" })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "extra"), photoDoc({ name: "x" })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "nover"), { data: WEBP() }));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "v0"), photoDoc({ version: 0 })));
  await assertFails(setDoc(doc(staff(), "menuPhotos", "src"), photoDoc({ source: "hack" })));
});

// ─── upload / replace / remove (เหมือน handleSaveItem: batch เดียวกับเมนู) ───
async function saveLikeApp(db, id, change, prevVersion, now) {
  setTestDb(db);
  const batch = writeBatch(db);
  const fields = applyPhotoChange(batch, id, change, prevVersion, now);
  batch.set(doc(db, "menuItems", id), { ...item(id, { photo: SUPA(id) }), ...fields });
  await batch.commit();
  return fields;
}

test("upload, replace, remove: menuPhotos + photoVersion in one batch, old Supabase URL untouched", async () => {
  const db = staff();
  const f1 = await saveLikeApp(db, "a", { data: WEBP(100) }, undefined, 1000);
  assert.deepEqual(f1, { photoVersion: 1000 });
  let p = (await getDoc(doc(db, "menuPhotos", "a"))).data();
  assert.equal(p.data, WEBP(100));
  assert.equal(p.version, 1000);
  assert.equal(p.source, "upload");
  assert.equal(p.temporary, undefined);
  let m = (await getDoc(doc(db, "menuItems", "a"))).data();
  assert.equal(m.photoVersion, 1000);
  assert.equal(m.photo, SUPA("a"), "legacy URL kept for the 11 Dec script");
  assert.equal(m.data, undefined, "no photo data in menuItems");

  // แทนรูป: เวอร์ชันเพิ่มเสมอ แม้นาฬิกาเครื่องจะย้อน
  const f2 = await saveLikeApp(db, "a", { data: WEBP(200), temporary: true }, 1000, 500);
  assert.equal(f2.photoVersion, 1001);
  p = (await getDoc(doc(db, "menuPhotos", "a"))).data();
  assert.equal(p.data, WEBP(200));
  assert.equal(p.temporary, true);

  // ไม่แตะรูป: เวอร์ชันเดิม
  assert.deepEqual(await saveLikeApp(db, "a", undefined, 1001), { photoVersion: 1001 });
  assert.equal((await getDoc(doc(db, "menuPhotos", "a"))).data().version, 1001);

  // ลบรูป: doc หาย, photoVersion = 0 (สคริปต์ 11 ธ.ค. ไม่เติมกลับ)
  assert.deepEqual(await saveLikeApp(db, "a", null, 1001), { photoVersion: 0 });
  assert.equal((await getDoc(doc(db, "menuPhotos", "a"))).exists(), false);
  m = (await getDoc(doc(db, "menuItems", "a"))).data();
  assert.equal(m.photoVersion, 0);
  assert.equal(hasPhotoSlot(m), false);

  // อัปใหม่หลังลบ: เวอร์ชันใหม่ไม่ชนของเก่า
  const f3 = await saveLikeApp(db, "a", { data: WEBP(300) }, 0, 2000);
  assert.equal(f3.photoVersion, 2000);
});

test("deleting a menu item deletes its photo in the same batch", async () => {
  const db = staff();
  await saveLikeApp(db, "a", { data: WEBP() }, undefined, 10);
  const batch = writeBatch(db);
  batch.delete(doc(db, "menuItems", "a"));
  deletePhotoInBatch(batch, "a");
  await batch.commit();
  assert.equal((await getDoc(doc(db, "menuPhotos", "a"))).exists(), false);
});

test("guest cannot upload a photo through the app save path", async () => {
  const db = guest();
  setTestDb(db);
  const batch = writeBatch(db);
  applyPhotoChange(batch, "a", { data: WEBP() }, undefined, 10);
  await assertFails(batch.commit());
});

// ─── cache บนเครื่อง ───
function countingFetch(db) {
  const calls = [];
  return {
    calls,
    fetch: async (id) => { calls.push(id); setTestDb(db); return fetchMenuPhotoDoc(id); },
  };
}

test("cache: first visit reads once per photo, returning phone reads nothing", async () => {
  await seed(async (db) => {
    await setDoc(doc(db, "menuPhotos", "a"), photoDoc({ version: 7, data: WEBP(10) }));
    await setDoc(doc(db, "menuPhotos", "b"), photoDoc({ version: 3, data: WEBP(20) }));
  });
  const store = createMemoryPhotoStore(); // = IndexedDB ของเครื่องนั้น
  const f = countingFetch(guest());
  const visit1 = createPhotoLoader(store, f.fetch);
  // หลายจอขอรูปเดียวกันพร้อมกัน (การ์ด + ตะกร้า) = อ่านครั้งเดียว
  const [a1, a2, b1] = await Promise.all([visit1.load("a", 7), visit1.load("a", 7), visit1.load("b", 3)]);
  assert.equal(a1, WEBP(10));
  assert.equal(a2, WEBP(10));
  assert.equal(b1, WEBP(20));
  assert.deepEqual(f.calls.sort(), ["a", "b"]);
  assert.equal(await visit1.load("a", 7), WEBP(10));
  assert.equal(f.calls.length, 2, "same visit: memory hit");

  // เปิดใหม่ (โหลดหน้าเว็บใหม่ = loader ใหม่, IndexedDB เดิม)
  const visit2 = createPhotoLoader(store, f.fetch);
  assert.equal(await visit2.load("a", 7), WEBP(10));
  assert.equal(await visit2.load("b", 3), WEBP(20));
  assert.equal(f.calls.length, 2, "returning phone: zero Firestore reads");
});

test("cache: version bump downloads the new photo once and replaces the old one", async () => {
  await seed((db) => setDoc(doc(db, "menuPhotos", "a"), photoDoc({ version: 7, data: WEBP(10) })));
  const store = createMemoryPhotoStore();
  const f = countingFetch(guest());
  await createPhotoLoader(store, f.fetch).load("a", 7);
  // พนักงานเปลี่ยนรูป
  const s = staff();
  await saveLikeApp(s, "a", { data: WEBP(99) }, 7, 8);
  const visit2 = createPhotoLoader(store, f.fetch);
  assert.equal(await visit2.load("a", 8), WEBP(99));
  assert.equal(f.calls.length, 2);
  assert.equal(store.map.get("a").version, 8, "one version per item kept");
  assert.equal(await createPhotoLoader(store, f.fetch).load("a", 8), WEBP(99));
  assert.equal(f.calls.length, 2, "new version now cached");
});

test("placeholder: no photo / missing doc / offline never throw", async () => {
  assert.equal(hasPhotoSlot({ photo: "", photoVersion: undefined }), false, "never had a photo: plain card");
  assert.equal(hasPhotoSlot({ photo: SUPA("x") }), true, "waiting for 11 Dec: placeholder slot");
  assert.equal(hasPhotoSlot({ photo: SUPA("x"), photoVersion: 0 }), false, "removed by staff");
  assert.equal(hasPhotoSlot({ photo: "", photoVersion: 5 }), true);
  assert.equal(photoVersionOf({ photoVersion: 0 }), null);
  assert.equal(photoVersionOf({}), null);

  const store = createMemoryPhotoStore();
  const f = countingFetch(guest());
  assert.equal(await createPhotoLoader(store, f.fetch).load("nothing", 1), null, "doc missing → placeholder");
  const offline = createPhotoLoader(store, async () => { throw new Error("offline"); });
  assert.equal(await offline.load("a", 1), null, "network error → placeholder");
  const broken = createPhotoLoader(store, async () => ({ data: "https://x/y.jpg", version: 1 }));
  assert.equal(await broken.load("a", 1), null, "not a data:image → placeholder");
  const badStore = { get: async () => { throw new Error("idb"); }, put: async () => { throw new Error("idb"); } };
  await seed((db) => setDoc(doc(db, "menuPhotos", "a"), photoDoc({ version: 1 })));
  assert.equal(await createPhotoLoader(badStore, f.fetch).load("a", 1), WEBP(), "IndexedDB broken → still shows photo");
});

// ─── สคริปต์ย้ายรูป ───
async function seedMenu() {
  await seed(async (db) => {
    await setDoc(doc(db, "menuItems", "new"), item("new", { photo: SUPA("new") }));                            // ยังไม่ย้าย
    await setDoc(doc(db, "menuItems", "removed"), item("removed", { photo: SUPA("removed"), photoVersion: 0 })); // พนักงานลบ
    await setDoc(doc(db, "menuItems", "real"), item("real", { photo: SUPA("real"), photoVersion: 9 }));         // มีรูปจริงแล้ว
    await setDoc(doc(db, "menuPhotos", "real"), photoDoc({ version: 9, source: "upload" }));
    await setDoc(doc(db, "menuItems", "temp"), item("temp", { photo: SUPA("temp"), photoVersion: 4 }));         // รูปชั่วคราว
    await setDoc(doc(db, "menuPhotos", "temp"), photoDoc({ version: 4, temporary: true }));
    await setDoc(doc(db, "menuItems", "plain"), item("plain"));                                                  // ไม่เคยมีรูป
  });
}

test("migration: only items still waiting for their original (or on a temporary photo)", async () => {
  await seedMenu();
  const rows = await readMenuRows(guest());
  const { candidates, skipped } = await findCandidates(guest(), rows);
  assert.deepEqual(candidates.map((c) => [c.row.id, c.reason, c.path]).sort(), [
    ["new", "no-photo-yet", "menuPhotos/new.jpg"],
    ["temp", "temporary", "menuPhotos/temp.jpg"],
  ]);
  assert.deepEqual(skipped.map((s) => s.row.id).sort(), ["real", "removed"]);
});

test("migration: writes photo + version, never overwrites a photo changed meanwhile", async () => {
  await seedMenu();
  const db = owner();
  const rows = await readMenuRows(db);
  const { candidates } = await findCandidates(db, rows);
  const byId = Object.fromEntries(candidates.map((c) => [c.row.id, c]));

  assert.equal(await writeOriginal(db, byId.new, WEBP(50), "cache-recovery", 111), "written");
  const p = (await getDoc(doc(db, "menuPhotos", "new"))).data();
  assert.deepEqual([p.data, p.version, p.source, p.temporary], [WEBP(50), 111, "cache-recovery", undefined]);
  const m = (await getDoc(doc(db, "menuItems", "new"))).data();
  assert.equal(m.photoVersion, 111);
  assert.equal(m.photo, SUPA("new"), "legacy URL untouched");

  // re-run = no-op (version no longer matches the plan)
  assert.equal(await writeOriginal(db, byId.new, WEBP(60), "cache-recovery", 112), "changed");
  // staff replaced the temporary photo with a real one between plan and apply
  await saveLikeApp(staff(), "temp", { data: WEBP(70) }, 4, 5);
  assert.equal(await writeOriginal(db, { row: byId.temp.row, expectVersion: 5 }, WEBP(80), "supabase-original", 113), "changed");
  assert.equal((await getDoc(doc(db, "menuPhotos", "temp"))).data().data, WEBP(70));
});

test("migration: staff account works too, guest is denied", async () => {
  await seedMenu();
  const rows = await readMenuRows(guest());
  const c = (await findCandidates(guest(), rows)).candidates.find((x) => x.row.id === "new");
  await assert.rejects(writeOriginal(guest(), c, WEBP(), "supabase-original", 1));
  assert.equal(await writeOriginal(staff(), c, WEBP(), "supabase-original", 1), "written");
});

test("restore from backup: only items with no photo doc, keeps the backed-up version", async () => {
  await seedMenu();
  await seed((db) => setDoc(doc(db, "menuItems", "lost"), item("lost", { photo: "", photoVersion: 42 }))); // doc รูปหาย
  const manifest = {
    kind: "menu-photos-backup", version: 1, createdAt: "2026-12-01T00:00:00Z",
    items: {
      lost: { file: "photos/lost.webp", version: 42, nameTh: "lost", nameEn: "lost" },
      real: { file: "photos/real.webp", version: 9, nameTh: "real", nameEn: "real" },
      removed: { file: "photos/removed.webp", version: 3, nameTh: "removed", nameEn: "removed" },
      deleted: { file: "photos/deleted.webp", version: 3, nameTh: "deleted", nameEn: "deleted" },
    },
  };
  const db = owner();
  const { restore, skipped } = await planRestore(db, await readMenuRows(db), manifest);
  assert.deepEqual(restore.map((r) => r.row.id), ["lost"]);
  assert.deepEqual(skipped.map((s) => s.id).sort(), ["deleted", "real", "removed"]);
  assert.equal(await writeRestore(db, restore[0].row, WEBP(5), 42), "written");
  const p = (await getDoc(doc(db, "menuPhotos", "lost"))).data();
  assert.deepEqual([p.version, p.source], [42, "restore"]);
  assert.equal(await writeRestore(db, restore[0].row, WEBP(5), 42), "changed", "second run does nothing");
});

test("convert: WebP, ≤ 600px, within the rules limit (target ≤ 40 KB)", async () => {
  const real = new URL("../../../recovered-menu-photos/menuPhotos/1789445978557-3pdco.jpg", import.meta.url);
  const sharp = (await import("sharp")).default;
  const input = existsSync(real)
    ? readFileSync(real)
    : await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg().toBuffer();
  const out = await toWebpDataUrl(input);
  assert.match(out.dataUrl, /^data:image\/webp;base64,/);
  assert.ok(Math.max(out.width, out.height) <= 600);
  assert.ok(out.bytes <= 40 * 1024, `${out.bytes} bytes`);
  assert.ok(out.dataUrl.length <= 120000);
});
