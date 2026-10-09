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
  | "staff-manual-cart"
  | "staff-manual-addon"
  | "staff-backfill-setup"
  | "staff-backfill-payment";

export type StaffTab = "orders" | "payment" | "menu" | "history" | "stats" | "expenses" | "activity";
export type MeatChoice = "pork" | "chicken" | "beef";
export type SpiceLevel = 0 | 1 | 2 | 3;
export type Portion = "regular" | "special";
export interface CustomChoice {
  id: string;
  labelTh: string;
  labelEn: string;
  priceDelta: number;
  active?: boolean;   // false = ซ่อนตัวเลือกนี้
  soldOut?: boolean;  // true = หมด (ใช้เฉพาะกลุ่มเนื้อสัตว์ ดู isMeatGroup) ยังแสดงแต่เลือกไม่ได้
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
// "split" = บิลเดียวจ่ายเงินสดส่วนหนึ่ง + โอนอีกส่วนหนึ่ง (ดู Order.transferAmount)
export type PaymentMethod = "cash" | "transfer" | "split";

// สิ่งที่หน้าชำระเงินส่งมาตอนปิดบิล — ยอดโอนเป็นยอดของ "ทั้งบิล" (App แบ่งลงออเดอร์แต่ละใบเอง)
export interface PaymentInput {
  method: PaymentMethod;
  cashReceived?: number;   // cash/split: เงินสดที่รับมา (ใช้คิดเงินทอน)
  transferAmount?: number; // split เท่านั้น: ยอดโอนของทั้งบิล
}

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
  | "expense_deleted"
  | "backfill_order";

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
  disabledMeats?: MeatChoice[]; // ซ่อนตัวเลือกเนื้อในตัว (hasMeatChoice) ของเมนูนี้
  soldOutMeats?: MeatChoice[];  // ตัวเลือกเนื้อในตัวที่หมด — ยังแสดงแต่เลือกไม่ได้
  order?: number;
  // สถานะการขาย 3 แบบ (ดู menuAvailability ใน utils.ts) — ทั้งสองฟิลด์ไม่มีค่า = ขายปกติ ไม่ต้อง migrate เมนูเดิม
  active?: boolean;  // false = ซ่อน หายไปจากหน้าสั่งเลย (เมนูตามฤดูกาล)
  soldOut?: boolean; // true = หมด ยังแสดงแต่เป็นสีเทา กดสั่งไม่ได้ (มีผลเฉพาะตอน active ไม่ใช่ false)
}

export type MenuAvailability = "available" | "soldOut" | "hidden";

export interface CartItem {
  cartId: string;
  item: MenuItem;
  meat?: MeatChoice;
  portion?: Portion;
  customSelections?: Record<string, string[]>;
  note?: string;
  customNote?: string;         // ชื่อรายการที่พนักงานพิมพ์เพิ่มเอง (ไม่มีในเมนู) — staff-only, ห้ามให้ลูกค้าเห็น/กรอก
  customAddOnPrice?: number;   // ราคาของ customNote ที่พนักงานกรอกเอง — staff-only เช่นกัน
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
  // เวลาที่เสิร์ฟแต่ละรายการ (key = cartId) — ใช้แค่แบ่งโซนบนหน้า Orders เท่านั้น ไม่เกี่ยวกับเงินเลย
  // แยกเป็น map ของตัวเอง ไม่ใส่ใน items[] เพื่อให้กดเสิร์ฟไม่ต้องเขียน items (ข้อมูลที่ใช้คิดเงิน) ซ้ำทั้งก้อน
  servedAt?: Record<string, Date>;
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
  // split เท่านั้น: ส่วนที่เป็นเงินโอนของ "ออเดอร์ใบนี้" (ไม่ใช่ทั้งบิล) — ส่วนเงินสด = orderTotal - transferAmount
  // บิลโต๊ะมีหลายออเดอร์ ยอดโอนของทั้งบิลจึงถูกแบ่งลงแต่ละใบ (allocateTransfer) ให้สถิติรวมทีละใบได้ตรง
  transferAmount?: number;
  isTakeaway?: boolean;
  takeawayLabel?: string;
  paymentBatchId?: string;
  cancelReason?: string;
  cancelledAt?: Date;
  // บิลขายย้อนหลัง (ลืมลงระบบ เพิ่มทีหลัง) — สร้างเป็น "paid" ตรงๆ createdAt = เวลาที่กรอก (จัดเข้าวันขายจริง)
  // ส่วน backfilledAt = เวลาที่กรอกจริงบน server ไว้ตรวจสอบ
  backfilled?: boolean;
  backfilledAt?: Date;
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
