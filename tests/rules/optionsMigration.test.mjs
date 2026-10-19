// สคริปต์แปลงตัวเลือก (scripts/options-migration/core.ts) กับ emulator — ข้อมูลตั้งต้น = สำเนาเมนูจริง 2026-10-20
// (ไม่มีรูป/คำอธิบาย) ใน fixtures/ ไม่แตะ production
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  applyMigration, planMigration, rollbackMigration, seedFromBackup, takeBackup, toJson, DEMO_ITEM_IDS,
} from "../../scripts/options-migration/core";
import { normalizeMenuItem } from "../../src/app/menuOptions";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/menuItems-2026-10-20.json", import.meta.url), "utf8"));
const KHAO_SOI = "1786812043928-nv2yr";
const TOM_ZAAP = "1786812800808-129gn";
const EGG_FRIED_RICE = "1786895528557-b6oig";
const KHANOM_JEEN = "1786811714326-s1n7b";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });

let db;
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await seedFromBackup(ctx.firestore(), fixture);
    for (const id of fixture.categoryIds) {
      const { setDoc } = await import("firebase/firestore");
      await setDoc(doc(ctx.firestore(), "categories", id), { nameTh: id, nameEn: id, order: 0 });
    }
  });
  db = env.authenticatedContext("staff").firestore(); // apply/rollback ล็อกอินเป็นพนักงาน เหมือนของจริง (ผ่าน rules จริง)
});

const read = async (id) => (await getDoc(doc(db, "menuItems", id))).data();

test("plan matches the list the owner approved", () => {
  const plan = planMigration(fixture);
  assert.deepEqual(plan.problems, []);
  const converts = plan.items.filter((p) => p.action === "convert");
  const deletes = plan.items.filter((p) => p.action === "delete-demo");
  assert.deepEqual(deletes.map((p) => p.id).sort(), [...DEMO_ITEM_IDS].sort());
  const after = Object.fromEntries(converts.map((p) => [p.id, p.after]));
  const groups = (id) => after[id].customGroups.map((g) => `${g.nameTh}|${g.required ? "req" : ""}|${g.quickToggle ? "quick" : ""}|${g.choices.map((c) => `${c.labelTh}+${c.priceDelta}${c.soldOut ? "(ปิด)" : ""}`).join(",")}`);
  assert.deepEqual(groups(KHAO_SOI), [
    "เลือกเนื้อสัตว์|req|quick|หมู+0,ไก่+0,เนื้อ+10(ปิด)",
    "ขนาดจาน (ธรรมดา/พิเศษ)|req||ธรรมดา+0,พิเศษ+25",
  ]);
  assert.deepEqual(groups(TOM_ZAAP), ["ระดับความเผ็ด|req||ไม่เผ็ด+0,เผ็ดน้อย+0,เผ็ดกลาง+0,เผ็ดมาก+0", "เลือกเนื้อสัตว์|req|quick|หมู+0,ซี่โครงหมู+0"]);
  assert.deepEqual(groups(KHANOM_JEEN), ["ขนาด|req||ธรรมดา+0,พิเศษ+15"]);
  assert.deepEqual(groups(EGG_FRIED_RICE), ["เพิ่มไข่ดาว|||ไข่ดาว+15", "เลือกเนื้อสัตว์|req|quick|หมู+0,ไก่+0,แหนม+0"]);
  assert.ok(converts.every((p) => (p.after.customGroups || []).every((g) => g.defaultChoiceId === undefined)), "ไม่มีค่าเริ่มต้นเหลือ");
  // เมนูที่เป็นแบบใหม่อยู่แล้วไม่ถูกแตะ
  assert.equal(converts.length + deletes.length + plan.unchanged, fixture.menuItems.length);
});

test("apply converts, deletes demos, touches only option fields; re-run is a no-op", async () => {
  const plan = planMigration(fixture);
  const before = await read(KHAO_SOI);
  const result = await applyMigration(db, plan);
  assert.equal(result.skipped.length, 0);
  const k = await read(KHAO_SOI);
  assert.equal(k.hasMeatChoice, false);
  assert.equal(k.hasEggAddon, false);
  assert.equal("soldOutMeats" in k, false);
  assert.equal("portionPriceDelta" in k, false);
  assert.equal(k.price, before.price);
  assert.equal(k.soldOut, before.soldOut);
  assert.deepEqual(toJson(k), toJson(normalizeMenuItem(before)), "เหมือนที่แอปแปลงตอนอ่านทุกตัวอักษร");
  for (const id of DEMO_ITEM_IDS) assert.equal(await read(id), undefined);
  // รอบสอง: สำรองใหม่แล้วไม่มีอะไรต้องทำ
  const again = planMigration(await takeBackup(db));
  assert.equal(again.items.length, 0);
});

test("a menu edited after the backup is skipped, not overwritten", async () => {
  const plan = planMigration(fixture);
  await updateDoc(doc(db, "menuItems", KHAO_SOI), { soldOut: true }); // พนักงานกดหมดระหว่างนั้น
  const result = await applyMigration(db, plan);
  assert.deepEqual(result.skipped.map((s) => s.id), [KHAO_SOI]);
  const k = await read(KHAO_SOI);
  assert.equal(k.hasMeatChoice, true, "ไม่ถูกแปลง");
  assert.equal(k.soldOut, true, "การแก้ของพนักงานยังอยู่");
});

test("rollback restores option fields and demo items, keeps later price/sold-out edits", async () => {
  await applyMigration(db, planMigration(fixture));
  await updateDoc(doc(db, "menuItems", TOM_ZAAP), { price: 139, soldOut: true }); // แก้หลังแปลง
  const result = await rollbackMigration(db, fixture);
  assert.ok(result.done.length > 0);
  const original = Object.fromEntries(fixture.menuItems.map((m) => [m.id, m.data]));
  for (const id of [KHAO_SOI, EGG_FRIED_RICE, KHANOM_JEEN, ...DEMO_ITEM_IDS]) {
    assert.deepEqual(toJson(await read(id)), original[id], id);
  }
  const t = await read(TOM_ZAAP);
  assert.deepEqual(toJson(t.customGroups), original[TOM_ZAAP].customGroups);
  assert.equal(t.price, 139);
  assert.equal(t.soldOut, true);
  // ย้อนซ้ำ = ไม่มีอะไรต้องเขียน
  const again = await rollbackMigration(db, fixture);
  assert.equal(again.done.length, 0);
});

test("refuses to write when the plan has a problem", async () => {
  const bad = structuredClone(fixture);
  bad.categoryIds.push("appetizers"); // ทำให้เมนูตัวอย่าง a1 ดูเหมือนอยู่ในหมวดจริง
  const plan = planMigration(bad);
  assert.ok(plan.problems.length > 0);
  await assert.rejects(() => applyMigration(db, plan));
  assert.notEqual(await read("a1"), undefined);
});
