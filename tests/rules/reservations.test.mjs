// จองโต๊ะ — ตรรกะ (ชน 2 ชม., แถบเตือนวันนี้/พรุ่งนี้ตามเวลาไทย, ป้ายในผัง) + โค้ดจริงของ reservationStore กับ emulator + firestore.rules
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import {
  addDays, bangkokDate, reservationAlerts, reservationConflicts, reservationCutoff, reservationError, upcomingReservationByTable,
} from "../../src/app/reservations";
import {
  deleteReservation, deleteReservationsBefore, fetchReservationsOn, newReservationId, saveReservation,
} from "../../src/app/staff/reservationStore";
import { OWNER_EMAIL, STAFF_EMAIL } from "../../src/app/constants";

const R = (id, date, time, tables, name = id) => ({ id, date, time, tables, name });
const bkk = (date, time) => new Date(`${date}T${time}:00+07:00`); // เวลาไทย → Date

// ─── ตรรกะล้วน ───
test("Bangkok date ignores the device time zone, including the midnight edge", () => {
  assert.equal(bangkokDate(new Date("2026-11-13T16:59:59Z")), "2026-11-13"); // 23:59:59 ไทย
  assert.equal(bangkokDate(new Date("2026-11-13T17:00:00Z")), "2026-11-14"); // 00:00 ไทย
  assert.equal(bangkokDate(new Date("2026-12-31T17:00:00Z")), "2027-01-01");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(reservationCutoff(bkk("2026-11-13", "10:00")), "2026-10-14");
});

test("overlap warning: same table under 2 h apart (either side), not other tables, not itself, exactly 2 h is fine", () => {
  const list = [R("a", "2026-11-20", "18:00", ["1-3"]), R("b", "2026-11-20", "19:30", ["2-1", "2-2"]), R("c", "2026-11-20", "21:00", ["1-3"])];
  const c1 = reservationConflicts({ date: "2026-11-20", time: "19:00", tables: ["1-3", "2-2"] }, list);
  assert.deepEqual(c1.map((c) => [c.table, c.other.id, c.gapMinutes]), [["2-2", "b", 30], ["1-3", "a", 60]]);
  assert.deepEqual(reservationConflicts({ date: "2026-11-20", time: "20:00", tables: ["1-3"] }, list).map((c) => c.other.id), ["c"]); // a ห่าง 2 ชม.พอดี
  assert.deepEqual(reservationConflicts({ date: "2026-11-20", time: "18:00", tables: ["1-4"] }, list), []); // คนละโต๊ะ
  assert.deepEqual(reservationConflicts({ id: "a", date: "2026-11-20", time: "18:30", tables: ["1-3"] }, list), []); // แก้ตัวเอง
  assert.deepEqual(reservationConflicts({ date: "2026-11-21", time: "18:00", tables: ["1-3"] }, list), []); // คนละวัน
  assert.equal(reservationConflicts({ date: "2026-11-21", time: "00:30", tables: ["1-3"] }, [R("x", "2026-11-20", "23:30", ["1-3"])])[0].gapMinutes, 60); // ข้ามเที่ยงคืน
});

test("validation: name and start time required, the rest optional", () => {
  const ok = { date: "2026-11-20", time: "18:00", tables: ["1-3"], name: "เอ" };
  assert.equal(reservationError(ok), null);
  assert.ok(reservationError({ ...ok, name: "  " }));
  assert.ok(reservationError({ ...ok, time: "" }));
  assert.ok(reservationError({ ...ok, time: "25:00" }));
  assert.ok(reservationError({ ...ok, tables: [] }));
  assert.ok(reservationError({ ...ok, partySize: 0 }));
  assert.equal(reservationError({ ...ok, partySize: 4, phone: "081-234-5678", note: "วันเกิด" }), null);
});

test("front-page alerts: today + tomorrow by Bangkok date, flips exactly at Thai midnight", () => {
  const list = [R("t1", "2026-11-13", "19:00", ["1-1"]), R("t0", "2026-11-13", "12:00", ["1-2"]), R("m1", "2026-11-14", "18:00", ["2-1"]), R("d2", "2026-11-15", "18:00", ["2-2"])];
  const before = reservationAlerts(list, new Date("2026-11-13T16:59:00Z")); // 23:59 ไทย วันที่ 13
  assert.equal(before.today, "2026-11-13");
  assert.deepEqual(before.todayList.map((r) => r.id), ["t0", "t1"]); // เรียงตามเวลา
  assert.deepEqual(before.tomorrowList.map((r) => r.id), ["m1"]); // เห็นของพรุ่งนี้ตั้งแต่วันก่อน
  const after = reservationAlerts(list, new Date("2026-11-13T17:01:00Z")); // 00:01 ไทย วันที่ 14
  assert.equal(after.today, "2026-11-14");
  assert.deepEqual(after.todayList.map((r) => r.id), ["m1"]);
  assert.deepEqual(after.tomorrowList.map((r) => r.id), ["d2"]);
  assert.equal(reservationAlerts(list, new Date("2026-11-13T20:00:00Z")).today, "2026-11-14"); // 20:00 UTC = 03:00 ไทย
});

test("picker tag: reservation starting within the next 2 h (or up to 30 min late) on that table", () => {
  const list = [R("a", "2026-11-13", "18:00", ["1-3", "1-4"]), R("b", "2026-11-13", "20:30", ["2-1"]), R("c", "2026-11-14", "00:30", ["2-2"])];
  const at = (t) => upcomingReservationByTable(list, bkk("2026-11-13", t));
  assert.deepEqual([...at("15:59").keys()], []);
  assert.deepEqual([...at("16:00").keys()].sort(), ["1-3", "1-4"]);
  assert.equal(at("17:00").get("1-3").time, "18:00");
  assert.deepEqual([...at("18:30").keys()].sort(), ["1-3", "1-4", "2-1"]);
  assert.deepEqual([...at("18:31").keys()], ["2-1"]);
  assert.ok(at("23:00").has("2-2")); // ข้ามเที่ยงคืน
});

// ─── Firestore (emulator) ───
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const staff = () => env.authenticatedContext("staff-uid", { email: STAFF_EMAIL }).firestore();
const owner = () => env.authenticatedContext("owner-uid", { email: OWNER_EMAIL }).firestore();
const stranger = () => env.authenticatedContext("x-uid", { email: "someone@gmail.com" }).firestore();
const guest = () => env.unauthenticatedContext().firestore();
const raw = async (id) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), "reservations", id))).data(); });
  return data;
};

test("create → edit → delete through the app's own store (staff account)", async () => {
  setTestDb(staff());
  const id = newReservationId();
  await saveReservation({ id, date: "2026-11-20", time: "18:00", tables: ["1-3", "1-3", "3-1"], name: "  คุณเอ ", phone: "081 234 5678", partySize: 4, note: "" }, true);
  const saved = await raw(id);
  assert.deepEqual(
    { date: saved.date, time: saved.time, tables: saved.tables, name: saved.name, phone: saved.phone, partySize: saved.partySize },
    { date: "2026-11-20", time: "18:00", tables: ["1-3", "3-1"], name: "คุณเอ", phone: "081 234 5678", partySize: 4 },
  );
  assert.ok(!("note" in saved), "empty note not stored");
  assert.ok(saved.createdAt && saved.updatedAt);

  // กดบันทึกซ้ำด้วยรหัสเดิม (เน็ตช้า) = ไม่เกิดการจองซ้ำ
  await saveReservation({ id, date: "2026-11-20", time: "18:00", tables: ["1-3"], name: "คุณเอ" }, true);
  assert.equal((await fetchReservationsOn("2026-11-20")).length, 1);

  // แก้: เปลี่ยนเวลา/โต๊ะ ลบเบอร์ เพิ่มหมายเหตุ
  await saveReservation({ id, date: "2026-11-20", time: "19:15", tables: ["2-1"], name: "คุณเอ", phone: "", note: "เค้กวันเกิด" }, false);
  const edited = await raw(id);
  assert.equal(edited.time, "19:15");
  assert.deepEqual(edited.tables, ["2-1"]);
  assert.ok(!("phone" in edited) && !("partySize" in edited));
  assert.equal(edited.note, "เค้กวันเกิด");
  assert.ok(edited.createdAt, "createdAt kept");

  await deleteReservation(id);
  assert.equal(await raw(id), undefined);
  await assert.rejects(saveReservation({ id: "z", date: "2026-11-20", time: "", tables: ["1-1"], name: "x" }, true)); // ไม่มีเวลา = ไม่เขียน
  assert.equal(await raw("z"), undefined);
});

test("owner account can use reservations too, and cleanup removes only those older than 30 days", async () => {
  setTestDb(owner());
  for (const [id, date] of [["old1", "2026-09-01"], ["old2", "2026-10-13"], ["edge", "2026-10-14"], ["new", "2026-11-20"]]) {
    await saveReservation({ id, date, time: "18:00", tables: ["1-1"], name: id }, true);
  }
  assert.equal(await deleteReservationsBefore(reservationCutoff(bkk("2026-11-13", "10:00"))), 2); // cutoff 2026-10-14
  const left = [];
  await env.withSecurityRulesDisabled(async (ctx) => { (await getDocs(collection(ctx.firestore(), "reservations"))).forEach((d) => left.push(d.id)); });
  assert.deepEqual(left.sort(), ["edge", "new"]);
});

test("rules: customers and non-shop accounts cannot read or write reservations", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "reservations", "r1"), { date: "2026-11-20", time: "18:00", tables: ["1-3"], name: "คุณเอ", phone: "0812345678" });
  });
  for (const db of [guest(), stranger()]) {
    await assertFails(getDoc(doc(db, "reservations", "r1")));
    await assertFails(getDocs(collection(db, "reservations")));
    await assertFails(getDocs(query(collection(db, "reservations"), where("date", "==", "2026-11-20"))));
    await assertFails(setDoc(doc(db, "reservations", "r2"), { date: "2026-11-20", time: "18:00", tables: ["1-3"], name: "x" }));
    await assertFails(updateDoc(doc(db, "reservations", "r1"), { name: "y" }));
    await assertFails(deleteDoc(doc(db, "reservations", "r1")));
  }
  await assertSucceeds(getDocs(query(collection(staff(), "reservations"), where("date", "==", "2026-11-20"))));
  await assertSucceeds(getDoc(doc(owner(), "reservations", "r1")));
});

test("rules: only the needed fields, with sane values", async () => {
  const db = staff();
  const ok = { date: "2026-11-20", time: "18:00", tables: ["1-3"], name: "คุณเอ" };
  await assertSucceeds(setDoc(doc(db, "reservations", "ok"), ok));
  await assertSucceeds(setDoc(doc(db, "reservations", "full"), { ...ok, phone: "0812345678", partySize: 6, note: "ริมหน้าต่าง" }));
  await assertFails(setDoc(doc(db, "reservations", "b1"), { ...ok, email: "a@b.c" })); // ช่องที่ไม่ต้องใช้
  await assertFails(setDoc(doc(db, "reservations", "b2"), { ...ok, name: "" }));
  await assertFails(setDoc(doc(db, "reservations", "b3"), { date: ok.date, tables: ok.tables, name: ok.name })); // ไม่มีเวลา
  await assertFails(setDoc(doc(db, "reservations", "b4"), { ...ok, time: "6pm" }));
  await assertFails(setDoc(doc(db, "reservations", "b5"), { ...ok, tables: [] }));
  await assertFails(setDoc(doc(db, "reservations", "b6"), { ...ok, partySize: 0 }));
  await assertFails(setDoc(doc(db, "reservations", "b7"), { ...ok, note: "x".repeat(301) }));
  await assertFails(setDoc(doc(db, "reservations", "b8"), { ...ok, date: "20/11/2026" }));
});
