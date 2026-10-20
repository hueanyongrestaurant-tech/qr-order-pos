import type { CartItem, Language, MeatChoice, MenuAvailability, MenuItem, Order, Portion, ServedUnits } from "./types";
import { closedSelectedChoices, isChoiceClosed, isQuickToggleGroup, requiredGroupAllClosed } from "./menuOptions";
import { ADD_ONS } from "./constants";
import { T } from "./translations";
import { db } from "../lib/firebase";
import { collection, documentId, getDocs, getDocsFromServer, orderBy, query, where, limit } from "firebase/firestore";

// ─── Utility functions ────────────────────────────────────────────────────────

// ─── สถานะการขาย (เมนู + ตัวเลือก) — ตัวเลือกดู menuOptions.ts ───────────────────

// สถานะที่ "ตั้งไว้" (ปุ่ม ขาย/หมด/ซ่อน ในหน้าจัดการเมนู) — "hidden" มาก่อนเสมอ
export function menuAvailabilitySetting(item: Pick<MenuItem, "active" | "soldOut">): MenuAvailability {
  if (item.active === false) return "hidden";
  if (item.soldOut) return "soldOut";
  return "available";
}

// สถานะ "ที่ลูกค้าเห็นจริง" — เหมือนที่ตั้งไว้ แต่ถ้ากลุ่มที่ต้องเลือกกลุ่มใดถูกปิดหมดทุกตัว นับเป็นหมดด้วย
export function menuAvailability(item: MenuItem): MenuAvailability {
  const setting = menuAvailabilitySetting(item);
  if (setting === "available" && requiredGroupAllClosed(item)) return "soldOut";
  return setting;
}

// รายการในตะกร้า 1 รายการ สั่งไม่ได้แล้วหรือยัง เทียบกับข้อมูลเมนูล่าสุด (fresh): เมนูหมด/ซ่อน
// หรือเลือกตัวเลือกที่ตอนนี้ปิดอยู่ (ทุกกลุ่ม รวมรายการแบบเดิมที่เก็บเป็น meat/portion/...)
export function isCartItemUnavailable(ci: CartItem, fresh: MenuItem): boolean {
  if (menuAvailability(fresh) !== "available") return true;
  return closedSelectedChoices(ci, fresh).length > 0;
}

// ข้อมูลที่จะบันทึกจากหน้าแก้เมนู (setDoc เขียนทับทั้ง doc) — item และ prev ต้องผ่าน normalizeMenuItem แล้ว
// สถานะการขายต้องเอาจากค่าล่าสุดใน Firestore (prev) ไม่ใช่จาก form ที่ copy ไว้ตอนเปิดหน้าแก้ — ไม่งั้นแก้ชื่อ/ราคาแล้ว
// เมนูหรือตัวเลือกที่ "หมด/ปิด" อยู่จะกลับมาขาย หรือทับสถานะที่เครื่องอื่นเพิ่งเปลี่ยนระหว่างที่เปิดหน้าแก้ค้างไว้
// • เมนู: active / soldOut จาก prev (เมนูใหม่ = ขายปกติ)
// • ตัวเลือก: ตัวที่มีอยู่แล้วใน prev (id กลุ่ม+ตัวเลือก ตรงกัน) เอา เปิด/ปิด (+ ธง soldOutByPrep) จาก prev — สวิตช์ในหน้าแก้เขียนลง DB ทันทีอยู่แล้ว
//   ตัวที่เพิ่มใหม่ใน form (ยังไม่มีใน DB) เอาจาก form
// • แนะนำ (recommended / recommendedOrder): จาก prev เหมือนกัน — ตั้งจากปุ่มดาวในหน้าจัดการเมนูเท่านั้น
export function withLiveAvailability(item: MenuItem, prev: MenuItem | undefined): MenuItem {
  const liveChoices = new Map<string, boolean>();
  const byPrep = new Set<string>(); // ตัวเลือกที่ระบบปิดเพราะของเตรียม (ธงจากค่าล่าสุด ไม่ใช่จาก form)
  prev?.customGroups?.forEach((g) => g.choices.forEach((c) => {
    liveChoices.set(`${g.id}:${c.id}`, isChoiceClosed(c));
    if (c.soldOutByPrep) byPrep.add(`${g.id}:${c.id}`);
  }));
  const { recommended: _staleRecommended, recommendedOrder: _staleRecommendedOrder, soldOutMeats: _staleSoldOutMeats, ...rest } = item;
  return {
    ...rest,
    // Firestore ไม่รับ undefined — ใส่เฉพาะตอนมีค่า
    ...(prev?.recommended ? { recommended: true } : {}),
    ...(prev?.recommended && typeof prev.recommendedOrder === "number" ? { recommendedOrder: prev.recommendedOrder } : {}),
    active: prev ? prev.active ?? true : true,
    soldOut: prev?.soldOut ?? false,
    ...(item.customGroups
      ? {
        customGroups: item.customGroups.map((g) => ({
          ...g,
          choices: g.choices.map(({ soldOut: formSoldOut, active: _active, soldOutByPrep: _staleByPrep, ...c }) => {
            const key = `${g.id}:${c.id}`;
            const closed = liveChoices.get(key) ?? !!formSoldOut;
            return closed ? { ...c, soldOut: true, ...(byPrep.has(key) ? { soldOutByPrep: true } : {}) } : c;
          }),
        })),
      }
      : {}),
  };
}

// ชื่อตัวเลือกในกลุ่มปุ่มด่วน (เช่นเนื้อสัตว์) ที่เลือกในรายการตะกร้า — ไว้ต่อท้ายชื่อเมนูในข้อความเตือน
// เช่น "ข้าวผัด (แหนม)" ให้รู้ว่าตัวไหนหมด ไม่มีคืน ""
export function cartItemMeatLabel(ci: CartItem, lang: Language): string {
  const labels: string[] = [];
  if (ci.meat) labels.push(T[lang].meats[ci.meat]);
  (ci.item.customGroups || []).filter(isQuickToggleGroup).forEach((g) => {
    const selected = ci.customSelections?.[g.id] || [];
    g.choices.filter((c) => selected.includes(c.id)).forEach((c) => labels.push(lang === "en" ? c.labelEn : c.labelTh));
  });
  return labels.join(", ");
}

// ดึงข้อมูลล่าสุดจาก server ของเมนูในตะกร้าก่อนส่งออเดอร์ (หน้าเมนูลูกค้า cache ไว้ได้ถึง 15 นาที
// จึงอาจยังเห็นเมนู/เนื้อที่เพิ่งกด "หมด" ว่าขายอยู่) คืน map id → ข้อมูลเมนูล่าสุด ให้ผู้เรียกตัดสินเองทีละรายการ
// ห้ามทำให้ลูกค้าติดส่งไม่ได้: offline / error / ช้าเกิน timeoutMs → คืน map ว่าง = ข้ามการเช็คแล้วส่งตามปกติ
// เมนูที่ไม่มี doc (เช่นรายการ addon-xxx ที่พนักงานพิมพ์เอง หรือเมนูที่ถูกลบ) ไม่อยู่ใน map = ไม่นับว่าหมด
export async function fetchFreshMenuItems(
  itemIds: string[],
  timeoutMs: number,
): Promise<Map<string, MenuItem>> {
  const none = new Map<string, MenuItem>();
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return none;
  const check = async () => {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30)); // "in" รับได้สูงสุด 30 ค่า
    const snaps = await Promise.all(
      chunks.map((chunk) => getDocsFromServer(query(collection(db, "menuItems"), where(documentId(), "in", chunk)))),
    );
    const result = new Map<string, MenuItem>();
    snaps.flatMap((s) => s.docs).forEach((d) => result.set(d.id, { id: d.id, ...d.data() } as MenuItem));
    return result;
  };
  let timer: number | undefined;
  const timeout = new Promise<Map<string, MenuItem>>((resolve) => {
    timer = window.setTimeout(() => resolve(none), timeoutMs);
  });
  try {
    return await Promise.race([check(), timeout]);
  } catch (err) {
    console.error("fetchFreshMenuItems failed — skipping sold-out check", err);
    return none;
  } finally {
    window.clearTimeout(timer);
  }
}

export function resolvePhoto(photo: string, w = 400, h = 300): string {
  if (!photo) return "";
  // data: = base64 เก่า (ก่อน migrate ไป Storage), http = URL เต็มจาก Storage (Supabase) — คืนค่าตรงๆ ทั้งคู่
  if (photo.startsWith("data:") || photo.startsWith("http")) return photo;
  return `https://images.unsplash.com/photo-${photo}?w=${w}&h=${h}&fit=crop&auto=format`; // Unsplash photo ID (เมนูตัวอย่างเดิม)
}

export function itemPrice(
  item: MenuItem,
  meat: MeatChoice | undefined,
  portion: Portion | undefined,
  addEgg: boolean,
  addOns: string[],
  customSelections: Record<string, string[]> = {},
  customAddOnPrice = 0 // ราคารายการที่พนักงานพิมพ์เพิ่มเอง (ไม่มีในเมนู) — staff-only
): number {
  let price = item.price;
  if (meat && item.meatPriceDeltas?.[meat]) price += item.meatPriceDeltas[meat]!;
  if (portion === "special" && item.portionPriceDelta) price += item.portionPriceDelta;
  if (addEgg) price += 15;
  (addOns || []).forEach((id) => {
    const found = ADD_ONS.find((a) => a.id === id);
    if (found) price += found.price;
  });
  item.customGroups?.forEach((group) => {
    const selected = customSelections[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) price += choice.priceDelta;
    });
  });
  price += customAddOnPrice;
  return price;
}

// ราคาต่อหน่วยของรายการ (ยังไม่คูณจำนวน) — ใช้ตอนต้องบันทึกมูลค่าที่ถูก void ลง log
export function cartItemUnitPrice(ci: CartItem): number {
  return itemPrice(ci.item, ci.meat, ci.portion, ci.addEgg, ci.addOns, ci.customSelections, ci.customAddOnPrice || 0);
}

export function cartItemTotal(ci: CartItem): number {
  if (ci.voided) return 0; // รายการที่ถูกยกเลิก ไม่นับรวมยอดเงินในบิล
  return cartItemUnitPrice(ci) * ci.quantity;
}

// ตัดรูป base64 ของรายการทิ้ง (แตะเฉพาะ item.photo — field อื่นอยู่ครบเป๊ะ)
// ใช้ตอนบันทึกออเดอร์ใหม่ และตอน void/cancel — ไม่มีหน้าไหนโชว์รูปจากออเดอร์ที่ persist แล้ว
// แต่รูป base64 ทำให้ doc บวมหนัก (~163 KB/ใบ)
export function stripItemPhoto(ci: CartItem): CartItem {
  return { ...ci, item: { ...ci.item, photo: "" } };
}

// รายการที่ยังมีผล (ตัดรายการที่ถูก void ออก) — ใช้ตอนคิดยอด/นับจำนวน ไม่ใช่ตอนแสดงผล
export function liveItems(items: CartItem[]): CartItem[] {
  return items.filter((ci) => !ci.voided);
}

export function liveItemCount(items: CartItem[]): number {
  return liveItems(items).reduce((s, ci) => s + ci.quantity, 0);
}

// ─── เสิร์ฟทีละจำนวน ───────────────────────────────────────────────────────────
// ใช้ได้ทั้งกับ Order ที่ map แล้ว และข้อมูลดิบจาก transaction (servedAt เป็น Timestamp — เช็คแค่ว่ามี key)
export interface ServeState {
  status?: string;
  servedAt?: Record<string, unknown>;
  servedUnits?: Record<string, ServedUnits | undefined>;
}

// จำนวนชิ้นที่เสิร์ฟแล้วของบรรทัดนี้ ไม่สน status — servedAt = ครบทั้งบรรทัด (ข้อมูลเดิมก็แบบนี้)
// ไม่งั้นนับจาก servedUnits.count (จำกัดไม่เกินจำนวนสั่ง เผื่อถูกปรับจำนวนลงทีหลัง)
export function lineServedQty(state: ServeState, ci: CartItem): number {
  if (state.servedAt?.[ci.cartId]) return ci.quantity;
  const n = state.servedUnits?.[ci.cartId]?.count ?? 0;
  return Math.max(0, Math.min(Math.floor(n), ci.quantity));
}

export function lineFullyServed(state: ServeState, ci: CartItem): boolean {
  return lineServedQty(state, ci) >= ci.quantity;
}

// จำนวนชิ้นที่เสิร์ฟแล้วตามสถานะออเดอร์ — พ้น in-progress แล้วถือว่าเสิร์ฟครบทุกชิ้น
export function servedQtyOf(order: ServeState, ci: CartItem): number {
  return order.status !== "in-progress" ? ci.quantity : lineServedQty(order, ci);
}

// คำนวณการเสิร์ฟเพิ่ม want ชิ้น (ตัดให้อยู่ใน 1..ที่เหลือ) — null = ไม่มีอะไรให้เสิร์ฟ
// complete = บรรทัดนี้ครบแล้ว (ต้องจด servedAt), orderComplete = ทุกบรรทัดที่ไม่ void ครบ (เปลี่ยน status)
export function planServe(state: ServeState, items: CartItem[], cartId: string, want: number):
  { add: number; count: number; complete: boolean; orderComplete: boolean } | null {
  if (state.status !== "in-progress") return null;
  const target = items.find((ci) => ci.cartId === cartId);
  if (!target || target.voided) return null;
  const cur = lineServedQty(state, target);
  const remaining = target.quantity - cur;
  if (remaining <= 0) return null;
  const add = Math.max(1, Math.min(Math.floor(want) || 1, remaining));
  const count = cur + add;
  const complete = count >= target.quantity;
  const orderComplete = complete && liveItems(items).every((ci) => ci.cartId === cartId || lineFullyServed(state, ci));
  return { add, count, complete, orderComplete };
}

// คำนวณการย้อนเสิร์ฟ — want = จำนวนที่ย้อน (แถบเลิกทำส่งจำนวนที่เพิ่งกดมาตรงๆ) ไม่ส่ง = ย้อน "ชุดล่าสุด":
// บรรทัดที่ครบด้วย servedAt → servedUnits.last (ข้อมูลเดิมไม่มี = ทั้งบรรทัด)
// ออเดอร์รอชำระที่บรรทัดนี้ครบเพราะ "เสิร์ฟทั้งหมด" (ไม่มี servedAt) → ส่วนที่ "เสิร์ฟทั้งหมด" เติมให้
// ยังเสิร์ฟไม่ครบ → servedUnits.last หรือทั้งหมดที่เสิร์ฟไว้
// คืน count = จำนวนที่เหลือว่าเสิร์ฟแล้วหลังย้อน (0 = กลับเป็นยังไม่เสิร์ฟทั้งบรรทัด) — null = ไม่มีอะไรให้ย้อน
export function planUnserve(state: ServeState, ci: CartItem, want?: number): { back: number; count: number } | null {
  if (ci.voided || (state.status !== "in-progress" && state.status !== "awaiting-payment")) return null;
  const units = state.servedUnits?.[ci.cartId];
  const partial = Math.max(0, Math.min(Math.floor(units?.count ?? 0), ci.quantity));
  let cur: number;
  let lastBatch: number;
  if (state.servedAt?.[ci.cartId]) {
    cur = ci.quantity;
    lastBatch = units?.last ?? ci.quantity;
  } else if (state.status === "awaiting-payment") {
    cur = ci.quantity;
    lastBatch = ci.quantity - partial;
  } else if (state.status === "in-progress") {
    cur = partial;
    lastBatch = units?.last ?? partial;
  } else {
    return null;
  }
  if (cur <= 0) return null;
  const back = Math.max(1, Math.min(Math.floor(want ?? lastBatch) || cur, cur));
  return { back, count: cur - back };
}

// ─── ยกเลิก (void) / ปรับจำนวน — คำนวณ items[] ใหม่จากข้อมูลล่าสุดใน transaction ─────────────
// ผลที่ต้องเขียนเพิ่มนอกจาก items[]:
// completeLine = บรรทัดเดิมกลายเป็นเสิร์ฟครบ (ยกเลิก/ลดเฉพาะชิ้นที่ยังไม่เสิร์ฟจนหมด) → จด servedAt ให้ (แอปเก่าเห็นตรงกัน)
// status = "cancelled" (ไม่เหลือรายการเลย) | "awaiting-payment" (ที่เหลือเสิร์ฟครบหมดแล้ว) | undefined = ไม่เปลี่ยน
export interface LineChangePlan {
  items: CartItem[];
  completeLine: boolean;
  status?: "cancelled" | "awaiting-payment";
}

function settleAfterChange(state: ServeState, newItems: CartItem[], cartId: string): LineChangePlan {
  const live = liveItems(newItems);
  if (live.length === 0) return { items: newItems, completeLine: false, status: "cancelled" };
  const line = live.find((ci) => ci.cartId === cartId);
  const completeLine =
    state.status === "in-progress" && !!line && !state.servedAt?.[cartId] && lineServedQty(state, line) > 0 && lineFullyServed(state, line);
  const allServed = state.status === "in-progress" && live.every((ci) => lineFullyServed(state, ci));
  return { items: newItems, completeLine, ...(allServed ? { status: "awaiting-payment" as const } : {}) };
}

export interface VoidPlan extends LineChangePlan {
  n: number;              // ยกเลิกกี่ชิ้น
  quantityBefore: number; // จำนวนของบรรทัดก่อนยกเลิก
  voidedCartId: string;   // cartId ของรายการที่ถูก void (ใช้คืนรายการ) — แยกบรรทัด = splitId
  target: CartItem;
}

// ยกเลิก want ชิ้นของรายการ cartId
// - ปกติ (ปุ่ม ✕ / ยกเลิกรายการค้างในหน้าจ่ายเงิน): ยกเลิกได้เฉพาะชิ้นที่ยังไม่เสิร์ฟ — ชิ้นที่เสิร์ฟแล้วยังคิดเงินเสมอ
//   ยกเลิกไม่หมดบรรทัด = แยกบรรทัด: บรรทัดเดิมเหลือ quantity - n (ข้อมูลเสิร์ฟคงเดิม) + บรรทัดใหม่ (splitId)
//   จำนวน n ที่ voided ต่อท้ายบรรทัดเดิม — items[] ไม่มีอะไรถูกลบออก ยอดบิลลดตาม n พอดี
// - wholeLine (กด − จนเหลือ 0 ในหน้าจ่ายเงิน): ยกเลิกทั้งบรรทัด รวมชิ้นที่เสิร์ฟแล้ว (ลดจานที่เสิร์ฟแล้วได้ตามเดิม)
// null = ไม่มีอะไรให้ยกเลิก (บิลปิดแล้ว / void ไปแล้ว / ไม่มีชิ้นที่ยังไม่เสิร์ฟ)
export function planVoid(
  state: ServeState,
  items: CartItem[],
  cartId: string,
  want: number,
  opts: { wholeLine?: boolean; splitId: string; reason: string; now: Date },
): VoidPlan | null {
  if (state.status !== "in-progress" && state.status !== "awaiting-payment") return null;
  const target = items.find((ci) => ci.cartId === cartId);
  if (!target || target.voided) return null;
  const q = target.quantity;
  const served = servedQtyOf(state, target);
  const voidable = opts.wholeLine ? q : q - served;
  if (voidable <= 0) return null;
  const n = opts.wholeLine ? q : Math.max(1, Math.min(Math.floor(want) || 1, voidable));
  const voidFields = {
    voided: true as const,
    ...(opts.reason ? { voidReason: opts.reason } : {}),
    voidedAt: opts.now,
  };
  let newItems: CartItem[];
  let voidedCartId = cartId;
  if (n === q) {
    newItems = items.map((ci) =>
      ci.cartId === cartId
        ? stripItemPhoto({ ...ci, ...voidFields, ...(state.status === "in-progress" && served < q ? { voidedWhileUnserved: true } : {}) })
        : ci,
    );
  } else {
    voidedCartId = opts.splitId;
    newItems = items.flatMap((ci) =>
      ci.cartId === cartId
        ? [{ ...ci, quantity: q - n }, stripItemPhoto({ ...ci, cartId: opts.splitId, quantity: n, ...voidFields, voidedWhileUnserved: true })]
        : [ci],
    );
  }
  return { ...settleAfterChange(state, newItems, cartId), n, quantityBefore: q, voidedCartId, target };
}

// ปรับจำนวน +/− (ไม่ถึง 0) จากหน้าจ่ายเงิน — ลดได้ทั้งชิ้นที่เสิร์ฟแล้วและยังไม่เสิร์ฟ (ตามเดิม)
// ลดจนที่เหลือเสิร์ฟครบ → completeLine/status ตามกฎเดียวกับการเสิร์ฟ ไม่ให้การ์ดค้างในโซนกำลังเตรียม
export function planAdjustQty(state: ServeState, items: CartItem[], cartId: string, delta: number):
  (LineChangePlan & { oldQty: number; newQty: number; target: CartItem }) | null {
  if (state.status !== "in-progress" && state.status !== "awaiting-payment") return null;
  const target = items.find((ci) => ci.cartId === cartId);
  if (!target || target.voided) return null;
  const newQty = target.quantity + delta;
  if (newQty <= 0 || delta === 0) return null;
  const newItems = items.map((ci) => (ci.cartId === cartId ? { ...ci, quantity: newQty } : ci));
  return { ...settleAfterChange(state, newItems, cartId), oldQty: target.quantity, newQty, target };
}

// รายการที่ยังไม่เสิร์ฟ (ไม่นับที่ void แล้ว) — ออเดอร์ที่พ้น in-progress ไปแล้วถือว่าเสิร์ฟครบทุกรายการ
// (รวมออเดอร์เก่าที่กด "เสิร์ฟทั้งหมด" ซึ่งไม่มี servedAt เลย)
// quantity ของแต่ละตัว = จำนวนที่ "ยังไม่เสิร์ฟ" (เสิร์ฟไปแล้วบางส่วนจะเหลือน้อยกว่าที่สั่ง) — เป็นสำเนา
// ใช้นับ/แสดง/พิมพ์ใบย้ายเท่านั้น ห้ามเอาไปเขียนกลับลง items[] (ข้อมูลคิดเงิน)
export function unservedItems(order: Order): CartItem[] {
  if (order.status !== "in-progress") return [];
  return liveItems(order.items).flatMap((ci) => {
    const left = ci.quantity - lineServedQty(order, ci);
    if (left <= 0) return [];
    return [left === ci.quantity ? ci : { ...ci, quantity: left }];
  });
}

// ─── ส่งออเดอร์ฝั่งลูกค้า: กันออเดอร์ซ้ำตอนกดส่งใหม่ ─────────────────────────────────
// ทุกครั้งที่กดส่งตะกร้าเดิม เขียน (setDoc) ลง doc id เดิมที่สุ่มไว้ตั้งแต่ครั้งแรก — เขียนซ้ำไม่มีทางได้ 2 ออเดอร์
// ลูกค้าไม่มีสิทธิ์อ่าน/แก้ออเดอร์ (rules ให้แค่ create) ถ้า doc id นี้ถูกสร้างไปแล้วจริง การเขียนซ้ำจะกลายเป็น
// update → permission-denied ซึ่งแปลว่า "ส่งถึงแล้วตั้งแต่รอบก่อน" — แต่นับแบบนั้นเฉพาะเมื่อรอบก่อนจบแบบไม่รู้ผล
// (หมดเวลา/เน็ตหลุด) ถ้ายังไม่เคยมีรอบไหนไม่รู้ผล permission-denied คือถูกปฏิเสธจริง
// errCode: undefined = เขียนสำเร็จ, "timeout" = รอเกิน ORDER_SEND_TIMEOUT_MS, อื่นๆ = code ของ FirestoreError
// sent = ส่งถึงแล้ว | uncertain = ไม่รู้ว่าถึงหรือไม่ (ให้กดส่งใหม่ด้วย id เดิม) | failed = ถูกปฏิเสธแน่นอน
export type OrderSendOutcome = "sent" | "uncertain" | "failed";
const DEFINITE_REJECTIONS = new Set(["permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "unauthenticated"]);
export function orderSendOutcome(errCode: string | undefined, earlierAttemptUncertain: boolean): OrderSendOutcome {
  if (errCode === undefined) return "sent";
  if (errCode === "permission-denied" && earlierAttemptUncertain) return "sent";
  return DEFINITE_REJECTIONS.has(errCode) ? "failed" : "uncertain";
}

export function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

export function orderTotal(order: Order): number {
  return order.items.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

// ยอดเงินสด/โอนของออเดอร์ที่จ่ายแล้ว 1 ใบ — หน้าสถิติ/ประวัติใช้ตัวนี้ตัวเดียว
// บิลเก่า (cash/transfer) นับทั้งใบเข้าฝั่งเดียวเหมือนเดิม ไม่มี paymentMethod = ไม่นับทั้งสองฝั่ง (เหมือนเดิม)
export function orderPaymentBreakdown(order: Order): { cash: number; transfer: number } {
  const total = orderTotal(order);
  switch (order.paymentMethod) {
    case "cash": return { cash: total, transfer: 0 };
    case "transfer": return { cash: 0, transfer: total };
    case "split": {
      const transfer = Math.min(Math.max(order.transferAmount ?? 0, 0), total);
      return { cash: total - transfer, transfer };
    }
    default: return { cash: 0, transfer: 0 };
  }
}

// แบ่งยอดโอนของทั้งบิลลงออเดอร์แต่ละใบ: เติมทีละใบตามลำดับที่ส่งมา (เก่า→ใหม่) จนครบยอด
// ผลรวมเท่ากับ transferTotal พอดี (ถ้าไม่เกินยอดบิล) และไม่มีใบไหนได้เกินยอดของตัวเอง ไม่มีเศษทศนิยม
export function allocateTransfer(orderTotals: number[], transferTotal: number): number[] {
  let remaining = transferTotal;
  return orderTotals.map((total) => {
    const share = Math.min(total, Math.max(remaining, 0));
    remaining -= share;
    return share;
  });
}

export function cartItemKey(ci: CartItem): string {
  return JSON.stringify({
    id: ci.item.id,
    meat: ci.meat,
    portion: ci.portion,
    spiceLevel: ci.spiceLevel,
    addEgg: ci.addEgg,
    addOns: [...(ci.addOns || [])].sort(),
    customSelections: ci.customSelections,
    note: ci.note || "",
    customNote: ci.customNote || "",
    customAddOnPrice: ci.customAddOnPrice || 0,
  });
}

export function mergeIntoCart(cart: CartItem[], newItem: CartItem): CartItem[] {
  const key = cartItemKey(newItem);
  const idx = cart.findIndex((ci) => cartItemKey(ci) === key);
  if (idx === -1) return [...cart, newItem];
  const updated = [...cart];
  updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + newItem.quantity };
  return updated;
}

export function formatOptionDetails(ci: CartItem, lang: Language): string {
  const t = T[lang];
  const parts: string[] = [];
  if (ci.meat) parts.push(t.meats[ci.meat]);
  if (ci.portion === "special") parts.push(t.special);
  if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(t.spiceLevels[ci.spiceLevel]);
  if (ci.addEgg) parts.push(t.eggAdded);
  (ci.addOns || []).forEach((id) => {
    const addon = ADD_ONS.find((a) => a.id === id);
    if (addon) parts.push(lang === "en" ? addon.label.en : addon.label.th);
  });
  ci.item.customGroups?.forEach((group) => {
    const selected = ci.customSelections?.[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
    });
  });
  return parts.join(", ");
}

export function parseTableKey(tn: string): [number, number] {
  const [floor, table] = tn.split("-").map(Number);
  return [floor || 0, table || 0];
}

export function compareTables(a: string, b: string): number {
  const [af, at] = parseTableKey(a);
  const [bf, bt] = parseTableKey(b);
  return af !== bf ? af - bf : at - bt;
}

export function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  return `${mins} min ago`;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// แปลง 1 document ของ collection "orders" เป็น Order — ใช้ร่วมกันทั้ง realtime listener
// (ออเดอร์ที่ active) และ query แบบครั้งเดียวของหน้า History/Stats เพื่อให้ mapping ตรงกันเป๊ะ
export function mapOrderDoc(id: string, raw: any): Order {
  return {
    id,
    tableNumber: raw.tableNumber,
    timestamp: raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(),
    items: raw.items,
    status: raw.status,
    // serverTimestamp() ที่ยังเขียนไม่เสร็จจะอ่านได้เป็น null — ใช้เวลาเครื่องแทนไปก่อน key ยังอยู่ครบ
    servedAt: raw.servedAt
      ? Object.fromEntries(
          Object.entries(raw.servedAt).map(([k, v]: [string, any]) => [k, v?.toDate ? v.toDate() : new Date()]),
        )
      : undefined,
    servedUnits: raw.servedUnits || undefined,
    paymentMethod: raw.paymentMethod,
    cashReceived: raw.cashReceived,
    transferAmount: raw.transferAmount,
    isTakeaway: raw.isTakeaway,
    takeawayLabel: raw.takeawayLabel,
    paymentBatchId: raw.paymentBatchId,
    paidAt: raw.paidAt?.toDate ? raw.paidAt.toDate() : undefined,
    cancelReason: raw.cancelReason,
    cancelledAt: raw.cancelledAt?.toDate ? raw.cancelledAt.toDate() : undefined,
    backfilled: raw.backfilled === true ? true : undefined,
    backfilledAt: raw.backfilledAt?.toDate ? raw.backfilledAt.toDate() : undefined,
    moveId: raw.moveId,
    movedFrom: raw.movedFrom,
    movedAt: raw.movedAt?.toDate ? raw.movedAt.toDate() : undefined,
  } as Order;
}

// แปลงชื่อของเป็น id ที่ใช้เป็น Firestore doc id ได้ (ตัดอักขระที่ Firestore ไม่รับ)
// รายชื่อของที่ซื้อเข้าร้านมีจำกัด (ไม่กี่สิบ-ร้อยรายการ) จึงใช้ชื่อเป็น id ตรงๆ
// เพื่อกันไม่ให้มี doc ซ้ำสำหรับของชิ้นเดียวกัน
export function expenseCatalogId(name: string): string {
  const cleaned = name.trim().replace(/[\/\\.#$\[\]\s]+/g, "-").slice(0, 120);
  return cleaned || uid();
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getTodayKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// "YYYY-MM-DD" ของเมื่อวาน (เวลาเครื่อง) — วันเดียวที่เพิ่มบิลย้อนหลังได้
export function getYesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateInput(d);
}

// บิลย้อนหลัง: สิ่งที่ "หมด" ตอนนี้อาจยังมีขายในวันนั้น — ล้างสถานะหมดทุกชั้น (เมนู, เนื้อในตัว, ตัวเลือกกลุ่ม)
// ให้หน้าเลือกเมนูเดิมกดได้ตามปกติ ส่วนที่ "ซ่อน" (active: false) ไม่แตะ ถูกกรองออกจาก menuItems ตั้งแต่ App แล้ว
export function ignoreSoldOut<M extends MenuItem>(item: M): M {
  return {
    ...item,
    soldOut: false,
    customGroups: item.customGroups?.map((g) => ({
      ...g,
      choices: g.choices.map(({ soldOut: _soldOut, active: _active, ...c }) => c),
    })),
  };
}

export function compressImage(file: File, maxWidth = 600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// query ออเดอร์ที่ชำระเงินแล้วตามช่วงเวลา (bin ตาม createdAt เหมือน logic เดิมของ History/Stats)
// ไม่ใช่ realtime — เรียกตอนเข้าหน้า/เปลี่ยนช่วงวันที่ เพราะเป็นข้อมูลที่ปิดรอบแล้ว
// ตั้งใจ filter createdAt อย่างเดียว (single-field index อัตโนมัติ) แล้วกรอง status === "paid"
// ฝั่ง client — จะได้ไม่ต้องสร้าง/รอ composite index และไม่มีอะไรพังตอน deploy
// (ออเดอร์ in-progress/cancelled ในช่วงย้อนหลัง 30+ วัน แทบไม่มี จึงแทบไม่มี overhead)
// limit เป็นแค่กันหลุด (safety cap) ไม่ใช่ pagination จริง
export const PAID_ORDERS_QUERY_CAP = 8000;
export async function fetchPaidOrders(startInclusive: Date, endExclusive: Date): Promise<Order[]> {
  const snap = await getDocs(
      query(
        collection(db, "orders"),
        where("createdAt", ">=", startInclusive),
        where("createdAt", "<", endExclusive),
        orderBy("createdAt", "asc"),
        limit(PAID_ORDERS_QUERY_CAP),
      ),
    );
  return snap.docs
    .map((d) => mapOrderDoc(d.id, d.data()))
    .filter((o) => o.status === "paid");
}

// ─── cache ออเดอร์ที่ชำระแล้ว แยกรายวัน (ในหน่วยความจำ ใช้ร่วมกันระหว่าง History กับ Stats) ───
// ประหยัด Firestore reads: เข้าแท็บซ้ำ/สลับช่วงวันที่กลับไปมา ไม่ต้องดึงใหม่ทั้งช่วง
// - วันที่ผ่านมาแล้ว: ใช้ cache ไปจนกว่าจะรีเฟรชหน้า/ปิดแอป, กดปุ่มรีเฟรช หรือถูกล้างด้วย invalidatePaidOrdersDay
//   (บันทึก/ยกเลิกบิลย้อนหลังล้างวันนั้นให้เอง)
// - วันนี้ (ยังขายอยู่): ใช้ cache ได้ TODAY_PAID_CACHE_TTL_MS แล้วค่อยดึงใหม่ — กดรีเฟรชเพื่อดูล่าสุดทันที
// ดึงเฉพาะวันที่ขาด เป็น query เดียวตั้งแต่วันแรกที่ขาดถึงวันสุดท้ายที่ขาด (เช่น Stats 7 วัน = ดึงแค่วันนี้)
const TODAY_PAID_CACHE_TTL_MS = 5 * 60 * 1000;
const paidOrdersByDay = new Map<string, { orders: Order[]; fetchedAt: number }>();

export function invalidatePaidOrdersDay(dateKey: string) {
  paidOrdersByDay.delete(dateKey);
}

// "YYYY-MM-DD" ทุกวันตั้งแต่ startKey ถึง endKey (รวมทั้งสองฝั่ง) — ช่วงผิด/ว่าง คืน []
function dayKeysInRange(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return keys;
  while (cursor <= end && keys.length < 1000) {
    keys.push(formatDateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

// fetchedAt = เวลาดึงของวันที่เก่าที่สุดในช่วง (ไว้โชว์ "ข้อมูล ณ HH:MM")
export async function fetchPaidOrdersCached(
  startKey: string,
  endKey: string,
  force = false,
): Promise<{ orders: Order[]; fetchedAt: number }> {
  const days = dayKeysInRange(startKey, endKey);
  const todayKey = formatDateInput(new Date());
  const now = Date.now();
  const isFresh = (k: string) => {
    const hit = paidOrdersByDay.get(k);
    if (!hit) return false;
    return k < todayKey || now - hit.fetchedAt < TODAY_PAID_CACHE_TTL_MS;
  };
  const missing = force ? days : days.filter((k) => !isFresh(k));
  if (missing.length > 0) {
    const first = missing[0];
    const last = missing[missing.length - 1];
    const rows = await fetchPaidOrders(new Date(`${first}T00:00:00`), dayAfter(last));
    const fetchedAt = Date.now();
    const byDay = new Map<string, Order[]>(dayKeysInRange(first, last).map((k) => [k, []]));
    // ตัดรูป base64 ของออเดอร์เก่าทิ้งก่อนเก็บ — History/Stats ไม่ได้แสดงรูป ไม่ต้องค้างไว้ในหน่วยความจำ
    rows.forEach((o) => byDay.get(formatDateInput(o.timestamp))?.push({ ...o, items: (o.items || []).map(stripItemPhoto) }));
    byDay.forEach((orders, k) => paidOrdersByDay.set(k, { orders, fetchedAt }));
  }
  const hits = days.map((k) => paidOrdersByDay.get(k)).filter((h): h is { orders: Order[]; fetchedAt: number } => !!h);
  return {
    orders: hits.flatMap((h) => h.orders),
    fetchedAt: hits.length > 0 ? Math.min(...hits.map((h) => h.fetchedAt)) : now,
  };
}

// ตั้งค่า retry ร่วมกันของ History/Stats — ถ้า fetchPaidOrders fail (เช่น เครือข่ายสะดุดตอนแท็บ
// กลับมาจาก background นานๆ) ลอง auto-retry สักพักก่อน ถ้ายัง fail ต่อเนื่องค่อยหยุดแล้วรอผู้ใช้กดเอง
// แทนที่จะ catch เงียบๆ แล้วปล่อยให้หน้าโล่งไม่มีข้อความอะไรเลย
export const FETCH_RETRY_DELAY_MS = 1500;
export const FETCH_MAX_AUTO_RETRIES = 3;

export function formatDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ต้นวันถัดจาก dateStr ("YYYY-MM-DD") — ใช้เป็นขอบบนแบบ exclusive ของ query ช่วงวันที่
export function dayAfter(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}
