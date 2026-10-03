// ─── Constants ───────────────────────────────────────────────────────────────

// ปิดชั่วคราว (2026-10-03): หน้า Activity + หน้าต่างถามเหตุผล ทำให้พนักงานทำงานช้า
// false = ซ่อนแท็บ Activity, void/ปรับจำนวนทำงานทันทีไม่ถามเหตุผล,
//         ยกเลิกทั้งออเดอร์เป็นแค่หน้าต่างยืนยัน "ยกเลิกออเดอร์นี้?"
// activityLogs ยังถูกบันทึกเบื้องหลังเหมือนเดิมทุกจุด (แค่ไม่มี field reason)
// เปิดกลับ: เปลี่ยนเป็น true ที่นี่ที่เดียว แล้ว build/deploy ใหม่ — โค้ดเดิมยังอยู่ครบ
export const AUDIT_UI_ENABLED = false;

export const ADD_ONS = [
  { id: "extra-plate", label: { en: "Extra Plate", th: "จานเปล่าเพิ่ม" }, price: 10 },
  { id: "cutlery", label: { en: "Cutlery Set", th: "ช้อนส้อมชุด" }, price: 0 },
  { id: "water-glass", label: { en: "Water Glass", th: "แก้วน้ำ" }, price: 0 },
];
