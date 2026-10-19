// ─── Constants ───────────────────────────────────────────────────────────────

// ปิดชั่วคราว (2026-10-03): หน้า Activity + หน้าต่างถามเหตุผล ทำให้พนักงานทำงานช้า
// false = ซ่อนแท็บ Activity, void/ปรับจำนวนทำงานทันทีไม่ถามเหตุผล,
//         ยกเลิกทั้งออเดอร์เป็นแค่หน้าต่างยืนยัน "ยกเลิกออเดอร์นี้?"
// activityLogs ยังถูกบันทึกเบื้องหลังเหมือนเดิมทุกจุด (แค่ไม่มี field reason)
// เปิดกลับ: เปลี่ยนเป็น true ที่นี่ที่เดียว แล้ว build/deploy ใหม่ — โค้ดเดิมยังอยู่ครบ
export const AUDIT_UI_ENABLED = false;

// บัญชีพนักงานบัญชีเดียวของร้าน (Firebase Auth) — หน้าล็อกอินให้พิมพ์แค่รหัสผ่าน
// สคริปต์ scripts/options-migration ใช้ค่านี้ด้วย ถามแค่รหัสผ่านเหมือนกัน
export const STAFF_EMAIL = "admin@hueanyong.local";

// ─── แยกพิมพ์ตั๋วตามจุด (ดู staff/stationTickets.ts) ──────────────────────────
// เทียบแบบ "ขึ้นต้นด้วย" กับชื่อภาษาไทยเสมอ (ไม่ขึ้นกับภาษาที่จอใช้อยู่)
// เปลี่ยนชื่อหมวด/เมนูจนไม่ขึ้นต้นด้วยคำเหล่านี้แล้ว รายการจะไปผิดใบ — ต้องแก้ที่นี่แล้ว build ใหม่
// หมวดที่ชื่อขึ้นต้นด้วยคำเหล่านี้ → ใบเคาน์เตอร์ หมวดอื่นทั้งหมด (รวมหมวดที่หาไม่เจอ) → ครัวใน/ครัวนอก
export const COUNTER_CATEGORY_PREFIXES = ["เครื่องดื่ม", "ของฝาก"];
// เมนูครัวที่ชื่อขึ้นต้นด้วยคำเหล่านี้ → ใบ "ครัวนอก" (หน้าที่ "ครัว" รวม: ส่วนท้ายใบ) ที่เหลือ → "ครัวใน"
export const OUTER_KITCHEN_ITEM_PREFIXES = ["ข้าวซอย", "ขนมจีนน้ำเงี้ยว"];
// categoryId ของรายการ Add-on แยกที่พนักงานพิมพ์เอง (handleManualAddOn ใน App.tsx) — พิมพ์ทุกจุด
export const ADDON_CATEGORY_ID = "__addon__";

// ผังโต๊ะในร้าน — เลขโต๊ะ = "<ชั้น>-<โต๊ะ>" (ตรงกับ QR และ rules ของ orders) ใช้ทั้งหน้าเลือกโต๊ะและหน้าย้ายโต๊ะ
export const TABLE_FLOORS: { floor: number; tables: number }[] = [
  { floor: 1, tables: 5 },
  { floor: 2, tables: 9 },
];

export const ADD_ONS = [
  { id: "extra-plate", label: { en: "Extra Plate", th: "จานเปล่าเพิ่ม" }, price: 10 },
  { id: "cutlery", label: { en: "Cutlery Set", th: "ช้อนส้อมชุด" }, price: 0 },
  { id: "water-glass", label: { en: "Water Glass", th: "แก้วน้ำ" }, price: 0 },
];
