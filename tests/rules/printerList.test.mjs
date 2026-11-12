// รายชื่อเครื่องพิมพ์ทั้งร้าน (printers/{MAC}) — โค้ดจริงใน src/app/staff/printerListStore.ts + printerStore.ts กับ emulator + rules
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, disableNetwork, doc, enableNetwork, getDocs, setDoc } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";

// localStorage + window ของเครื่อง (node ไม่มี) — ต้องมีก่อนเรียก store
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});
globalThis.window ??= { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };

import {
  getSavedPrinters, getSelectedPrinter, getStoredPrinters, mergePrinterLists, printersMissingOnServer, setSelectedPrinterAddress,
} from "../../src/app/staff/printerStore";
import {
  PRINTERS_MERGED_KEY, addSharedPrinter, mergeLocalPrintersOnce, refreshSharedPrinters, removeSharedPrinter, renameSharedPrinter,
} from "../../src/app/staff/printerListStore";

const SAVED_KEY = "hueanyong.printers.saved";
const SEED_MAC = "5A:4A:8E:4E:09:4E";
const P1 = "AA:AA:AA:AA:AA:01", P2 = "AA:AA:AA:AA:AA:02", P3 = "AA:AA:AA:AA:AA:03";

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
  store.clear();
  await env.clearFirestore();
  db = env.authenticatedContext("staff", { email: "admin@hueanyong.local" }).firestore();
  setTestDb(db);
});

const seedServer = (list) => env.withSecurityRulesDisabled(async (ctx) => {
  for (const [address, name] of list) await setDoc(doc(ctx.firestore(), "printers", address), { name, address });
});
const server = async () => {
  const out = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    (await getDocs(collection(ctx.firestore(), "printers"))).forEach((d) => { out[d.id] = d.data().name; });
  });
  return out;
};
const local = () => Object.fromEntries(getStoredPrinters().map((p) => [p.address, p.name]));
const setLocal = (list) => store.set(SAVED_KEY, JSON.stringify(list.map(([address, name]) => ({ address, name }))));
// "เครื่องอีกเครื่อง" = localStorage อีกชุด
const onDevice = async (snapshot, fn) => {
  const mine = new Map(store);
  store.clear();
  snapshot.forEach((v, k) => store.set(k, v));
  try { await fn(); return new Map(store); } finally { store.clear(); mine.forEach((v, k) => store.set(k, v)); }
};

test("merge helpers: union by MAC (case-insensitive), names already on the server are kept", () => {
  const localList = [{ address: "aa:aa:aa:aa:aa:01", name: "ครัว (ชื่อในเครื่อง)" }, { address: P2, name: "เคาน์เตอร์" }, { address: P2, name: "ซ้ำ" }];
  const serverList = [{ address: P1, name: "ครัวใน" }, { address: P3, name: "ครัวนอก" }];
  assert.deepEqual(printersMissingOnServer(localList, serverList), [{ address: P2, name: "เคาน์เตอร์" }]);
  assert.deepEqual(mergePrinterLists(localList, serverList).map((p) => [p.address, p.name]), [[P1, "ครัวใน"], [P3, "ครัวนอก"], [P2, "เคาน์เตอร์"]]);
  assert.deepEqual(printersMissingOnServer([], serverList), []);
});

test("first run: this device's list is merged into the shop list — nothing lost, server names kept", async () => {
  setLocal([[P1, "ครัว (ชื่อในเครื่อง)"], [P2, "เคาน์เตอร์"]]);
  await seedServer([[P1, "ครัวใน"], [P3, "ครัวนอก"]]);
  assert.equal(await mergeLocalPrintersOnce(), "merged");
  assert.deepEqual(await server(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์", [P3]: "ครัวนอก" });
  assert.deepEqual(local(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์", [P3]: "ครัวนอก" });
  assert.equal(store.get(PRINTERS_MERGED_KEY), "1");
  assert.equal(await mergeLocalPrintersOnce(), "already"); // เปิดแอปครั้งต่อไปไม่อ่านอะไร
});

test("two devices with different lists both end up with the union", async () => {
  setLocal([[P1, "ครัวใน"]]);
  await mergeLocalPrintersOnce();
  const other = await onDevice(new Map([[SAVED_KEY, JSON.stringify([{ address: P2, name: "เคาน์เตอร์" }, { address: P1, name: "ชื่ออื่น" }])]]), async () => {
    assert.equal(await mergeLocalPrintersOnce(), "merged");
    assert.deepEqual(local(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์" });
  });
  assert.equal(other.get(PRINTERS_MERGED_KEY), "1");
  await refreshSharedPrinters(); // เครื่องแรกเปิดหน้าตั้งค่า
  assert.deepEqual(local(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์" });
  assert.deepEqual(await server(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์" });
});

test("add / rename / remove on one device shows on the others; a removed printer is not uploaded again", async () => {
  await mergeLocalPrintersOnce();
  await addSharedPrinter({ name: "ครัวใน", address: "aa:aa:aa:aa:aa:01" });
  await addSharedPrinter({ name: "เคาน์เตอร์", address: P2 });
  assert.deepEqual(await server(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์" });
  // อีกเครื่อง (รวมไปแล้ว มีสำเนาเก่า) เปลี่ยนชื่อ + ลบ
  const otherStart = new Map([[PRINTERS_MERGED_KEY, "1"], [SAVED_KEY, JSON.stringify([{ address: P1, name: "ครัวใน" }, { address: P2, name: "เคาน์เตอร์" }])]]);
  await onDevice(otherStart, async () => {
    await renameSharedPrinter(P1, "ครัวใน (ใหม่)");
    await removeSharedPrinter(P2);
  });
  assert.deepEqual(await server(), { [P1]: "ครัวใน (ใหม่)" });
  await refreshSharedPrinters();
  assert.deepEqual(local(), { [P1]: "ครัวใน (ใหม่)" });          // ชื่อใหม่ + ตัวที่ถูกลบหายที่เครื่องนี้ด้วย
  assert.deepEqual(await server(), { [P1]: "ครัวใน (ใหม่)" });    // ไม่ถูกเขียนกลับขึ้นไป
});

test("the built-in seed printer stays a fallback: shown when the list is empty, never uploaded by itself", async () => {
  assert.deepEqual(getSavedPrinters().map((p) => p.address), [SEED_MAC]);
  assert.equal(await mergeLocalPrintersOnce(), "merged");
  assert.deepEqual(await server(), {});
  assert.deepEqual(getSavedPrinters().map((p) => p.address), [SEED_MAC]);
  // มีรายการทั้งร้านแล้ว = ใช้รายการนั้น
  await addSharedPrinter({ name: "ครัวใน", address: P1 });
  assert.deepEqual(getSavedPrinters().map((p) => p.address), [P1]);
});

test("this device's selected printer and role are untouched; a printer removed elsewhere keeps printing here", async () => {
  setLocal([[P1, "ครัวใน"]]);
  setSelectedPrinterAddress(P1);
  store.set("hueanyong.printers.role", "inner");
  await mergeLocalPrintersOnce();
  await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(doc(ctx.firestore(), "printers", P1)));
  await refreshSharedPrinters();
  assert.deepEqual(local(), {});
  assert.equal(store.get("hueanyong.printers.selected"), P1);
  assert.equal(store.get("hueanyong.printers.role"), "inner");
  assert.deepEqual(getSelectedPrinter(), { name: P1, address: P1 }); // ยังพิมพ์ไป MAC เดิม
});

test("offline: loading fails with an error (retry on screen) and the list on this device is kept", async () => {
  setLocal([[P1, "ครัวใน"]]);
  await mergeLocalPrintersOnce();
  await disableNetwork(db);
  try {
    await assert.rejects(refreshSharedPrinters(1500));
    assert.deepEqual(local(), { [P1]: "ครัวใน" });
    // เพิ่มตอนออฟไลน์: เก็บในเครื่องทันที แล้วแจ้งว่ายังไม่ขึ้นทั้งร้าน
    const pending = addSharedPrinter({ name: "เคาน์เตอร์", address: P2 });
    assert.deepEqual(local(), { [P1]: "ครัวใน", [P2]: "เคาน์เตอร์" });
    pending.catch(() => {});
  } finally {
    await enableNetwork(db);
  }
  // กด "ลองใหม่" จนต่อ server ได้ (หลังออฟไลน์ SDK อาจใช้เวลาต่อกลับหลายวินาที)
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) ok = await refreshSharedPrinters(5000).then(() => true, () => false);
  assert.ok(ok, "retry reaches the server once back online");
  assert.equal((await server())[P1], "ครัวใน");
});

test("offline on first run: nothing is marked merged, so the merge happens next time", async () => {
  setLocal([[P1, "ครัวใน"]]);
  await disableNetwork(db);
  try {
    await assert.rejects(refreshSharedPrinters(1500));
  } finally {
    await enableNetwork(db);
  }
  assert.equal(store.get(PRINTERS_MERGED_KEY), undefined);
  assert.deepEqual(local(), { [P1]: "ครัวใน" });
  assert.equal(await mergeLocalPrintersOnce(), "merged");
  assert.deepEqual(await server(), { [P1]: "ครัวใน" });
});

test("rules not pasted yet (permission denied): each device keeps working from its own list, no error", async () => {
  setLocal([[P1, "ครัวใน"]]);
  setTestDb(env.unauthenticatedContext().firestore()); // ถูกปฏิเสธแบบเดียวกับ rules เก่าที่ยังไม่มี /printers
  assert.equal(await mergeLocalPrintersOnce(), "not-enabled");
  await addSharedPrinter({ name: "เคาน์เตอร์", address: P2 }); // ไม่ throw
  await renameSharedPrinter(P1, "ครัวใน 2");
  assert.deepEqual(local(), { [P1]: "ครัวใน 2", [P2]: "เคาน์เตอร์" });
  assert.equal(store.get(PRINTERS_MERGED_KEY), undefined);
  // วาง rules แล้ว: เปิดแอปครั้งถัดไปรวมขึ้นไปครบ
  setTestDb(db);
  assert.equal(await mergeLocalPrintersOnce(), "merged");
  assert.deepEqual(await server(), { [P1]: "ครัวใน 2", [P2]: "เคาน์เตอร์" });
});
