// จุดรวม re-export ของทุก component ฝั่งพนักงาน — ให้ App.tsx ใช้ dynamic import()
// แค่ครั้งเดียวที่ไฟล์นี้ แล้ว bundler รวมทุกอย่างที่ import ต่อจากที่นี่ (รวมถึง ticket.tsx
// ที่ไฟล์ในนี้ใช้กันเอง) เป็น JS chunk เดียว แยกจาก chunk หลักที่ลูกค้าโหลด
export { StaffHeader } from "./StaffHeader";
export { StaffLoginScreen } from "./StaffLoginScreen";
export { StaffOrdersScreen } from "./StaffOrdersScreen";
export { StaffPaymentScreen } from "./StaffPaymentScreen";
export { StaffMenuScreen } from "./StaffMenuScreen";
export { StaffManualTableScreen } from "./StaffManualTableScreen";
export { StaffMenuEditScreen } from "./StaffMenuEditScreen";
export { StaffHistoryScreen } from "./StaffHistoryScreen";
export { StaffExpensesScreen } from "./StaffExpensesScreen";
export { StaffStatsScreen } from "./StaffStatsScreen";
export { StaffActivityScreen } from "./StaffActivityScreen";
