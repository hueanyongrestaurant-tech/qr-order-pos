// แทน src/lib/firebase ตอนทดสอบ — db ชี้ไปที่ emulator ของ context ที่ test เลือก (ลูกค้า/พนักงาน)
export let db;
export function setTestDb(next) { db = next; }
