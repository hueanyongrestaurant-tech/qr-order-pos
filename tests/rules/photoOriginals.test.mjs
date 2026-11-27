// คิวต้นฉบับรูป (src/app/staff/photoOriginals.ts) — ตรรกะล้วน ใช้ memory store + ตัวส่งปลอม
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORIGINAL_MAX_BYTES, UNAUTHORIZED_RETRY_MS, checkOriginal, createMemoryOriginalsStore, createOriginalsQueue,
  errorKind, originalFileInfo, originalPath,
} from "../../src/app/staff/photoOriginals";

const fakeFile = (name, type, size = 3_000_000) => ({ name, type, size, slice() {} });

test("file info: extension + content type from type, then name, then jpg", () => {
  assert.deepEqual(originalFileInfo({ name: "IMG_1.JPG", type: "image/jpeg" }), { ext: "jpg", contentType: "image/jpeg" });
  assert.deepEqual(originalFileInfo({ name: "a.heic", type: "image/heic" }), { ext: "heic", contentType: "image/heic" });
  assert.deepEqual(originalFileInfo({ name: "a.png", type: "" }), { ext: "png", contentType: "image/png" });
  assert.deepEqual(originalFileInfo({ name: "photo", type: "" }), { ext: "jpg", contentType: "image/jpeg" });
  assert.deepEqual(originalFileInfo({ name: "x.jpeg", type: "application/octet-stream" }), { ext: "jpg", contentType: "image/jpeg" });
  assert.equal(originalPath("item1", 1786896096865, "jpg"), "photo-originals/item1/1786896096865.jpg");
});

test("size check: < 25 MB queued, ≥ 25 MB / empty refused (matches storage.rules)", () => {
  assert.equal(checkOriginal({ size: ORIGINAL_MAX_BYTES - 1 }), "queued");
  assert.equal(checkOriginal({ size: ORIGINAL_MAX_BYTES }), "too-large");
  assert.equal(checkOriginal({ size: 0 }), "empty");
});

test("error kinds", () => {
  assert.equal(errorKind({ code: "storage/unauthorized" }), "unauthorized");
  assert.equal(errorKind({ code: "storage/retry-limit-exceeded" }), "network");
  assert.equal(errorKind(new TypeError("Failed to fetch")), "network");
  assert.equal(errorKind({ code: "storage/quota-exceeded" }), "storage/quota-exceeded");
});

function setup() {
  const store = createMemoryOriginalsStore();
  const sent = [];
  let fail = null; // null | (e) => error
  let t = 1_000_000;
  const q = createOriginalsQueue(store, async (e) => {
    const err = fail?.(e);
    if (err) throw err;
    sent.push(e.key);
  }, () => t);
  return { store, sent, q, setFail: (f) => { fail = f; }, tick: (ms) => { t += ms; } };
}

test("queue: saved before sending, removed only after a successful upload", async () => {
  const { store, sent, q } = setup();
  const states = [];
  q.subscribe((s) => states.push(s.waiting));
  assert.equal(await q.enqueue("a", 10, fakeFile("IMG.jpg", "image/jpeg")), "queued");
  assert.equal(await q.enqueue("b", 20, fakeFile("big.jpg", "image/jpeg", ORIGINAL_MAX_BYTES)), "too-large");
  assert.equal(store.map.size, 1);
  const e = store.map.get("photo-originals/a/10.jpg");
  assert.equal(e.size, 3_000_000);
  assert.equal(e.name, "IMG.jpg");
  assert.equal(q.getState().waiting, 1);
  const r = await q.flush();
  assert.deepEqual(r, { uploaded: 1, failed: 0 });
  assert.deepEqual(sent, ["photo-originals/a/10.jpg"]);
  assert.equal(store.map.size, 0);
  assert.equal(q.getState().waiting, 0);
  assert.ok(states.includes(1) && states.at(-1) === 0);
});

test("queue: offline keeps everything on the device and stops early; next flush sends", async () => {
  const { store, sent, q, setFail } = setup();
  await q.enqueue("a", 1, fakeFile("1.jpg", "image/jpeg"));
  await q.enqueue("b", 2, fakeFile("2.jpg", "image/jpeg"));
  let tries = 0;
  setFail(() => { tries++; return new TypeError("Failed to fetch"); });
  assert.deepEqual(await q.flush(), { uploaded: 0, failed: 1 });
  assert.equal(tries, 1, "stops after the first network error");
  assert.equal(store.map.size, 2);
  assert.equal(q.getState().lastError, "network");
  assert.equal(store.map.get("photo-originals/a/1.jpg").attempts, 1);
  setFail(null);
  assert.deepEqual(await q.flush(), { uploaded: 2, failed: 0 });
  assert.deepEqual(sent, ["photo-originals/a/1.jpg", "photo-originals/b/2.jpg"], "oldest first");
  assert.equal(q.getState().lastError, null);
});

test("queue: permission error is not retried automatically for 6 h, but 'send now' always tries", async () => {
  const { store, q, setFail, tick } = setup();
  await q.enqueue("a", 1, fakeFile("1.jpg", "image/jpeg"));
  let tries = 0;
  setFail(() => { tries++; return { code: "storage/unauthorized" }; });
  await q.flush();
  assert.equal(q.getState().lastError, "unauthorized");
  await q.flush();
  assert.equal(tries, 1, "auto retry skipped");
  await q.flush({ manual: true });
  assert.equal(tries, 2, "manual retry");
  tick(UNAUTHORIZED_RETRY_MS + 1);
  await q.flush();
  assert.equal(tries, 3, "auto retry after 6 h");
  assert.equal(store.map.size, 1, "never dropped");
});

test("queue: concurrent flushes share one run", async () => {
  const { q, sent } = setup();
  await q.enqueue("a", 1, fakeFile("1.jpg", "image/jpeg"));
  const [r1, r2] = await Promise.all([q.flush(), q.flush()]);
  assert.equal(r1, r2);
  assert.equal(sent.length, 1);
});

