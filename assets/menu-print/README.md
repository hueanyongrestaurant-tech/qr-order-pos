# เมนูกระดาษ A4 (เครื่องมือแยก — ไม่อยู่ในแอป)

ย้ายออกจากแอปแล้ว (เดิมเป็นปุ่ม "พิมพ์เมนู" ในหน้าจัดการเมนู, commit 8b7e3a2) เก็บไว้ใช้ทำเมนูกระดาษนอกแอป
โฟลเดอร์นี้อยู่นอก `src/` จึงไม่ถูก build เข้าเว็บ/แอป และ `tsc` ของแอปไม่ตรวจ — ยังไม่ได้ปรับปรุงอะไรหลังย้าย

- `printMenu.ts` — แยกชุดอาหาร / เครื่องดื่ม+ของฝาก, ข้อความราคาตามตัวเลือก ("หมู/ไก่ 79 · ทะเล 99"), จัดหมวดลงคอลัมน์/หน้า
- `PrintMenuScreen.tsx` — หน้ากระดาษ A4 (วัดความสูงจริงแล้วแบ่งหน้า เลือกแบบที่ใช้หน้าน้อยสุด)
- `preview.mjs` — สร้าง HTML จากไฟล์เมนู JSON แล้วเปิดใน Chrome เพื่อพิมพ์/บันทึก PDF
- `printMenu.test.mjs` — test เดิม (ไม่อยู่ในชุด `npm test` แล้ว)

```
node assets/menu-print/preview.mjs path/to/snapshot.json path/to/out
```

`snapshot.json` = `{ categories, menuItems }` — JSON ในช่อง `data` ของ `status/menuSnapshot` (อ่านได้โดยไม่ต้องล็อกอิน 1 read)
ใช้ import จาก `src/app` (types, constants, menuOptions) ถ้าโค้ดแอปเปลี่ยนอาจต้องแก้ตาม
