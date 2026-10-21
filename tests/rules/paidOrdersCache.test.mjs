// cache ออเดอร์ที่ชำระแล้ว (src/app/utils.ts) — logic ล้วน + ดึงจริงกับ emulator (ไม่แตะ production)
// node ไม่มี IndexedDB → cache บนเครื่องเงียบเป็น no-op ทดสอบได้แค่ cache ในหน่วยความจำและการแบ่งช่วง query
import { readFileSync } from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { contiguousRuns, dayKeysInRange, fetchPaidOrdersCached, formatDateInput, lastPersistableDay } from "../../src/app/utils";

test("dayKeysInRange: inclusive, empty when reversed or invalid", () => {
  assert.deepEqual(dayKeysInRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(dayKeysInRange("2026-11-02", "2026-11-01"), []);
  assert.deepEqual(dayKeysInRange("nope", "2026-11-01"), []);
});

test("contiguousRuns: one query per run of missing days", () => {
  assert.deepEqual(contiguousRuns([]), []);
  assert.deepEqual(contiguousRuns(["2026-10-01"]), [["2026-10-01", "2026-10-01"]]);
  assert.deepEqual(
    contiguousRuns(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-21", "2026-10-22"]),
    [["2026-09-30", "2026-10-02"], ["2026-10-05", "2026-10-05"], ["2026-10-21", "2026-10-22"]],
  );
});

test("lastPersistableDay: only days older than yesterday go to the device", () => {
  assert.equal(lastPersistableDay(new Date("2026-10-22T09:00:00")), "2026-10-20");
  assert.equal(lastPersistableDay(new Date("2026-11-01T00:05:00")), "2026-10-30");
});

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
  await env.clearFirestore();
  const at = (key, hh) => Timestamp.fromDate(new Date(`${key}T${hh}:00:00`));
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const order = (id, key, status = "paid") => setDoc(doc(db, "orders", id), {
      tableNumber: "1-1", status, createdAt: at(key, "12"),
      items: [{ cartId: "c", quantity: 1, spiceLevel: 0, item: { id: "m", categoryId: "c", name: { th: "x", en: "x" }, description: { th: "", en: "" }, price: 50, photo: "data:image/jpeg;base64,AAAA" } }],
    });
    await order("a", "2026-10-01");
    await order("b", "2026-10-03");
    await order("c", "2026-10-03", "cancelled");
    await order("d", "2026-10-05");
  });
  setTestDb(env.authenticatedContext("staff").firestore());
});
after(async () => { await env?.cleanup(); });

test("fetchPaidOrdersCached: paid only, right days, photos stripped; cached days reused across overlapping calls", async () => {
  const first = await fetchPaidOrdersCached("2026-10-03", "2026-10-03", false, { persist: true });
  assert.deepEqual(first.orders.map((o) => o.id), ["b"]);
  // ช่วงใหม่ครอบวันที่มีแล้ว (03) — ขาด 01-02 กับ 04-05 = 2 ช่วง query, ผลรวมถูกและเรียงตามวัน
  const [wide, again] = await Promise.all([
    fetchPaidOrdersCached("2026-10-01", "2026-10-05", false, { persist: true }),
    fetchPaidOrdersCached("2026-10-01", "2026-10-05", false, { persist: true }),
  ]);
  assert.deepEqual(wide.orders.map((o) => o.id), ["a", "b", "d"]);
  assert.deepEqual(again.orders.map((o) => o.id), ["a", "b", "d"]);
  assert.equal(wide.orders[0].items[0].item.photo, "");
  assert.equal(formatDateInput(wide.orders[2].timestamp), "2026-10-05");
});
