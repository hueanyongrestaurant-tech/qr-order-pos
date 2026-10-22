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

// ─── ผังโต๊ะในร้าน — ตั้งค่าที่นี่ที่เดียว (หน้าเลือกโต๊ะ/ย้ายโต๊ะ/ลิงก์โต๊ะ/สถิติ อ่านจากตรงนี้หมด) ───
// เลขโต๊ะภายใน = "<zone>-<ลำดับ>" (เช่น 1-3) ต้องเป็นตัวเลขเสมอ ให้ผ่าน rules ของ orders — ห้ามเปลี่ยนเลขโต๊ะที่ใช้อยู่
// (ออเดอร์เก่า/สถิติผูกกับเลขนี้)
// โต๊ะที่มีชื่อ (tableNames) แสดงชื่อแทน "โต๊ะ 3-1" ทุกที่ ทั้งหน้าลูกค้า ตั๋วครัว ใบเสร็จ ประวัติ สถิติ
// เพิ่มโต๊ะ: เพิ่ม tables | เพิ่มโซน: เพิ่มแถวใหม่ด้วย zone เลขที่ยังไม่เคยใช้
// แล้วไปหน้า "ลิงก์โต๊ะ" ฝั่งพนักงานเพื่อสร้างลิงก์ QR ของโต๊ะใหม่
export interface TableZoneConfig {
  zone: number;
  name: { th: string; en: string };
  tables: number;
  tableNames?: Record<number, { th: string; en: string }>;
}
export const TABLE_ZONES: TableZoneConfig[] = [
  { zone: 1, name: { th: "ชั้น 1", en: "Floor 1" }, tables: 5 },
  { zone: 2, name: { th: "ชั้น 2", en: "Floor 2" }, tables: 9 },
  {
    zone: 3,
    name: { th: "ม้าหินอ่อน", en: "Marble bench" },
    tables: 1,
    tableNames: { 1: { th: "ม้าหินอ่อน", en: "Marble bench" } },
  },
];

// หน้าเว็บลูกค้า (ลิงก์ในหน้า "ลิงก์โต๊ะ" ใช้ค่านี้เสมอ — แอป Android ไม่ได้อยู่บนโดเมนนี้ จึงใช้ window.location ไม่ได้)
export const CUSTOMER_SITE_URL = "https://hueanyongrestaurant-tech.github.io/qr-order-pos/";

export const ADD_ONS = [
  { id: "extra-plate", label: { en: "Extra Plate", th: "จานเปล่าเพิ่ม" }, price: 10 },
  { id: "cutlery", label: { en: "Cutlery Set", th: "ช้อนส้อมชุด" }, price: 0 },
  { id: "water-glass", label: { en: "Water Glass", th: "แก้วน้ำ" }, price: 0 },
];
