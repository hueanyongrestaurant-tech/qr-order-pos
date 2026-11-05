// แทน src/lib/firebase ในสคริปต์ — สคริปต์ไม่ใช้ db ของแอป (ส่ง db ที่ล็อกอินแล้วเข้าไปเองทุกครั้ง)
export const db = undefined;
export function getAuthInstance() {
  throw new Error("not available in scripts");
}
