import type { CartItem, Language, MeatChoice, MenuItem, Order, Portion } from "./types";
import { ADD_ONS } from "./constants";
import { T } from "./translations";
import { db } from "../lib/firebase";
import { collection, getDocs, orderBy, query, where, limit } from "firebase/firestore";

// ─── Utility functions ────────────────────────────────────────────────────────

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
  customSelections: Record<string, string[]> = {}
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
  return price;
}

// ราคาต่อหน่วยของรายการ (ยังไม่คูณจำนวน) — ใช้ตอนต้องบันทึกมูลค่าที่ถูก void ลง log
export function cartItemUnitPrice(ci: CartItem): number {
  return itemPrice(ci.item, ci.meat, ci.portion, ci.addEgg, ci.addOns, ci.customSelections);
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

export function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

export function orderTotal(order: Order): number {
  return order.items.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
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
    paymentMethod: raw.paymentMethod,
    cashReceived: raw.cashReceived,
    isTakeaway: raw.isTakeaway,
    takeawayLabel: raw.takeawayLabel,
    paymentBatchId: raw.paymentBatchId,
    cancelReason: raw.cancelReason,
    cancelledAt: raw.cancelledAt?.toDate ? raw.cancelledAt.toDate() : undefined,
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
