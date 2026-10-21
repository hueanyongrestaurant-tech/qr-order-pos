// สคริปต์ลบรูปในออเดอร์เก่า (scripts/order-photos-migration/core.ts) กับ emulator — ไม่แตะ production
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import {
  applyPhotoStrip, fingerprint, measureAllOrders, rollbackPhotoStrip, summarizePhotoBackup, takePhotoBackup,
} from "../../scripts/order-photos-migration/core";

const PHOTO_A = `data:image/jpeg;base64,${"A".repeat(5000)}`;
const PHOTO_B = `data:image/jpeg;base64,${"B".repeat(3000)}`;
const item = (id, photo) => ({ id, categoryId: "c", name: { th: id, en: id }, description: { th: "", en: "" }, price: 60, photo, customGroups: [] });
const line = (cartId, photo, extra = {}) => ({ cartId, quantity: 2, spiceLevel: 1, note: "ไม่ผัก", item: item(cartId, photo), ...extra });

// ออเดอร์เก่า 3 แบบ + ออเดอร์ใหม่ที่ไม่มีรูป + ออเดอร์ที่รูปเป็น URL
const seed = () => ({
  old1: {
    tableNumber: "1-2", status: "paid", createdAt: Timestamp.fromDate(new Date("2026-09-01T12:00:00")),
    paidAt: Timestamp.fromDate(new Date("2026-09-01T13:00:00")), paymentMethod: "cash", cashReceived: 500,
    servedAt: { a: Timestamp.fromDate(new Date("2026-09-01T12:10:00")) },
    items: [line("a", PHOTO_A), line("b", PHOTO_B, { voided: true, voidReason: "ลูกค้าเปลี่ยนใจ" }), line("c", "")],
  },
  old2: {
    tableNumber: "0", isTakeaway: true, takeawayLabel: "T-3", status: "cancelled", createdAt: Timestamp.fromDate(new Date("2026-09-05T18:00:00")),
    items: [line("d", PHOTO_A)],
  },
  newer: { tableNumber: "2-1", status: "paid", createdAt: Timestamp.fromDate(new Date("2026-10-01T12:00:00")), items: [line("e", "")] },
  url: { tableNumber: "2-2", status: "paid", createdAt: Timestamp.fromDate(new Date("2026-10-02T12:00:00")), items: [line("f", "https://x/y.jpg")] },
});

let env;
let db;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [id, data] of Object.entries(seed())) await setDoc(doc(ctx.firestore(), "orders", id), data);
  });
  db = env.authenticatedContext("staff").firestore(); // ล็อกอินเป็นพนักงาน เหมือนของจริง (ผ่าน rules จริง)
});

const read = async (id) => (await getDoc(doc(db, "orders", id))).data();

test("backup + summary: only orders with base64 item photos, photos stored once", async () => {
  const backup = await takePhotoBackup(db);
  assert.equal(backup.scanned, 4);
  assert.deepEqual(backup.orders.map((o) => o.id), ["old1", "old2"]);
  assert.deepEqual(backup.orders[0].lines.map((l) => [l.index, l.cartId]), [[0, "a"], [1, "b"]]);
  assert.equal(Object.keys(backup.photos).length, 2, "PHOTO_A used twice, stored once");
  const s = summarizePhotoBackup(backup);
  assert.deepEqual([s.orders, s.lines, s.distinctPhotos], [2, 3, 2]);
  assert.equal(s.bytesBefore - s.bytesAfter, PHOTO_A.length * 2 + PHOTO_B.length);
  assert.equal(s.firstAt.slice(0, 10), "2026-09-01");
  assert.deepEqual(backup.otherDataUrls, []);
});

test("apply: only items[].item.photo changes; everything else identical", async () => {
  const before1 = await read("old1");
  const result = await applyPhotoStrip(db, await takePhotoBackup(db));
  assert.deepEqual(result.done, ["old1", "old2"]);
  const after1 = await read("old1");
  const expected = { ...before1, items: before1.items.map((ci) => ({ ...ci, item: { ...ci.item, photo: "" } })) };
  assert.equal(fingerprint(after1), fingerprint(expected));
  assert.equal(after1.items[1].voided, true);
  assert.equal(after1.items[0].quantity, 2);
  assert.equal(after1.paidAt.toMillis(), before1.paidAt.toMillis());
  assert.equal((await read("old2")).status, "cancelled");
  assert.equal((await read("url")).items[0].item.photo, "https://x/y.jpg", "URL photos untouched");
});

test("apply skips an order changed after the backup; rerun after a fresh backup finishes it", async () => {
  const backup = await takePhotoBackup(db);
  await updateDoc(doc(db, "orders", "old1"), { note: "edited" });
  const r1 = await applyPhotoStrip(db, backup);
  assert.deepEqual(r1.done, ["old2"]);
  assert.equal(r1.skipped[0].id, "old1");
  assert.equal((await read("old1")).items[0].item.photo, PHOTO_A, "skipped order not written");
  const r2 = await applyPhotoStrip(db, await takePhotoBackup(db));
  assert.deepEqual(r2.done, ["old1"]);
  assert.equal((await takePhotoBackup(db)).orders.length, 0, "nothing left → rerun is a no-op");
});

test("rollback restores the original documents exactly", async () => {
  const original = { old1: await read("old1"), old2: await read("old2") };
  const backup = await takePhotoBackup(db);
  await applyPhotoStrip(db, backup);
  const r = await rollbackPhotoStrip(db, backup);
  assert.deepEqual(r.done, ["old1", "old2"]);
  assert.equal(fingerprint(await read("old1")), fingerprint(original.old1));
  assert.equal(fingerprint(await read("old2")), fingerprint(original.old2));
  const again = await rollbackPhotoStrip(db, backup);
  assert.deepEqual(again.done, [], "second rollback writes nothing");
});

test("rollback never overwrites a line that changed (different cartId at that position)", async () => {
  const backup = await takePhotoBackup(db);
  await applyPhotoStrip(db, backup);
  const cur = await read("old2");
  await updateDoc(doc(db, "orders", "old2"), { items: [{ ...cur.items[0], cartId: "other" }] });
  await rollbackPhotoStrip(db, backup);
  assert.equal((await read("old2")).items[0].item.photo, "");
});

test("size report: per-month counts and bytes, largest first; shrinks after strip", async () => {
  const before = await measureAllOrders(db);
  assert.equal(before.count, 4);
  assert.deepEqual(before.byMonth.map((m) => [m.month, m.count]), [["2026-09", 2], ["2026-10", 2]]);
  assert.equal(before.largest[0].id, "old1");
  assert.equal(before.totalBytes, before.byMonth.reduce((s, m) => s + m.bytes, 0));
  await applyPhotoStrip(db, await takePhotoBackup(db));
  const after = await measureAllOrders(db);
  assert.ok(before.totalBytes - after.totalBytes >= PHOTO_A.length * 2 + PHOTO_B.length);
});
