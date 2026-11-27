# รูปเมนู (menuPhotos) — ย้ายจาก Supabase / รูปย่อ / ต้นฉบับ / สำรอง / กู้คืน

ตั้งแต่ 25 พ.ย. 69 รูปเมนูอยู่ใน Firestore `menuPhotos/{itemId}` (WebP ≤ 600px ~25–40 KB) — ดู `src/app/menuPhotos.ts`
`menuItems` เก็บแค่ `photoVersion` | `menuItems.photo` (URL Supabase เดิม) **ห้ามแก้/ลบ** — สคริปต์ 11 ธ.ค. ใช้

- `photoVersion` ไม่มี = ยังรอรูปเดิม (ลูกค้าเห็นช่องว่าง) | `0` = พนักงานลบรูปเอง | `> 0` = มีรูป
- รูปย่อ `menuPhotoThumbs/{itemId}` (240px ~5 KB) ใช้ในหน้ารายการเมนู/ตะกร้า — รูปเต็มโหลดตอนเปิดรายละเอียดเมนูเท่านั้น
  ไม่มีรูปย่อ / เวอร์ชันเก่ากว่า = ลูกค้าเห็นรูปเต็มแทน (ไม่มีรูปผิด)
- ต้นฉบับ (ขนาดเดิม ไม่บีบ) อยู่ใน Cloud Storage `photo-originals/{itemId}/{เวลา}.{นามสกุล}` — สำรองอย่างเดียว ไม่ใช้แสดงผล
  แอปอัปเองทุกครั้งที่พนักงานเปลี่ยนรูป (ชื่อไฟล์ = photoVersion) | ค้างในเครื่อง = ตั้งค่า → เครื่องนี้ → "สำรองรูปต้นฉบับ"
  กฎ: `storage.rules` (สร้าง = บัญชีร้าน, อ่าน = เจ้าของ, ทับ/ลบไม่ได้)
- dry-run อ่านอย่างเดียว **ไม่ต้องใช้รหัส** | apply ถามรหัส **บัญชีเจ้าของ** แล้วให้พิมพ์ `yes`
- รันซ้ำได้เสมอ: ไม่ทับรูปที่มีอยู่ (ยกเว้นรูปที่ติ๊ก "ชั่วคราว" ตอนอัป) ไม่เติมรูปที่พนักงานลบ ไม่อัปต้นฉบับซ้ำ

## 1. เอารูป 38 รูปที่กู้จาก cache ของ Chrome เข้าระบบ

รูปอยู่ที่ `recovered-menu-photos/menuPhotos/*.jpg` (ไม่อยู่ใน git) — ทำรูปย่อให้ด้วย

```
npm run menuphotos:recovered:dry-run
npm run menuphotos:recovered:apply
```

## 2. รูปย่อ (ทำครั้งแรกหลังอัปเดตแอป และหลังกู้รูป)

ทำรูปย่อให้ทุกเมนูที่มีรูปแต่รูปย่อไม่มี / เก่า / ขนาดไม่ตรง `THUMB_SIDE` — ย่อจากรูปเต็มใน `menuPhotos`
อ่าน ~2 ครั้งต่อเมนูที่มีรูป (~250 reads ครั้งเดียว)

```
npm run menuphotos:thumbs:dry-run
npm run menuphotos:thumbs:apply
```

## 3. วันที่ 11 ธ.ค. — ต้นฉบับทุกรูปจาก Supabase (เตรียมไว้แล้ว ยังไม่ได้รัน)

**ต้องวางกฎ Storage ก่อน** (`storage.rules`) ไม่งั้นอัปต้นฉบับไม่ผ่าน (รูปแสดงผลยังเขียนได้ รันซ้ำทีหลังได้)

1. ดาวน์โหลดต้นฉบับ **ทุกเมนูที่มี URL Supabase** (รวมเมนูที่ซ่อน / ลบรูปแล้ว / มีรูปใหม่แล้ว)
   เก็บในเครื่องที่ `scripts/menu-photos/downloads/<วันที่>/` ด้วย (ไม่อยู่ใน git)
2. อัปทุกไฟล์ขึ้น Storage `photo-originals/{itemId}/{เวลา}.{นามสกุล}` — เวลา = เวอร์ชันรูปใหม่ (ถ้าได้รูปแสดงผลรอบนี้)
   ไม่งั้นเวลาที่ไฟล์ถูกอัปขึ้น Supabase | เคยอัปแล้วข้าม (ดูจาก `supabasePath` ใน metadata)
3. เมนูที่ยังไม่มีรูป/รูปชั่วคราว → เขียนรูปแสดงผล + รูปย่อ

```
npm run menuphotos:supabase:dry-run     ← เช็คว่าเปิดไฟล์ได้ครบ (HEAD เท่านั้น ไม่ดาวน์โหลด)
npm run menuphotos:supabase:apply
npm run menuphotos:thumbs:dry-run       ← รูปย่อของเมนูที่เหลือ (ควรเป็น 0 ถ้าทำขั้น 2 แล้ว)
```

ถ้ามีไฟล์ที่เปิดไม่ได้ (ยังล็อก) รันซ้ำทีหลังได้ — ตัวที่ใส่แล้วไม่ถูกแตะ
เสร็จแล้ว: ทำขั้น "เลิกใช้ Supabase" (branch `remove-supabase` บนเครื่องนี้ — ดูข้อความ commit)

## 4. ดาวน์โหลดต้นฉบับทั้งหมดลงเครื่อง (เจ้าของเท่านั้น)

```
npm run menuphotos:originals:download                 ← ลง scripts/menu-photos/downloads/originals/
npm run menuphotos:originals:download -- D:\รูปต้นฉบับ  ← หรือโฟลเดอร์ที่เลือก
```

โฟลเดอร์ย่อยตั้งชื่อตาม id เมนู + `menu-names.csv` บอกชื่อเมนู | ไฟล์ที่มีในเครื่องแล้วข้าม (ไฟล์ใน Storage ไม่เปลี่ยน)
ค่าใช้จ่าย: ถ้าบัคเก็ตอยู่นอกโซน US ฟรี ~฿4 ต่อการดาวน์โหลด 1 GB

## 5. สำรองอัตโนมัติทุกสัปดาห์ (GitHub Action)

`.github/workflows/photo-backup.yml` — ทุกวันจันทร์ 03:00 เวลาไทย อ่าน `menuItems` + `menuPhotos` แบบสาธารณะ
(ไม่ต้องมี secret) แล้วเขียนทับ branch `photo-backup` เป็น commit เดียว: `photos/<itemId>.webp` + `manifest.json`
เก็บเฉพาะเวอร์ชันล่าสุด repo ไม่โต | รูปลดลงเกินครึ่งจากครั้งก่อน = ไม่ยอมเขียนทับ (กันไฟล์สำรองดีๆ หาย)
รูปย่อไม่ได้สำรอง (ทำใหม่จากรูปเต็มได้ — ขั้น 2)

กดรันเองได้ที่ GitHub → Actions → photo-backup → Run workflow
รันบนเครื่องเองก็ได้: `npm run menuphotos:backup -- ../photo-backup-local`

หมายเหตุ: GitHub ปิด workflow ตามเวลาเองถ้า repo ไม่มีความเคลื่อนไหว 60 วัน (จะมีอีเมลเตือน) — กด Enable กลับได้

## 6. กู้ menuPhotos จาก branch photo-backup

```
git fetch origin photo-backup
git worktree add ../photo-backup origin/photo-backup
npm run menuphotos:restore:dry-run -- ../photo-backup
npm run menuphotos:restore:apply -- ../photo-backup
npm run menuphotos:thumbs:apply
git worktree remove ../photo-backup
```

กู้เฉพาะเมนูที่ **ไม่มี doc รูป** ตอนนี้ (รูปที่มีอยู่ไม่ทับ) ใช้เลขเวอร์ชันเดิม — เครื่องลูกค้าที่จำรูปไว้ไม่ต้องโหลดใหม่

## ทดสอบกับ emulator (ไม่แตะร้านจริง)

`MENUPHOTOS_EMULATOR=1` = ใช้ project `demo-hueanyong` บน emulator (Firestore 8080 / Auth 9099 / Storage 9199)
`MENUPHOTOS_FETCH_BASE=http://127.0.0.1:<port>` = ดึง "รูป Supabase" จากเซิร์ฟเวอร์ในเครื่องแทน
