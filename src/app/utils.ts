import type { CartItem, CustomGroup, Language, MeatChoice, MenuAvailability, MenuItem, Order, Portion } from "./types";
import { ADD_ONS } from "./constants";
import { T } from "./translations";
import { db } from "../lib/firebase";
import { collection, documentId, getDocs, getDocsFromServer, orderBy, query, where, limit } from "firebase/firestore";
import { diagTime } from "./diag"; // TEMP DIAGNOSTICS

// ─── Utility functions ────────────────────────────────────────────────────────

// ─── สถานะการขาย (เมนู + ตัวเลือกเนื้อสัตว์) ─────────────────────────────────

export const MEAT_CHOICES: MeatChoice[] = ["pork", "chicken", "beef"];

// กลุ่มตัวเลือกที่สร้างเอง (customGroups) นับเป็น "เนื้อสัตว์" จากชื่อกลุ่ม — ตอนนี้ทุกเมนูตั้งชื่อว่า
// "เลือกเนื้อสัตว์" ตั้ง "หมด" รายตัวเลือกได้เฉพาะกลุ่มแบบนี้ (ไข่ดาว/ความเผ็ด/ฯลฯ ไม่เกี่ยว)
export function isMeatGroup(group: CustomGroup): boolean {
  return (group.nameTh || "").includes("เนื้อสัตว์");
}

// ค่าเริ่มต้นของ customSelections ตอนเปิดหน้าเมนู — เลือก defaultChoiceId ไว้ให้เฉพาะกลุ่ม single
// ที่ตัวเลือกนั้นยังมีอยู่ ไม่ถูกซ่อน และไม่หมด (หมดนับเฉพาะกลุ่มเนื้อสัตว์ เหมือนหน้าสั่ง) ไม่งั้นปล่อยว่างเหมือนเดิม
export function defaultCustomSelections(item: MenuItem): Record<string, string[]> {
  const selections: Record<string, string[]> = {};
  for (const g of item.customGroups || []) {
    if (g.type !== "single" || !g.defaultChoiceId) continue;
    const choice = g.choices.find((c) => c.id === g.defaultChoiceId);
    if (!choice || choice.active === false || (isMeatGroup(g) && choice.soldOut)) continue;
    selections[g.id] = [choice.id];
  }
  return selections;
}

// ตัวเลือกเนื้อสัตว์ที่ "แสดงอยู่" (ไม่นับที่ถูกซ่อน) ของเมนู ทั้งแบบในตัว (hasMeatChoice) และแบบกลุ่มที่สร้างเอง
// ใช้ทั้งชิปในหน้าจัดการเมนูและการคิดว่าเนื้อหมดทุกตัวหรือยัง
export interface MeatOption {
  key: string;                // ไม่ซ้ำในเมนูเดียวกัน ใช้เป็น React key
  meat?: MeatChoice;          // แบบในตัว
  groupId?: string;           // แบบกลุ่ม
  choiceId?: string;
  required: boolean;          // แบบในตัวนับว่าบังคับเลือกเสมอ
  labelTh: string;
  labelEn: string;
  soldOut: boolean;
}

export function meatOptions(item: MenuItem): MeatOption[] {
  const options: MeatOption[] = [];
  if (item.hasMeatChoice) {
    MEAT_CHOICES.filter((m) => !item.disabledMeats?.includes(m)).forEach((m) => options.push({
      key: `meat:${m}`,
      meat: m,
      required: true,
      labelTh: T.th.meats[m],
      labelEn: T.en.meats[m],
      soldOut: !!item.soldOutMeats?.includes(m),
    }));
  }
  (item.customGroups || []).filter(isMeatGroup).forEach((g) => {
    g.choices.filter((c) => c.active !== false).forEach((c) => options.push({
      key: `${g.id}:${c.id}`,
      groupId: g.id,
      choiceId: c.id,
      required: !!g.required,
      labelTh: c.labelTh,
      labelEn: c.labelEn,
      soldOut: !!c.soldOut,
    }));
  });
  return options;
}

// true = เมนูนี้สั่งไม่ได้เพราะตัวเลือกเนื้อที่ "บังคับเลือก" หมดทุกตัว (ชุดใดชุดหนึ่ง) — คิดตอนแสดงผล ไม่เขียนลง DB
// เปิดเนื้อกลับมาขายตัวเดียว เมนูก็กลับมาขายเองทันที
export function allMeatsSoldOut(item: MenuItem): boolean {
  const required = meatOptions(item).filter((o) => o.required);
  const sets = new Map<string, MeatOption[]>(); // แยกตามชุด: ในตัว 1 ชุด + กลุ่มละ 1 ชุด
  required.forEach((o) => {
    const setKey = o.groupId ?? "builtin";
    sets.set(setKey, [...(sets.get(setKey) || []), o]);
  });
  return [...sets.values()].some((set) => set.length > 0 && set.every((o) => o.soldOut));
}

// สถานะที่ "ตั้งไว้" (ปุ่ม ขาย/หมด/ซ่อน ในหน้าจัดการเมนู) — "hidden" มาก่อนเสมอ
export function menuAvailabilitySetting(item: Pick<MenuItem, "active" | "soldOut">): MenuAvailability {
  if (item.active === false) return "hidden";
  if (item.soldOut) return "soldOut";
  return "available";
}

// สถานะ "ที่ลูกค้าเห็นจริง" — เหมือนที่ตั้งไว้ แต่ถ้าเนื้อสัตว์ที่บังคับเลือกหมดทุกตัว นับเป็นหมดด้วย
export function menuAvailability(item: MenuItem): MenuAvailability {
  const setting = menuAvailabilitySetting(item);
  if (setting === "available" && allMeatsSoldOut(item)) return "soldOut";
  return setting;
}

// รายการในตะกร้า 1 รายการ สั่งไม่ได้แล้วหรือยัง เทียบกับข้อมูลเมนูล่าสุด (fresh): เมนูหมด/ซ่อน
// หรือเลือกเนื้อสัตว์ที่หมด/ถูกซ่อนไปแล้ว (ทั้งแบบในตัวและแบบกลุ่ม)
export function isCartItemUnavailable(ci: CartItem, fresh: MenuItem): boolean {
  if (menuAvailability(fresh) !== "available") return true;
  if (fresh.hasMeatChoice && ci.meat && (fresh.soldOutMeats?.includes(ci.meat) || fresh.disabledMeats?.includes(ci.meat))) {
    return true;
  }
  return (fresh.customGroups || []).filter(isMeatGroup).some((g) => {
    const selected = ci.customSelections?.[g.id] || [];
    return g.choices.some((c) => selected.includes(c.id) && (c.soldOut || c.active === false));
  });
}

// ข้อมูลที่จะบันทึกจากหน้าแก้เมนู (setDoc เขียนทับทั้ง doc): สถานะการขายทั้งหมดต้องเอาจากค่าล่าสุดใน Firestore
// (prev) ไม่ใช่จาก form ที่ copy ไว้ตอนเปิดหน้าแก้ — ไม่งั้นแก้ชื่อ/ราคาแล้วเมนูหรือเนื้อที่ "หมด" อยู่จะกลับมาขาย
// หรือทับสถานะที่เครื่องอื่นเพิ่งเปลี่ยนระหว่างที่เปิดหน้าแก้ค้างไว้
// • เมนู: active / soldOut / soldOutMeats จาก prev (เมนูใหม่ = ขายปกติ)
// • ตัวเลือกในกลุ่ม: soldOut จาก prev เทียบด้วย id กลุ่ม+ตัวเลือก (ตัวเลือกที่เพิ่มใหม่ใน form = ขายปกติ)
//   ส่วน active (ซ่อนตัวเลือก) ยังมาจาก form ตามเดิม เพราะตั้งค่ากันในหน้าแก้เมนูนี้เอง
export function withLiveAvailability(item: MenuItem, prev: MenuItem | undefined): MenuItem {
  const liveSoldOutChoices = new Set<string>();
  prev?.customGroups?.forEach((g) => g.choices.forEach((c) => { if (c.soldOut) liveSoldOutChoices.add(`${g.id}:${c.id}`); }));
  return {
    ...item,
    active: prev ? prev.active ?? true : true,
    soldOut: prev?.soldOut ?? false,
    soldOutMeats: prev?.soldOutMeats ?? [],
    ...(item.customGroups
      ? {
        customGroups: item.customGroups.map((g) => ({
          ...g,
          choices: g.choices.map(({ soldOut: _staleSoldOut, ...c }) =>
            liveSoldOutChoices.has(`${g.id}:${c.id}`) ? { ...c, soldOut: true } : c),
        })),
      }
      : {}),
  };
}

// ชื่อเนื้อสัตว์ที่เลือกในรายการตะกร้า (ไว้ต่อท้ายชื่อเมนูในข้อความเตือน เช่น "ข้าวผัด (แหนม)") — ไม่มีคืน ""
export function cartItemMeatLabel(ci: CartItem, lang: Language): string {
  const labels: string[] = [];
  if (ci.meat) labels.push(T[lang].meats[ci.meat]);
  (ci.item.customGroups || []).filter(isMeatGroup).forEach((g) => {
    const selected = ci.customSelections?.[g.id] || [];
    g.choices.filter((c) => selected.includes(c.id)).forEach((c) => labels.push(lang === "en" ? c.labelEn : c.labelTh));
  });
  return labels.join(", ");
}

// ดึงข้อมูลล่าสุดจาก server ของเมนูในตะกร้าก่อนส่งออเดอร์ (หน้าเมนูลูกค้า cache ไว้ได้ถึง 3 นาที
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

// รายการที่ยังไม่เสิร์ฟ (ไม่นับที่ void แล้ว) — ออเดอร์ที่พ้น in-progress ไปแล้วถือว่าเสิร์ฟครบทุกรายการ
// (รวมออเดอร์เก่าที่กด "เสิร์ฟทั้งหมด" ซึ่งไม่มี servedAt เลย)
export function unservedItems(order: Order): CartItem[] {
  if (order.status !== "in-progress") return [];
  return liveItems(order.items).filter((ci) => !order.servedAt?.[ci.cartId]);
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
    paymentMethod: raw.paymentMethod,
    cashReceived: raw.cashReceived,
    transferAmount: raw.transferAmount,
    isTakeaway: raw.isTakeaway,
    takeawayLabel: raw.takeawayLabel,
    paymentBatchId: raw.paymentBatchId,
    cancelReason: raw.cancelReason,
    cancelledAt: raw.cancelledAt?.toDate ? raw.cancelledAt.toDate() : undefined,
    backfilled: raw.backfilled === true ? true : undefined,
    backfilledAt: raw.backfilledAt?.toDate ? raw.backfilledAt.toDate() : undefined,
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
    soldOutMeats: [],
    customGroups: item.customGroups?.map((g) => ({
      ...g,
      choices: g.choices.map((c) => ({ ...c, soldOut: false })),
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
  const snap = await diagTime( // TEMP DIAGNOSTICS
    "GETDOCS paidOrders",
    () => getDocs(
      query(
        collection(db, "orders"),
        where("createdAt", ">=", startInclusive),
        where("createdAt", "<", endExclusive),
        orderBy("createdAt", "asc"),
        limit(PAID_ORDERS_QUERY_CAP),
      ),
    ),
    (s) => `${s.size} docs, ${formatDateInput(startInclusive)}..${formatDateInput(endExclusive)}`,
  );
  return snap.docs
    .map((d) => mapOrderDoc(d.id, d.data()))
    .filter((o) => o.status === "paid");
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
