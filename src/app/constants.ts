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
// บัญชีเจ้าของ — เห็นทุกอย่าง (สถิติ/รายจ่าย/ประวัติ/บันทึกกิจกรรม) บัญชี STAFF_EMAIL = พนักงานทั่วไป ไม่เห็นหน้าพวกนั้น
// firestore.rules ใช้อีเมลนี้ใน isOwner() — เปลี่ยนที่นี่ต้องเปลี่ยนใน rules ด้วย (ตัวพิมพ์เล็กทั้งหมด)
export const OWNER_EMAIL = "owner@hueanyong.local";

// ─── แยกพิมพ์ตั๋วตามจุด (ดู staff/stationTickets.ts) ──────────────────────────
// เทียบแบบ "ขึ้นต้นด้วย" กับชื่อภาษาไทยเสมอ (ไม่ขึ้นกับภาษาที่จอใช้อยู่)
// หมวด → เคาน์เตอร์/ครัว ตั้งในแอปได้แล้ว (ตั้งค่า → การพิมพ์, status/printRouting) — prefix นี้เป็นค่าเริ่มต้น
// ของหมวดที่ยังไม่เคยตั้ง: ชื่อขึ้นต้นด้วยคำเหล่านี้ → ใบเคาน์เตอร์ หมวดอื่นทั้งหมด (รวมหมวดที่หาไม่เจอ) → ครัวใน/ครัวนอก
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
// showUnder: แสดงโต๊ะของโซนนี้ใต้หัวข้อของโซนอื่นในผังโต๊ะทุกหน้า (ต่อท้ายโต๊ะของโซนนั้น ไม่มีหัวข้อของตัวเอง)
//   แค่การแสดงผล — เลขโต๊ะภายในยังเป็น "<zone>-<ลำดับ>" ของโซนตัวเอง (QR/ออเดอร์/สถิติผูกกับเลขนี้)
export interface TableZoneConfig {
  zone: number;
  name: { th: string; en: string };
  tables: number;
  tableNames?: Record<number, { th: string; en: string }>;
  showUnder?: number;
}
export const TABLE_ZONES: TableZoneConfig[] = [
  { zone: 1, name: { th: "ชั้น 1", en: "Floor 1" }, tables: 5 },
  { zone: 2, name: { th: "ชั้น 2", en: "Floor 2" }, tables: 9 },
  {
    zone: 3,
    name: { th: "ม้าหินอ่อน", en: "Marble bench" },
    tables: 1,
    tableNames: { 1: { th: "ม้าหินอ่อน", en: "Marble bench" } },
    showUnder: 1, // ม้าหินอ่อนอยู่ชั้น 1 — แสดงใต้ชั้น 1 ต่อจากโต๊ะ 5 (เลขภายในยังเป็น 3-1)
  },
];

// ─── ผังร้านจริง (FloorPlan.tsx) — ตำแหน่งโต๊ะแต่ละตัวบนตาราง ช่อง col/row เริ่มที่ 1 ───
// แก้ผังที่นี่ที่เดียว (ย้ายโต๊ะ เพิ่มแถว/คอลัมน์) ไม่ต้องแตะ component | table = เลขโต๊ะภายใน (ห้ามเปลี่ยน)
// row ใส่ครึ่งได้ (เช่น 2.5 = เริ่มกลางแถว 2 คร่อมถึงกลางแถว 3) สำหรับโต๊ะที่วางเหลื่อมกัน
// ช่องที่ไม่มี table = ป้ายบอกตำแหน่ง (เช่นเคาน์เตอร์) กดไม่ได้ | ชื่อชั้นมาจาก TABLE_ZONES ตาม zone
// โต๊ะใน TABLE_ZONES ที่ลืมใส่ผังนี้ จะไปโผล่ในหัวข้อ "อื่นๆ" ท้ายผังเอง (ไม่หาย) — เทสต์เช็คว่าครบทุกโต๊ะ
export interface FloorPlanCell {
  table?: string;
  label?: { th: string; en: string };
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}
export interface FloorPlanFloor {
  zone: number;
  cols: number;
  rows: number;
  cells: FloorPlanCell[];
}
export const FLOOR_PLAN: FloorPlanFloor[] = [
  {
    zone: 1,
    cols: 5,
    rows: 3,
    cells: [
      { label: { th: "เคาน์เตอร์", en: "Counter" }, col: 1, row: 1, rowSpan: 2 },
      { table: "1-5", col: 3, row: 1 },
      { table: "1-4", col: 3, row: 2 },
      { table: "1-1", col: 2, row: 3 },
      { table: "1-2", col: 3, row: 3 },
      { table: "1-3", col: 4, row: 3 },
      { table: "3-1", col: 5, row: 3 }, // ม้าหินอ่อน
    ],
  },
  {
    zone: 2,
    cols: 4,
    rows: 4,
    cells: [
      { table: "2-9", col: 3, row: 1 },
      { table: "2-1", col: 4, row: 1 },
      { table: "2-2", col: 4, row: 2 },
      { table: "2-7", col: 1, row: 2.5 }, // เหลื่อมระหว่าง 2-2 กับ 2-3 ตามผังจริง
      { table: "2-8", col: 2, row: 2.5 },
      { table: "2-3", col: 4, row: 3 },
      { table: "2-6", col: 2, row: 4 },
      { table: "2-5", col: 3, row: 4 },
      { table: "2-4", col: 4, row: 4 },
    ],
  },
];

// หน้าเว็บลูกค้า (ลิงก์ในหน้า "ลิงก์โต๊ะ" ใช้ค่านี้เสมอ — แอป Android ไม่ได้อยู่บนโดเมนนี้ จึงใช้ window.location ไม่ได้)
export const CUSTOMER_SITE_URL = "https://hueanyongrestaurant-tech.github.io/qr-order-pos/";

export const ADD_ONS = [
  { id: "extra-plate", label: { en: "Extra Plate", th: "จานเปล่าเพิ่ม" }, price: 10 },
  { id: "cutlery", label: { en: "Cutlery Set", th: "ช้อนส้อมชุด" }, price: 0 },
  { id: "water-glass", label: { en: "Water Glass", th: "แก้วน้ำ" }, price: 0 },
];
