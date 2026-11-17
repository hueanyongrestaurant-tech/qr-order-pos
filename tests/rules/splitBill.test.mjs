// แยกจ่าย (src/app/staff/splitBill.ts) — ตรรกะล้วน ไม่ต้องใช้ emulator (การปิดบิลจริงอยู่ใน closeTables.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SPLIT_BILL, SPLIT_MAX_AGE_MS, canCommit, clearSplit, commitPicked, loadSplit, pruneSplits, reconcileSplit, saveSplit,
  splitAmounts, splitLines, splitPayment,
} from "../../src/app/staff/splitBill";

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const menu = (id, price) => ({ id, categoryId: "food", name: { th: id, en: id }, description: { th: "", en: "" }, photo: "", price, ...noBuiltins, customGroups: [] });
let n = 0;
const line = (item, quantity, extra = {}) => ({ cartId: `c${n++}`, item, quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {}, ...extra });
const rice = menu("rice", 10);
const soup = menu("soup", 80);

test("splitLines: same item across rounds merges, voided dropped, price change stays its own line", () => {
  const lines = splitLines([line(rice, 2), line(rice, 1), line(soup, 1), line(soup, 3, { voided: true }), line({ ...soup, price: 90 }, 1)]);
  assert.deepEqual(lines.map((l) => [l.ci.item.id, l.qty, l.unit]), [["rice", 3, 10], ["soup", 1, 80], ["soup", 1, 90]]);
  assert.equal(splitAmounts(EMPTY_SPLIT_BILL, lines).total, 200);
});

test("pick → method → คิดเงินแล้ว → next person; each person's method + amount stored", () => {
  const lines = splitLines([line(rice, 3), line(soup, 2)]);
  const [r, s] = lines.map((l) => l.key);
  let st = { ...EMPTY_SPLIT_BILL, picked: { [r]: 1, [s]: 1 } };
  assert.equal(canCommit(st, lines), false, "no method chosen yet");
  st = { ...st, method: "cash", cash: "80" };
  assert.equal(canCommit(st, lines), false, "cash short");
  assert.equal(commitPicked(st, lines), st, "not ready = unchanged");
  st = { ...st, cash: "100" };
  assert.deepEqual(splitAmounts(st, lines), { total: 190, paid: 0, picked: 90, remaining: 190, received: 0 });
  st = commitPicked(st, lines);
  assert.deepEqual([st.paid, st.picked, st.cash, st.method], [{ [r]: 1, [s]: 1 }, {}, "", null]);
  assert.deepEqual(st.people, [{ method: "cash", amount: 90, received: 100 }]);
  assert.deepEqual(splitAmounts(st, lines), { total: 190, paid: 90, picked: 0, remaining: 100, received: 90 });
  assert.equal(splitPayment(st, lines), null, "not everyone paid");
  st = commitPicked({ ...st, picked: { [r]: 2, [s]: 1 }, method: "transfer" }, lines);
  assert.deepEqual(st.people[1], { method: "transfer", amount: 100 });
  assert.equal(splitAmounts(st, lines).remaining, 0);
});

// เล่นทั้งโต๊ะ: แต่ละคนเลือกรายการ + วิธีจ่าย → PaymentInput ของบิลที่ส่งเข้า closeTablesTx
const payAll = (lines, people) => {
  let st = EMPTY_SPLIT_BILL;
  for (const [pick, method, cash] of people) {
    const next = commitPicked({ ...st, picked: pick, method, cash: cash ?? "" }, lines);
    assert.notEqual(next, st, "person could not pay");
    st = next;
  }
  return st;
};

test("all cash → method cash, cashReceived = sum of cash received (receipt change adds up)", () => {
  const lines = splitLines([line(rice, 3), line(soup, 2)]); // 190
  const [r, s] = lines.map((l) => l.key);
  const st = payAll(lines, [[{ [r]: 1, [s]: 1 }, "cash", "100"], [{ [r]: 2, [s]: 1 }, "cash", "500"]]);
  const p = splitPayment(st, lines);
  assert.deepEqual(p, { method: "cash", cashReceived: 600 });
  assert.equal(p.cashReceived - 190, (100 - 90) + (500 - 100)); // เงินทอนบนใบเสร็จ = ผลรวมเงินทอนแต่ละคน
});

test("all transfer → method transfer, no cash fields", () => {
  const lines = splitLines([line(rice, 3), line(soup, 2)]);
  const [r, s] = lines.map((l) => l.key);
  const st = payAll(lines, [[{ [r]: 3 }, "transfer"], [{ [s]: 2 }, "transfer"]]);
  assert.deepEqual(splitPayment(st, lines), { method: "transfer" });
});

test("mixed → split: transferAmount = total transferred, cashReceived = cash received; cash part = bill − transfer", () => {
  const lines = splitLines([line(rice, 3), line(soup, 2)]); // 190
  const [r, s] = lines.map((l) => l.key);
  const st = payAll(lines, [
    [{ [s]: 1 }, "transfer"],           // 80 โอน
    [{ [r]: 2 }, "cash", "100"],        // 20 สด รับ 100
    [{ [r]: 1, [s]: 1 }, "cash", "90"], // 90 สด พอดี
  ]);
  const p = splitPayment(st, lines);
  assert.deepEqual(p, { method: "split", transferAmount: 80, cashReceived: 190 });
  assert.equal(190 - p.transferAmount, 110); // ส่วนเงินสด
  assert.equal(p.cashReceived - (190 - p.transferAmount), 80); // ทอนรวม = 80 + 0
});

test("totals that don't add up to the bill never produce a payment", () => {
  const lines = splitLines([line(rice, 3), line(soup, 2)]);
  const [r, s] = lines.map((l) => l.key);
  const st = payAll(lines, [[{ [r]: 3 }, "cash", "30"], [{ [s]: 2 }, "transfer"]]);
  assert.ok(splitPayment(st, lines));
  // เงินที่บันทึกไว้ไม่ตรงรายการ → null
  assert.equal(splitPayment({ ...st, people: [...st.people.slice(0, 1), { method: "transfer", amount: 150 }] }, lines), null);
  // ยกเลิกซุป 1 ชิ้นหลังซุปจ่ายไปแล้ว: รายการเหลือ 30 + 80 = 110 แต่รับเงินไป 190 → ห้ามปิด
  const after = splitLines([line(rice, 3), line(soup, 1)]);
  const rec = reconcileSplit(st, after);
  assert.equal(splitAmounts(rec, after).remaining, 0);
  assert.equal(splitAmounts(rec, after).received, 190);
  assert.equal(splitPayment(rec, after), null);
  // ยังมีที่เลือกค้าง / ยังไม่มีใครจ่าย / บิลว่าง
  assert.equal(splitPayment({ ...st, picked: { [r]: 1 } }, lines), null);
  assert.equal(splitPayment(EMPTY_SPLIT_BILL, lines), null);
  assert.equal(splitPayment(EMPTY_SPLIT_BILL, []), null);
});

test("bill grows mid-split (items added): new items still owed, next person pays them, then it closes", () => {
  const before = splitLines([line(rice, 3)]);
  const [r] = before.map((l) => l.key);
  let st = payAll(before, [[{ [r]: 3 }, "transfer"]]);
  assert.deepEqual(splitPayment(st, before), { method: "transfer" });
  const after = splitLines([line(rice, 3), line(menu("tea", 40), 1)]);
  st = reconcileSplit(st, after);
  assert.equal(splitPayment(st, after), null);
  assert.equal(splitAmounts(st, after).remaining, 40);
  st = commitPicked({ ...st, picked: { [after[1].key]: 1 }, method: "cash", cash: "50" }, after);
  assert.deepEqual(splitPayment(st, after), { method: "split", transferAmount: 30, cashReceived: 50 });
});

test("reconcileSplit: bill changes drop gone items and clamp quantities; unchanged returns same object", () => {
  const before = splitLines([line(rice, 3), line(soup, 2)]);
  const [r, s] = before.map((l) => l.key);
  const st = { ...EMPTY_SPLIT_BILL, paid: { [r]: 2 }, picked: { [r]: 1, [s]: 2 } };
  assert.equal(reconcileSplit(st, before), st);
  // ยกเลิกข้าว 1 (เหลือ 2 = จ่ายไปแล้วหมด) + ซุปถูกยกเลิกทั้งหมด
  const after = splitLines([line(rice, 2)]);
  const next = reconcileSplit(st, after);
  assert.deepEqual([next.paid, next.picked], [{ [r]: 2 }, {}]);
  assert.equal(splitAmounts(next, after).remaining, 0);
  // สั่งเพิ่ม: ไม่กระทบที่เลือกไว้
  const more = splitLines([line(rice, 3), line(soup, 2), line(menu("tea", 40), 1)]);
  assert.equal(reconcileSplit(st, more), st);
});

// localStorage จำลอง
const memKV = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m,
  };
};

test("split survives a reload on this device (same bill only); cleared on reset/close; expired or broken ones pruned", () => {
  const kv = memKV();
  const lines = splitLines([line(rice, 3), line(soup, 2)]);
  const [r, s] = lines.map((l) => l.key);
  const st = payAll(lines, [[{ [r]: 1 }, "cash", "20"]]);
  const mid = { ...st, picked: { [s]: 1 }, method: "transfer" };
  saveSplit("1-3", ["o1", "o2"], true, mid, kv);
  // รีโหลด: บิลเดิม (+ รอบใหม่ o3) → ได้คืนครบ
  const got = loadSplit("1-3", ["o1", "o2", "o3"], kv);
  assert.deepEqual(got.state, mid);
  assert.equal(got.open, true);
  // โต๊ะเดียวกันแต่เป็นบิลใหม่ (ลูกค้าคนใหม่) → ไม่ใช้ของเก่า
  assert.equal(loadSplit("1-3", ["n1"], kv), null);
  assert.equal(loadSplit("1-4", ["o1"], kv), null);
  // เริ่มใหม่ = state ว่าง → ลบที่เก็บไว้
  saveSplit("1-3", ["o1"], true, EMPTY_SPLIT_BILL, kv);
  assert.equal(kv.length, 0);
  // ปิดบิล
  saveSplit("1-3", ["o1"], true, mid, kv);
  clearSplit("1-3", kv);
  assert.equal(loadSplit("1-3", ["o1"], kv), null);
  // หมดอายุ / เสีย / เงินสดรับน้อยกว่ายอด → pruneSplits ลบ ของอื่นในเครื่องไม่แตะ
  kv.setItem("splitBill:v2:2-1", JSON.stringify({ open: true, state: mid, orderIds: ["x"], savedAt: Date.now() - SPLIT_MAX_AGE_MS - 1 }));
  kv.setItem("splitBill:v2:2-2", "{oops");
  kv.setItem("splitBill:v2:2-3", JSON.stringify({ open: true, state: { ...mid, people: [{ method: "cash", amount: 50, received: 10 }] }, orderIds: ["x"], savedAt: Date.now() }));
  saveSplit("2-4", ["y"], false, mid, kv);
  kv.setItem("receiptLayout", "new");
  pruneSplits(kv);
  assert.deepEqual([...kv._m.keys()].sort(), ["receiptLayout", "splitBill:v2:2-4"]);
});
