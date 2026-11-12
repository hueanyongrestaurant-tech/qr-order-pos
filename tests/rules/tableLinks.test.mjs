// ลิงก์โต๊ะ: สร้างเฉพาะโต๊ะที่ยังไม่มี (ไม่แทน/ลบของเดิม), ออฟไลน์ = error ไม่ใช่ "ยังไม่มีลิงก์", โหลดเกินเวลา = error + ลองใหม่ได้
// โค้ดจริงใน src/app/tableViewStore.ts + staff/tableLinkStore.ts กับ emulator + firestore.rules (ไม่แตะ production)
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, disableNetwork, doc, enableNetwork, getDoc, getDocs, setDoc, Timestamp } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import {
  LinkChangedError, createMissingTableLinks, listTableLinks, readLegacyTableUrlForStaff, regenerateTableLink,
} from "../../src/app/tableViewStore";
import { refreshTableLinks } from "../../src/app/staff/tableLinkStore";
import { TimeoutError, withTimeout } from "../../src/app/timeout";

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
  db = env.authenticatedContext("staff", { email: "admin@hueanyong.local" }).firestore();
  setTestDb(db);
  // QR ที่พิมพ์ติดโต๊ะ 1-1 และ 1-2 อยู่แล้ว
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    for (const [token, table] of [["PRINTED-1-1", "1-1"], ["PRINTED-1-2", "1-2"]]) {
      await setDoc(doc(admin, "tableViews", token), { table, version: 1, data: "{}", hash: "h", createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    }
  });
});

const allDocs = async () => {
  const out = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    (await getDocs(collection(ctx.firestore(), "tableViews"))).forEach((d) => out.push({ token: d.id, table: d.data().table }));
  });
  return out.sort((a, b) => a.table.localeCompare(b.table) || a.token.localeCompare(b.token));
};
const tokensOf = async (table) => (await allDocs()).filter((d) => d.table === table).map((d) => d.token);

test("create links: tables that already have a link are skipped — printed tokens untouched", async () => {
  const result = await createMissingTableLinks(["1-1", "1-2", "1-3", "3-1"]);
  assert.deepEqual(result.skipped, ["1-1", "1-2"]);
  assert.deepEqual(result.created, ["1-3", "3-1"]);
  assert.deepEqual(await tokensOf("1-1"), ["PRINTED-1-1"]);
  assert.deepEqual(await tokensOf("1-2"), ["PRINTED-1-2"]);
  assert.equal((await tokensOf("1-3")).length, 1);
  assert.equal((await tokensOf("3-1")).length, 1);
  assert.equal((await allDocs()).length, 4);

  // กดซ้ำ: ไม่มีอะไรถูกสร้างหรือเปลี่ยน
  const before = await allDocs();
  const again = await createMissingTableLinks(["1-1", "1-2", "1-3", "3-1"]);
  assert.deepEqual(again, { created: [], skipped: ["1-1", "1-2", "1-3", "3-1"] });
  assert.deepEqual(await allDocs(), before);
});

test("create links: the screen's stale idea of 'no link' cannot replace a link the server has", async () => {
  // หน้าจอ (ออฟไลน์/cache ว่าง) คิดว่าทุกโต๊ะยังไม่มีลิงก์ แล้วกดสร้างทั้งหมด
  const result = await createMissingTableLinks(["1-1", "1-2"]);
  assert.deepEqual(result, { created: [], skipped: ["1-1", "1-2"] });
  assert.deepEqual((await allDocs()).map((d) => d.token), ["PRINTED-1-1", "PRINTED-1-2"]);
});

test("create links: two devices at the same time → one link per table", async () => {
  const other = env.authenticatedContext("staff2", { email: "admin@hueanyong.local" }).firestore();
  const viaOther = async () => { setTestDb(other); try { return await createMissingTableLinks(["2-1", "2-2"]); } finally { setTestDb(db); } };
  // สองรอบวิ่งซ้อนกัน (db เดียวกันก็ชนกันที่ล็อกเหมือนกัน)
  const [a, b] = await Promise.all([createMissingTableLinks(["2-1", "2-2"]), createMissingTableLinks(["2-1", "2-2"])]);
  assert.equal(a.created.length + b.created.length, 2, JSON.stringify([a, b]));
  assert.equal((await tokensOf("2-1")).length, 1);
  assert.equal((await tokensOf("2-2")).length, 1);
  const c = await viaOther();
  assert.deepEqual(c, { created: [], skipped: ["2-1", "2-2"] });
});

// หน้าจอขึ้นว่าไม่สำเร็จแล้ว = ต้องไม่มีอะไรถูกเขียนทีหลัง แม้เน็ตจะกลับมาระหว่างที่ SDK ยังลอง transaction ซ้ำอยู่
const backOnlineAndSettled = async () => {
  await enableNetwork(db);
  await new Promise((r) => setTimeout(r, 4000)); // นานกว่ารอบลองซ้ำของ SDK
};

test("create links offline: fails with an error, and nothing is created later when the network comes back", async () => {
  await disableNetwork(db);
  let failed;
  try {
    failed = await createMissingTableLinks(["1-3", "1-4"], undefined, 800).then(() => null, (err) => err);
  } finally {
    await backOnlineAndSettled();
  }
  assert.ok(failed, "offline create must reject");
  assert.deepEqual(await tokensOf("1-3"), []);
  assert.deepEqual(await tokensOf("1-4"), []);
  assert.deepEqual((await allDocs()).map((d) => d.token), ["PRINTED-1-1", "PRINTED-1-2"]);
  // กดอีกครั้งตอนออนไลน์: สร้างได้ตามปกติ
  assert.deepEqual(await createMissingTableLinks(["1-3"]), { created: ["1-3"], skipped: [] });
});

test("a slow create that passes its deadline writes nothing (deadline is checked before every write)", async () => {
  // เส้นตาย 0 ms: transaction รอบแรกก็เลยเส้นตายแล้ว
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(createMissingTableLinks(["1-3"], undefined, -1), (err) => err instanceof TimeoutError);
  await assert.rejects(regenerateTableLink("1-1", "PRINTED-1-1", undefined, -1), (err) => err instanceof TimeoutError);
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual((await allDocs()).map((d) => d.token), ["PRINTED-1-1", "PRINTED-1-2"]);
});

test("offline read: listing links throws (an error on screen) instead of returning an empty 'no links' list", async () => {
  assert.equal((await listTableLinks()).size, 2);
  await disableNetwork(db);
  try {
    await assert.rejects(withTimeout(listTableLinks(), 3000));
    await assert.rejects(refreshTableLinks(3000));
    await assert.rejects(readLegacyTableUrlForStaff(3000)); // สวิตช์ QR รุ่นเก่าก็ไม่เดาค่า
  } finally {
    await enableNetwork(db);
  }
  // กลับมาออนไลน์ กด "ลองใหม่" ได้ข้อมูลจริง
  const links = await refreshTableLinks(5000);
  assert.deepEqual([...links.keys()].sort(), ["1-1", "1-2"]);
  assert.equal(links.get("1-1").token, "PRINTED-1-1");
});

test("timeout: a load that never answers rejects after the limit, and retry is a fresh request (not the stuck one)", async () => {
  let calls = 0;
  const never = () => { calls++; return new Promise(() => {}); };
  const t0 = Date.now();
  await assert.rejects(refreshTableLinks(150, never), (err) => err instanceof TimeoutError);
  assert.ok(Date.now() - t0 >= 140 && Date.now() - t0 < 2000);
  // เปิดหน้าซ้ำระหว่างรอ = คำขอเดียวกัน; หลังหมดเวลา = คำขอใหม่
  const p1 = refreshTableLinks(150, never);
  const p2 = refreshTableLinks(150, never);
  assert.equal(p1, p2);
  await assert.rejects(p1);
  assert.equal(calls, 2);
  const good = await refreshTableLinks(5000); // ลองใหม่: อ่าน server จริง
  assert.equal(good.size, 2);
});

test("withTimeout: passes a fast result/error through, TimeoutError only when late", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50), /boom/);
  await assert.rejects(withTimeout(new Promise(() => {}), 30), (err) => err instanceof TimeoutError && err.name === "TimeoutError");
});

test("replace link (confirmed by staff): only the token shown on screen, only if the server still has it", async () => {
  // รหัสบนจอเก่าแล้ว (อีกเครื่องเปลี่ยนไปก่อน) → ไม่แตะอะไร
  await assert.rejects(regenerateTableLink("1-1", "SOME-OLD-TOKEN"), (err) => err instanceof LinkChangedError);
  // รหัสของโต๊ะอื่น → ไม่แตะอะไร
  await assert.rejects(regenerateTableLink("1-1", "PRINTED-1-2"), (err) => err instanceof LinkChangedError);
  assert.deepEqual((await allDocs()).map((d) => d.token), ["PRINTED-1-1", "PRINTED-1-2"]);

  const token = await regenerateTableLink("1-1", "PRINTED-1-1");
  assert.notEqual(token, "PRINTED-1-1");
  assert.deepEqual(await tokensOf("1-1"), [token]);
  assert.deepEqual(await tokensOf("1-2"), ["PRINTED-1-2"]); // โต๊ะอื่นไม่โดน
  assert.equal((await getDoc(doc(db, "tableViews", "PRINTED-1-1"))).exists(), false);
});

test("customers still cannot list links or touch the lock", async () => {
  const guest = env.unauthenticatedContext().firestore();
  await assert.rejects(getDocs(collection(guest, "tableViews")));
  await assert.rejects(getDoc(doc(guest, "counters", "tableLinkLock")));
  assert.equal((await getDoc(doc(guest, "tableViews", "PRINTED-1-1"))).data().table, "1-1"); // ลิงก์ที่รู้รหัสยังเปิดได้
});

// ─── counters/tableLinkLock ไม่มีทางค้าง: ไม่ใช่ล็อกที่ถือไว้ เนื้อหาใน doc ไม่ถูกใช้ตัดสินอะไร ───
const setLock = (data) => env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "counters", "tableLinkLock"), data));
const readLock = async () => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), "counters", "tableLinkLock"))).data(); });
  return data;
};

test("lock left over from a device that died (expired, a year old) does not block creating links", async () => {
  await setLock({ seq: 41, lastTable: "1-3", at: Timestamp.fromDate(new Date(Date.now() - 365 * 24 * 3600 * 1000)), holder: "dead-device", locked: true });
  const result = await withTimeout(createMissingTableLinks(["1-3"]), 5000);
  assert.deepEqual(result, { created: ["1-3"], skipped: [] });
  assert.equal((await readLock()).seq, 42);
});

test("lock written a moment ago by another device (not expired) does not block either — nothing is ever 'held'", async () => {
  await setLock({ seq: 7, lastTable: "1-3", at: Timestamp.now(), holder: "other-device", locked: true });
  assert.deepEqual(await withTimeout(createMissingTableLinks(["1-3", "1-4"]), 5000), { created: ["1-3", "1-4"], skipped: [] });
});

test("lock with garbage content (wrong types, future time, empty) never blocks", async () => {
  for (const [i, junk] of [{}, { seq: "abc", at: "yesterday" }, { seq: NaN }, { at: Timestamp.fromDate(new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000)), locked: true }].entries()) {
    await setLock(junk);
    const table = `2-${i + 1}`;
    assert.deepEqual(await withTimeout(createMissingTableLinks([table]), 5000), { created: [table], skipped: [] }, JSON.stringify(junk));
    assert.equal(typeof (await readLock()).seq, "number");
  }
});

test("an operation that dies half-way leaves no lock behind: the next create works at once", async () => {
  // เปลี่ยนลิงก์ล้มกลางทาง (รหัสบนจอเก่า) — transaction ไม่เขียนอะไรเลย รวมทั้งล็อก
  await assert.rejects(regenerateTableLink("1-1", "SOME-OLD-TOKEN"));
  assert.equal(await readLock(), undefined);
  // สร้างตอนออฟไลน์ล้ม — ไม่มีล็อกค้าง
  await disableNetwork(db);
  try { await assert.rejects(createMissingTableLinks(["1-3"], undefined, 800)); } finally { await enableNetwork(db); }
  const t0 = Date.now();
  assert.deepEqual(await createMissingTableLinks(["1-4"]), { created: ["1-4"], skipped: [] });
  assert.ok(Date.now() - t0 < 15000);
});
