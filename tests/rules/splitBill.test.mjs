// เครื่องคิดเลขแยกจ่าย (src/app/staff/splitBill.ts) — ตรรกะล้วน ไม่ต้องใช้ emulator
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SPLIT_BILL, commitPicked, reconcileSplit, splitAmounts, splitLines } from "../../src/app/staff/splitBill";

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

test("pick → คิดเงินแล้ว → next person; remaining always shown", () => {
  const lines = splitLines([line(rice, 3), line(soup, 2)]);
  const [r, s] = lines.map((l) => l.key);
  let st = { ...EMPTY_SPLIT_BILL, picked: { [r]: 1, [s]: 1 }, cash: "100" };
  assert.deepEqual(splitAmounts(st, lines), { total: 190, paid: 0, picked: 90, remaining: 190 });
  st = commitPicked(st);
  assert.deepEqual([st.paid, st.picked, st.cash, st.people], [{ [r]: 1, [s]: 1 }, {}, "", 1]);
  assert.deepEqual(splitAmounts(st, lines), { total: 190, paid: 90, picked: 0, remaining: 100 });
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
