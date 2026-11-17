// ─── แยกจ่าย (หน้าจ่ายเงิน บิลโต๊ะ) ───
// ทีละคน: เลือกรายการ → เงินสด/โอน (เงินสดกรอก "รับเงินมา" เห็นเงินทอน) → "คิดเงินแล้ว"
// คนสุดท้ายจ่ายครบ → ถามยืนยันครั้งเดียวแล้วปิดบิลผ่าน closeTablesTx เดิม (ไม่มีขั้นเลือกวิธีจ่ายซ้ำ)
// state เก็บในเครื่องนี้ต่อโต๊ะ (localStorage) — รีโหลด/ปิดแอปกลางทางแล้วยังรู้ว่าใครจ่ายไปแล้ว
// ไม่เขียน Firestore ระหว่างแยกจ่าย — เขียนครั้งเดียวตอนปิดบิล ด้วย splitPayment() → PaymentInput
import type { CartItem, PaymentInput } from "../types";
import { cartItemKey, cartItemUnitPrice } from "../utils";

// บรรทัดของบิล 1 บรรทัด = รายการเดียวกัน (cartItemKey) ราคาต่อชิ้นเดียวกัน — แยกราคาไว้ด้วย
// เผื่อราคาเมนูเปลี่ยนระหว่างรอบ ยอดรวมทุกบรรทัดจึงเท่ายอดบิลพอดี
export interface SplitLine {
  key: string;
  ci: CartItem; // ตัวแทนไว้แสดงชื่อ/ตัวเลือก
  qty: number;  // จำนวนทั้งหมดในบิล
  unit: number; // ราคาต่อชิ้น
}

export type SplitPayMethod = "cash" | "transfer";
// เงินที่รับจากคน 1 คน — amount = ยอดรายการที่คนนั้นจ่าย | received = เงินสดที่รับมา (เงินสดเท่านั้น ≥ amount)
export interface SplitPerson {
  method: SplitPayMethod;
  amount: number;
  received?: number;
}

export interface SplitState {
  paid: Record<string, number>;   // ชิ้นที่ "คิดเงินแล้ว" (คนก่อนๆ) — เลือกซ้ำไม่ได้
  picked: Record<string, number>; // ชิ้นที่เลือกให้คนที่กำลังจ่าย
  method: SplitPayMethod | null;  // วิธีจ่ายของคนที่กำลังจ่าย (ยังไม่เลือก = null)
  cash: string;                   // รับเงินสดมา (ของคนนี้)
  people: SplitPerson[];          // คนที่กด "คิดเงินแล้ว" ไปแล้ว ตามลำดับ
}

export const EMPTY_SPLIT_BILL: SplitState = { paid: {}, picked: {}, method: null, cash: "", people: [] };

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
// เงินที่รับไปแล้ว (people) ไม่ถูกแก้ — ถ้ารายการที่จ่ายไปแล้วถูกยกเลิก ยอดรับจะไม่ตรงบิล → splitPayment คืน null ปิดบิลไม่ได้
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
  const received = state.people.reduce((s, p) => s + p.amount, 0); // เงินที่คิดไปแล้วจริง (อาจไม่เท่า paid ถ้าบิลเปลี่ยน)
  return { total, paid, picked: sum(state.picked), remaining: total - paid, received };
}

// คนที่กำลังจ่ายพร้อมกด "คิดเงินแล้ว" ไหม: มีรายการ + เลือกวิธีจ่าย + เงินสดต้องกรอกรับมาไม่น้อยกว่ายอด
export function canCommit(state: SplitState, lines: SplitLine[]): boolean {
  const { picked } = splitAmounts(state, lines);
  if (picked <= 0 || !state.method) return false;
  if (state.method === "transfer") return true;
  return state.cash !== "" && Number(state.cash) >= picked;
}

// "คิดเงินแล้ว": ที่เลือกไว้กลายเป็นจ่ายแล้ว + จดวิธีจ่าย/ยอด/เงินที่รับของคนนี้ แล้วล้างให้คนถัดไป
// ยังไม่พร้อม (canCommit = false) คืน state เดิม
export function commitPicked(state: SplitState, lines: SplitLine[]): SplitState {
  if (!canCommit(state, lines)) return state;
  const amount = splitAmounts(state, lines).picked;
  const person: SplitPerson = state.method === "cash"
    ? { method: "cash", amount, received: Number(state.cash) }
    : { method: "transfer", amount };
  const paid = { ...state.paid };
  Object.entries(state.picked).forEach(([key, n]) => { paid[key] = (paid[key] ?? 0) + n; });
  return { paid, picked: {}, method: null, cash: "", people: [...state.people, person] };
}

// ยอดรวมเงินสด/โอนของทุกคน — แสดงในหน้าต่างยืนยันปิดบิล
export function splitTotals(state: SplitState) {
  let cash = 0, transfer = 0, received = 0;
  state.people.forEach((p) => {
    if (p.method === "cash") { cash += p.amount; received += p.received ?? p.amount; }
    else transfer += p.amount;
  });
  return { cash, transfer, received };
}

// ทุกคนจ่ายครบ → PaymentInput ของทั้งบิลสำหรับ closeTablesTx — ไม่ครบ/ยอดไม่ตรงบิลพอดี = null (ห้ามปิดบิล)
//   เงินสดทุกคน → cash   { cashReceived: เงินสดที่รับมารวม }
//   โอนทุกคน   → transfer
//   ผสม        → split  { transferAmount: ยอดโอนรวม, cashReceived: เงินสดที่รับมารวม } ส่วนเงินสด = ยอดบิล − ยอดโอน
// เงินทอนบนใบเสร็จ = cashReceived − ส่วนเงินสด = ผลรวมเงินทอนของแต่ละคนพอดี
export function splitPayment(state: SplitState, lines: SplitLine[]): PaymentInput | null {
  const a = splitAmounts(state, lines);
  if (state.people.length === 0 || a.total <= 0) return null;
  if (a.remaining !== 0 || Object.keys(state.picked).length > 0) return null;
  const { cash, transfer, received } = splitTotals(state);
  if (cash + transfer !== a.total || a.received !== a.total) return null;
  if (transfer === 0) return { method: "cash", cashReceived: received };
  if (cash === 0) return { method: "transfer" };
  return { method: "split", transferAmount: transfer, cashReceived: received };
}

// ─── เก็บในเครื่องนี้ต่อโต๊ะ (localStorage) ───
// ผูกกับ id ออเดอร์ของบิลตอนบันทึก: ใช้ต่อได้เฉพาะบิลเดิม (ยังมีออเดอร์เดิมอยู่สักใบ) — โต๊ะปิดบิลไปแล้ว
// ลูกค้าใหม่นั่งโต๊ะเดิม = ออเดอร์ชุดใหม่ ไม่ติดค่าเก่า | เก่ากว่า SPLIT_MAX_AGE_MS ทิ้ง
const SPLIT_KEY_PREFIX = "splitBill:v2:";
export const SPLIT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface StoredSplit {
  open: boolean;
  state: SplitState;
  orderIds: string[];
  savedAt: number;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const store = (): KV | null => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};

const isPerson = (p: any): p is SplitPerson =>
  p && (p.method === "cash" || p.method === "transfer") && Number.isFinite(p.amount) && p.amount > 0 &&
  (p.method === "transfer" || (Number.isFinite(p.received) && p.received >= p.amount));
const isCounts = (r: any) => r && typeof r === "object" && Object.values(r).every((n) => Number.isInteger(n) && (n as number) > 0);

export function parseStoredSplit(raw: string | null, now = Date.now()): StoredSplit | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const s = v?.state;
    if (!s || !isCounts(s.paid) || !isCounts(s.picked) || !Array.isArray(s.people) || !s.people.every(isPerson)) return null;
    if (!Array.isArray(v.orderIds) || !Number.isFinite(v.savedAt) || now - v.savedAt > SPLIT_MAX_AGE_MS) return null;
    return {
      open: !!v.open,
      orderIds: v.orderIds.filter((x: unknown) => typeof x === "string"),
      savedAt: v.savedAt,
      state: {
        paid: s.paid, picked: s.picked,
        method: s.method === "cash" || s.method === "transfer" ? s.method : null,
        cash: typeof s.cash === "string" ? s.cash.replace(/[^0-9]/g, "") : "",
        people: s.people,
      },
    };
  } catch { return null; }
}

// อ่านแยกจ่ายของโต๊ะนี้ — ใช้ได้เฉพาะเมื่อยังเป็นบิลเดิม (มี id ออเดอร์ร่วมกัน)
export function loadSplit(table: string, orderIds: string[], kv: KV | null = store()): StoredSplit | null {
  if (!kv) return null;
  try {
    const got = parseStoredSplit(kv.getItem(SPLIT_KEY_PREFIX + table));
    if (!got) return null;
    const ids = new Set(orderIds);
    return got.orderIds.some((id) => ids.has(id)) ? got : null;
  } catch { return null; }
}

export function saveSplit(table: string, orderIds: string[], open: boolean, state: SplitState, kv: KV | null = store()) {
  if (!kv) return;
  try {
    const empty = state.people.length === 0 && Object.keys(state.picked).length === 0 && !state.method && state.cash === "";
    if (empty) { kv.removeItem(SPLIT_KEY_PREFIX + table); return; } // ยังไม่มีอะไร / กดเริ่มใหม่ = ไม่ต้องเก็บ
    kv.setItem(SPLIT_KEY_PREFIX + table, JSON.stringify({ open, state, orderIds, savedAt: Date.now() } satisfies StoredSplit));
  } catch { /* เก็บไม่ได้ (private mode / เต็ม) — ยังใช้ในหน่วยความจำได้ */ }
}

export function clearSplit(table: string, kv: KV | null = store()) {
  try { kv?.removeItem(SPLIT_KEY_PREFIX + table); } catch { /* ignore */ }
}

// ล้างของเก่าที่หมดอายุ/อ่านไม่ได้ (เรียกตอนเปิดหน้าจ่ายเงิน) — โต๊ะที่ปิดบิลจากเครื่องอื่นไม่ค้างตลอดไป
export function pruneSplits(kv: KV | null = store(), now = Date.now()) {
  if (!kv) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i);
      if (k && k.startsWith(SPLIT_KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => { if (!parseStoredSplit(kv.getItem(k), now)) kv.removeItem(k); });
  } catch { /* ignore */ }
}
