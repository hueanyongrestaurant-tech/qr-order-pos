// ─── Types ───────────────────────────────────────────────────────────────────

export type Language = "en" | "th";
export type View =
  | "menu"
  | "link-expired"
  | "item-detail"
  | "cart"
  | "order-sent"
  | "staff-login"
  | "staff-orders"
  | "staff-payment"
  | "staff-menu"
  | "staff-menu-edit"
  | "staff-history"
  | "staff-stats"
  | "staff-expenses"
  | "staff-activity"
  | "staff-manual-table"
  | "staff-manual-menu"
  | "staff-manual-cart";;

export type StaffTab = "orders" | "payment" | "menu" | "history" | "stats" | "expenses" | "activity";
export type MeatChoice = "pork" | "chicken" | "beef";
export type SpiceLevel = 0 | 1 | 2 | 3;
export type Portion = "regular" | "special";
export interface CustomChoice {
  id: string;
  labelTh: string;
  labelEn: string;
  priceDelta: number;
  active?: boolean;
}
export interface CustomGroup {
  id: string;
  nameTh: string;
  nameEn: string;
  type: "single" | "multi"; // single = เลือกได้ 1, multi = เลือกได้หลายอย่าง
  choices: CustomChoice[];
  required?: boolean;
}
export type OrderStatus = "in-progress" | "awaiting-payment" | "paid" | "cancelled";
export type PaymentMethod = "cash" | "transfer";

// ─── Activity Log (บันทึกกิจกรรมที่มีความเสี่ยงด้านการเงิน/ข้อมูล) ─────────────
export type ActivityAction =
  | "void_item"
  | "cancel_order"
  | "adjust_item_qty"
  | "menu_item_added"
  | "menu_item_edited"
  | "menu_item_deleted"
  | "category_deleted"
  | "expense_edited"
  | "expense_deleted";

export interface ActivityLog {
  id: string;
  action: ActivityAction;
  createdAt: Date;
  orderId?: string;
  tableNumber?: string;
  itemName?: string;
  amount?: number;
  reason?: string;
  details?: Record<string, any>;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: { en: string; th: string };
  description: { en: string; th: string };
  price: number;
  photo: string;
  hasMeatChoice?: boolean;
  meatPriceDeltas?: Partial<Record<MeatChoice, number>>;
  hasSpice?: boolean;
  hasPortion?: boolean;
  portionPriceDelta?: number;
  hasEggAddon?: boolean;   // ปิดตัวเลือกไข่ดาวสำหรับเมนูนี้ได้
  hasPlainAddOns?: boolean; // ปิดตัวเลือกจาน/ช้อนส้อม/แก้วน้ำสำหรับเมนูนี้ได้
  customGroups?: CustomGroup[];
  popular?: boolean;
  disabledMeats?: MeatChoice[];
  order?: number;
}

export interface CartItem {
  cartId: string;
  item: MenuItem;
  meat?: MeatChoice;
  portion?: Portion;
  customSelections?: Record<string, string[]>;
  note?: string;
  spiceLevel: SpiceLevel;
  addEgg: boolean;
  addOns: string[];
  quantity: number;
  voided?: boolean;       // true = ถูกยกเลิก แต่ยังคงอยู่ใน items[] เสมอ ห้ามลบออกจาก array เด็ดขาด
  voidReason?: string;
  voidedAt?: Date;
}

export interface Order {
  id: string;
  tableNumber: string;
  timestamp: Date;
  items: CartItem[];
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
  isTakeaway?: boolean;
  takeawayLabel?: string;
  paymentBatchId?: string;
  cancelReason?: string;
  cancelledAt?: Date;
}

// ─── บัญชีรายจ่าย (Expenses) ───────────────────────────────────────────────────
// 1 document ต่อ 1 วัน (doc id = "YYYY-MM-DD") เก็บรายการของที่ซื้อไว้เป็น array
// ข้างใน แทนที่จะแยก 1 document ต่อ 1 รายการ เพื่อไม่ให้จำนวน document บวมเร็วเกินไป

export interface ExpenseLineItem {
  name: string;
  quantity: number;
  unit?: string;
  amount: number; // ราคารวมของรายการนี้ (บาท)
}

export interface ExpenseDay {
  id: string; // = date ("YYYY-MM-DD")
  date: string;
  items: ExpenseLineItem[];
  totalAmount: number;
  updatedAt: Date;
}

// รายชื่อของที่เคยกรอกไว้ ใช้เพื่อ autocomplete ตอนพิมพ์ชื่อของ (เหมือน Excel)
export interface ExpenseCatalogEntry {
  id: string; // sanitized name ใช้เป็น doc id
  name: string;
  unit?: string;
  lastQuantity?: number;
  lastAmount?: number;
  usageCount: number;
}

export interface Category {
  id: string;
  nameEn: string;
  nameTh: string;
  order: number;
  active?: boolean;
  signature?: boolean;
}
