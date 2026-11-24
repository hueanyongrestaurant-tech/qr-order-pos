# รูปเมนู (menuPhotos) — ย้ายจาก Supabase / สำรอง / กู้คืน

ตั้งแต่ 25 พ.ย. 69 รูปเมนูอยู่ใน Firestore `menuPhotos/{itemId}` (WebP ≤ 600px ~25–40 KB) — ดู `src/app/menuPhotos.ts`
`menuItems` เก็บแค่ `photoVersion` | `menuItems.photo` (URL Supabase เดิม) **ห้ามแก้/ลบ** — สคริปต์ 11 ธ.ค. ใช้

- `photoVersion` ไม่มี = ยังรอรูปเดิม (ลูกค้าเห็นช่องว่าง) | `0` = พนักงานลบรูปเอง | `> 0` = มีรูป
- dry-run อ่านอย่างเดียว **ไม่ต้องใช้รหัส** | apply ถามรหัส **บัญชีเจ้าของ** แล้วให้พิมพ์ `yes`
- รันซ้ำได้เสมอ: ไม่ทับรูปที่มีอยู่ (ยกเว้นรูปที่ติ๊ก "ชั่วคราว" ตอนอัป) ไม่เติมรูปที่พนักงานลบ

## 1. เอารูป 38 รูปที่กู้จาก cache ของ Chrome เข้าระบบ (ตอนนี้)

รูปอยู่ที่ `recovered-menu-photos/menuPhotos/*.jpg` (ไม่อยู่ใน git)

```
npm run menuphotos:recovered:dry-run
npm run menuphotos:recovered:apply
```

## 2. วันที่ 11 ธ.ค. — ดึงรูปเดิมที่เหลือจาก Supabase (เตรียมไว้แล้ว ยังไม่ได้รัน)

ดึงทุกเมนูที่ยังไม่มีรูป หรือยังเป็นรูปชั่วคราว จาก URL เดิมใน `menuItems.photo` (bucket `menu-photos`)
ต้นฉบับที่ดาวน์โหลดเก็บไว้ที่ `scripts/menu-photos/downloads/<วันที่>/` ด้วย (ไม่อยู่ใน git)

```
npm run menuphotos:supabase:dry-run     ← เช็คว่าเปิดไฟล์ได้ครบ (HEAD เท่านั้น ไม่ดาวน์โหลด)
npm run menuphotos:supabase:apply
```

ถ้ามีไฟล์ที่เปิดไม่ได้ (ยังล็อก) รันซ้ำทีหลังได้ — ตัวที่ใส่แล้วไม่ถูกแตะ
เสร็จแล้ว: ทำขั้น "เลิกใช้ Supabase" (branch `remove-supabase` บนเครื่องนี้ — ดูข้อความ commit)

## 3. สำรองอัตโนมัติทุกสัปดาห์ (GitHub Action)

`.github/workflows/photo-backup.yml` — ทุกวันจันทร์ 03:00 เวลาไทย อ่าน `menuItems` + `menuPhotos` แบบสาธารณะ
(ไม่ต้องมี secret) แล้วเขียนทับ branch `photo-backup` เป็น commit เดียว: `photos/<itemId>.webp` + `manifest.json`
เก็บเฉพาะเวอร์ชันล่าสุด repo ไม่โต | รูปลดลงเกินครึ่งจากครั้งก่อน = ไม่ยอมเขียนทับ (กันไฟล์สำรองดีๆ หาย)

กดรันเองได้ที่ GitHub → Actions → photo-backup → Run workflow
รันบนเครื่องเองก็ได้: `npm run menuphotos:backup -- ../photo-backup-local`

หมายเหตุ: GitHub ปิด workflow ตามเวลาเองถ้า repo ไม่มีความเคลื่อนไหว 60 วัน (จะมีอีเมลเตือน) — กด Enable กลับได้

## 4. กู้ menuPhotos จาก branch photo-backup

```
git fetch origin photo-backup
git worktree add ../photo-backup origin/photo-backup
npm run menuphotos:restore:dry-run -- ../photo-backup
npm run menuphotos:restore:apply -- ../photo-backup
git worktree remove ../photo-backup
```

กู้เฉพาะเมนูที่ **ไม่มี doc รูป** ตอนนี้ (รูปที่มีอยู่ไม่ทับ) ใช้เลขเวอร์ชันเดิม — เครื่องลูกค้าที่จำรูปไว้ไม่ต้องโหลดใหม่
