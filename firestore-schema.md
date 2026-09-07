# Firestore Schema — QR Order POS

ทุก collection อยู่ที่ root. ไม่มี Cloud Functions — ตรรกะทั้งหมดอยู่ฝั่ง client (`src/app/App.tsx`)
และบังคับความปลอดภัยผ่าน `firestore.rules`.

---

## `orders/{orderId}`

| field | type | หมายเหตุ |
|---|---|---|
| `tableNumber` | string | รูปแบบ `"<ชั้น>-<โต๊ะ>"` เช่น `"1-3"` — takeaway ใช้ `"0"` |
| `isTakeaway` | boolean? | true = ออเดอร์กลับบ้าน |
| `takeawayLabel` | string? | `"T-1"`, `"T-2"` … (รีเซ็ตรายวันผ่าน `counters/`) |
| `status` | `"in-progress" \| "awaiting-payment" \| "paid" \| "cancelled"` | `"cancelled"` = ยกเลิกทั้งใบ (เอกสารยังอยู่เสมอ ไม่เคยถูกลบ) |
| `items` | `CartItem[]` | ดูด้านล่าง |
| `paymentMethod` | `"cash" \| "transfer"` ? | |
| `cashReceived` | number? | เฉพาะจ่ายเงินสด |
| `paymentBatchId` | string? | ออเดอร์ที่ปิดบิลพร้อมกันใช้ id เดียวกัน |
| `cancelReason` | string? | เหตุผลตอนยกเลิกทั้งใบ (บังคับกรอก) |
| `cancelledAt` | Timestamp? | |
| `createdAt` | Timestamp | `serverTimestamp()` |

### `CartItem` (embedded ใน `items[]`)

ฟิลด์หลัก: `cartId`, `item` (snapshot ของ `MenuItem`), `meat?`, `portion?`, `spiceLevel`,
`addEgg`, `addOns[]`, `customSelections?`, `note?`, `quantity`

ฟิลด์ void (soft-delete รายรายการ):

| field | type | หมายเหตุ |
|---|---|---|
| `voided` | boolean? | true = ถูกยกเลิก **แต่ยังคงอยู่ใน `items[]` เสมอ** — ห้ามลบออกจาก array |
| `voidReason` | string? | เหตุผล (บังคับกรอกก่อน void) |
| `voidedAt` | Timestamp? | |

- รายการที่ `voided: true` → UI แสดงขีดฆ่า/สีจาง, `cartItemTotal()` คืน `0`, ไม่นับในสถิติ/ยอดบิล
- ตอน void → `item.photo` ถูกล้างเป็น `""` (ตัดรูป base64 ทิ้ง เก็บแค่ชื่อ/ราคา/ตัวเลือก)
- ถ้าทุกรายการใน order ถูก void หมด → `status` เปลี่ยนเป็น `"cancelled"` (ไม่ `deleteDoc`)

---

## `activityLogs/{logId}` — บันทึกร่องรอย (สร้างได้/อ่านได้ แก้·ลบไม่ได้)

| field | type | หมายเหตุ |
|---|---|---|
| `action` | enum | `void_item \| cancel_order \| menu_item_added \| menu_item_edited \| menu_item_deleted \| category_deleted \| expense_deleted` |
| `createdAt` | Timestamp | `serverTimestamp()` |
| `orderId` | string? | |
| `tableNumber` | string? | โต๊ะ หรือ `takeawayLabel` |
| `itemName` | string? | ชื่อเมนู/หมวด/รายจ่ายที่เกี่ยวข้อง (ภาษาไทย) |
| `amount` | number? | มูลค่าเงินที่เกี่ยวข้อง (void = ราคา×จำนวน, cancel/payment = ยอดรวม) |
| `reason` | string? | เหตุผล (สำหรับ `void_item` / `cancel_order`) |
| `details` | map? | ข้อมูลเสริม เช่น `{oldPrice,newPrice}` ตอนแก้เมนู, `{items:[…]}` snapshot ตอน cancel |

ไม่มีการระบุตัวตนพนักงานรายคน — ใช้ `createdAt` เทียบกับกล้องวงจรปิด

---

## `voidReasons/list` — เหตุผลที่ใช้ซ้ำได้

```
{ reasons: string[] }   // เพิ่มอัตโนมัติด้วย arrayUnion เมื่อพนักงานพิมพ์เหตุผลใหม่
```

---

## collection อื่น (ไม่เปลี่ยนแปลง)

- `menuItems/{id}` — เมนู (`name`, `description`, `price`, `photo` base64, option groups, `active`, `order`)
- `categories/{id}` — หมวดหมู่ (`nameEn`, `nameTh`, `order`, `active`, `signature`)
- `status/live` — `{ busyTables, busyItems }` แบนเนอร์ "ร้านยุ่ง"
- `counters/takeaway-YYYY-MM-DD` — `{ count }` ตัวนับคิวกลับบ้าน
- `expenses/YYYY-MM-DD` — บัญชีรายจ่ายรายวัน `{ date, items: ExpenseLineItem[], totalAmount, updatedAt }`
- `expenseItems/{sanitizedName}` — catalog ของที่เคยซื้อ ใช้ทำ autocomplete
