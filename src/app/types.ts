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
  active?: boolean;   // เลิกใช้แล้ว (ปุ่ม "ซ่อน" เดิม แอปเก่ายังเขียนได้) — false นับเป็น "ปิด" เหมือน soldOut ดู isChoiceClosed
  soldOut?: boolean;  // true = ปิด: ลูกค้ายังเห็นเป็นสีเทา "หมด" เลือกไม่ได้ (ทุกกลุ่ม)
}
export interface CustomGroup {
  id: string;
  nameTh: string;
  nameEn: string;
  type: "single" | "multi"; // single = เลือกได้ 1, multi = เลือกได้หลายอย่าง
  choices: CustomChoice[];
  required?: boolean;
  // true = ตัวเลือกของกลุ่มนี้ขึ้นเป็นปุ่มเปิด/ปิดด่วนในหน้าจัดการเมนู
  // ไม่มีค่า (ข้อมูลเก่า) = ใช้ชื่อกลุ่มตัดสิน (มีคำว่า "เนื้อสัตว์") ดู isQuickToggleGroup ใน menuOptions.ts
  quickToggle?: boolean;
  // เลิกใช้แล้ว — ลูกค้าต้องเลือกเองทุกกลุ่ม ค่านี้ (ถ้ายังค้างอยู่ใน doc เก่า) ไม่มีผล
  defaultChoiceId?: string;
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
  | "backfill_order"
  | "table_moved"
  | "unserve_item"      // ย้อนการเสิร์ฟ 1 รายการ
  | "unserve_all"       // ย้อน "เสิร์ฟทั้งหมด"
  | "unready_takeaway"  // ย้อน "พร้อมรับ" ของกลับบ้าน
  | "restore_item";     // คืนรายการที่ยกเลิก (void) ไปแล้ว

// ตัวเลือกของหน้าต่างยืนยัน (ConfirmModal ใน App) — tone กำหนดสีปุ่มยืนยัน: danger = แดง (ยกเลิก/ลบ, ค่าเริ่มต้น),
// success = เขียว (เสิร์ฟ/พร้อมรับ/รับเงิน), neutral = สีหลัก (ย้อนกลับ)
export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "success" | "neutral";
}

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

// ตัวเลือกในตัว (hasMeatChoice/meatPriceDeltas/hasSpice/hasPortion/portionPriceDelta/hasEggAddon/hasPlainAddOns/
// disabledMeats/soldOutMeats) เลิกใช้แล้ว — เหลือไว้ให้อ่านเมนู/ออเดอร์เก่าได้ ตัวเลือกทั้งหมดอยู่ใน customGroups
// (เมนูที่ยังเป็นแบบเดิมถูกแปลงตอนอ่านด้วย normalizeMenuItem ใน menuOptions.ts)
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
  popular?: boolean; // สวิตช์ "เมนูเด่น" เดิมในหน้าแก้เมนู — เก็บค่าไว้เฉยๆ ไม่มีผลกับหน้าลูกค้าแล้ว
  recommended?: boolean;     // true = อยู่ในแถบ "แนะนำ" (แถบแรกของหน้าสั่ง) ด้วย นอกจากหมวดของตัวเอง
  recommendedOrder?: number; // ลำดับในแถบ "แนะนำ" — ลากเรียงในหน้าจัดการเมนู แยกจาก order ในหมวด
  disabledMeats?: MeatChoice[]; // ซ่อนตัวเลือกเนื้อในตัว (hasMeatChoice) ของเมนูนี้
  soldOutMeats?: MeatChoice[];  // ตัวเลือกเนื้อในตัวที่หมด — ยังแสดงแต่เลือกไม่ได้
  order?: number;
  // สถานะการขาย 3 แบบ (ดู menuAvailability ใน utils.ts) — ทั้งสองฟิลด์ไม่มีค่า = ขายปกติ ไม่ต้อง migrate เมนูเดิม
  active?: boolean;  // false = ซ่อน หายไปจากหน้าสั่งเลย (เมนูตามฤดูกาล)
  soldOut?: boolean; // true = หมด ยังแสดงแต่เป็นสีเทา กดสั่งไม่ได้ (มีผลเฉพาะตอน active ไม่ใช่ false)
  // true = ตั้งจำนวนสต็อกไว้ (stock/{id}) และระบบสต็อกเปิดอยู่ → ส่งออเดอร์แบบ transaction ตัดสต็อก (ดู stock.ts)
  stockTracked?: boolean;
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
  voidedWhileUnserved?: boolean; // ยกเลิกตอนยังไม่เสิร์ฟ — ใช้ตอนคืนรายการ (restore) ให้กลับไปเป็น "ยังไม่เสิร์ฟ" ถูกต้อง
}

export interface ServedUnits {
  count?: number;
  last?: number;
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
  // เสิร์ฟทีละจำนวน (key = cartId) — ดู lineServedQty ใน utils.ts
  // ยังเสิร์ฟไม่ครบ: { count: เสิร์ฟไปแล้วกี่ชิ้น, last: ชุดล่าสุดกี่ชิ้น } และยังไม่มี servedAt
  // เสิร์ฟครบ: servedAt ถูกจด + เหลือแค่ { last } ไว้ย้อนตามจำนวนที่เพิ่งเสิร์ฟ (ไม่มี count — servedAt บอกว่าครบ)
  // ข้อมูลเดิมไม่มี field นี้ = servedAt แบบทั้งบรรทัดเหมือนเดิม
  servedUnits?: Record<string, ServedUnits>;
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
  // split เท่านั้น: ส่วนที่เป็นเงินโอนของ "ออเดอร์ใบนี้" (ไม่ใช่ทั้งบิล) — ส่วนเงินสด = orderTotal - transferAmount
  // บิลโต๊ะมีหลายออเดอร์ ยอดโอนของทั้งบิลจึงถูกแบ่งลงแต่ละใบ (allocateTransfer) ให้สถิติรวมทีละใบได้ตรง
  transferAmount?: number;
  isTakeaway?: boolean;
  takeawayLabel?: string;
  paymentBatchId?: string;
  // เวลาปิดบิลบน server (เริ่มเก็บตั้งแต่เวอร์ชันที่มีสถิติเวลานั่ง — บิลเก่าไม่มี) ใช้คิดเวลานั่งต่อโต๊ะ
  paidAt?: Date;
  cancelReason?: string;
  cancelledAt?: Date;
  // บิลขายย้อนหลัง (ลืมลงระบบ เพิ่มทีหลัง) — สร้างเป็น "paid" ตรงๆ createdAt = เวลาที่กรอก (จัดเข้าวันขายจริง)
  // ส่วน backfilledAt = เวลาที่กรอกจริงบน server ไว้ตรวจสอบ
  backfilled?: boolean;
  backfilledAt?: Date;
  // ย้ายโต๊ะ (handleMoveTable ใน App.tsx) — ทุกออเดอร์ที่ย้ายในรอบเดียวกันได้ moveId เดียวกัน
  // listener ออเดอร์เห็น moveId เปลี่ยน = เพิ่งย้าย → พิมพ์ใบย้าย (ดู buildMoveTicketOrder) ย้ายซ้ำจะเขียนทับเป็นรอบล่าสุด
  moveId?: string;
  movedFrom?: string;
  movedAt?: Date;
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
  signature?: boolean; // เดิมคือ "เมนูเด่น" ทั้งหมวด — เลิกใช้แล้ว อาจยังค้างอยู่ใน doc เก่า
}
