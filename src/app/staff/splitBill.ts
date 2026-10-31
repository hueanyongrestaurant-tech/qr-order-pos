// ─── เครื่องคิดเลขแยกจ่าย (หน้าจ่ายเงิน บิลโต๊ะ) ───
// แค่ช่วยคิดเงินทีละคน ไม่บันทึกอะไรเลย: ไม่เขียน Firestore ไม่พิมพ์ใบเสร็จ ไม่แตะการปิดบิล/สถิติ/paymentBatchId
// state อยู่ในหน่วยความจำของหน้าจ่ายเงินเท่านั้น — ปิดบิลยังทำครั้งเดียวทั้งโต๊ะเหมือนเดิม
import type { CartItem } from "../types";
import { cartItemKey, cartItemUnitPrice } from "../utils";

// บรรทัดของบิล 1 บรรทัด = รายการเดียวกัน (cartItemKey) ราคาต่อชิ้นเดียวกัน — แยกราคาไว้ด้วย
// เผื่อราคาเมนูเปลี่ยนระหว่างรอบ ยอดรวมทุกบรรทัดจึงเท่ายอดบิลพอดี
export interface SplitLine {
  key: string;
  ci: CartItem; // ตัวแทนไว้แสดงชื่อ/ตัวเลือก
  qty: number;  // จำนวนทั้งหมดในบิล
  unit: number; // ราคาต่อชิ้น
}

export interface SplitState {
  paid: Record<string, number>;   // ชิ้นที่ "คิดเงินแล้ว" (คนก่อนๆ) — เลือกซ้ำไม่ได้
  picked: Record<string, number>; // ชิ้นที่เลือกให้คนที่กำลังจ่าย
  cash: string;                   // รับเงินสดมา (ของคนนี้)
  people: number;                 // กด "คิดเงินแล้ว" ไปกี่คน
}

export const EMPTY_SPLIT_BILL: SplitState = { paid: {}, picked: {}, cash: "", people: 0 };

export function splitLines(items: CartItem[]): SplitLine[] {
  const map = new Map<string, SplitLine>();
  items.forEach((ci) => {
    if (ci.voided || ci.quantity <= 0) return;
    const unit = cartItemUnitPrice(ci);
    const key = `${cartItemKey(ci)}|${unit}`;
    const prev = map.get(key);
    if (prev) prev.qty += ci.quantity;
    else map.set(key, { key, ci, qty: ci.quantity, unit });
  });
  return [...map.values()];
}

// บิลเปลี่ยนระหว่างแยกจ่าย (สั่งเพิ่ม / ยกเลิกรายการ): ตัดรายการที่หายไปทิ้ง และลดจำนวนที่เกินของที่เหลือ
// คิดเงินแล้วก่อน แล้วที่เลือกอยู่ได้ไม่เกินที่ยังเหลือ — ไม่มีอะไรเปลี่ยนคืน state เดิม (ใช้เทียบได้ ไม่ re-render วน)
export function reconcileSplit(state: SplitState, lines: SplitLine[]): SplitState {
  const qty = new Map(lines.map((l) => [l.key, l.qty]));
  let changed = false;
  const clamp = (rec: Record<string, number>, room: (key: string) => number) => {
    const out: Record<string, number> = {};
    Object.entries(rec).forEach(([key, n]) => {
      const v = Math.min(n, room(key));
      if (v !== n) changed = true;
      if (v > 0) out[key] = v;
    });
    return out;
  };
  const paid = clamp(state.paid, (key) => qty.get(key) ?? 0);
  const picked = clamp(state.picked, (key) => (qty.get(key) ?? 0) - (paid[key] ?? 0));
  return changed ? { ...state, paid, picked } : state;
}

export function splitAmounts(state: SplitState, lines: SplitLine[]) {
  const sum = (rec: Record<string, number>) => lines.reduce((s, l) => s + (rec[l.key] ?? 0) * l.unit, 0);
  const total = lines.reduce((s, l) => s + l.qty * l.unit, 0);
  const paid = sum(state.paid);
  return { total, paid, picked: sum(state.picked), remaining: total - paid };
}

// "คิดเงินแล้ว": ที่เลือกไว้กลายเป็นจ่ายแล้ว แล้วล้างการเลือก/เงินสด ให้คนถัดไป
export function commitPicked(state: SplitState): SplitState {
  const paid = { ...state.paid };
  Object.entries(state.picked).forEach(([key, n]) => { paid[key] = (paid[key] ?? 0) + n; });
  return { paid, picked: {}, cash: "", people: state.people + 1 };
}
