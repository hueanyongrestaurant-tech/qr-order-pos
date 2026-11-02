// บิลตัวอย่างสำหรับทดสอบใบเสร็จ — ใช้ร่วมกันระหว่าง printLayout.test.mjs กับไฟล์ golden
// fixtures/receipt-classic-golden.json (ผลของ layoutReceipt แบบเดิม จับไว้ก่อนเพิ่มใบเสร็จแบบใหม่ 3 พ.ย. 2026)
// ห้ามแก้บิลในไฟล์นี้ — แก้แล้ว golden ไม่ตรง (ต้องการบิลใหม่ให้เพิ่มต่อท้าย RECEIPT_CASES แล้วเขียน golden ใหม่จาก commit เดิม)

const noBuiltins = { hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
const menu = (id, th, en, price, extra = {}) =>
  ({ id, categoryId: "food", name: { th, en }, description: { th: "", en: "" }, photo: "", price, ...noBuiltins, customGroups: [], ...extra });
let n = 0;
const line = (item, quantity, extra = {}) =>
  ({ cartId: `r${n++}`, item, quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {}, ...extra });

const noodleGroups = [
  { id: "g1", nameTh: "เส้น", nameEn: "Noodle", type: "single", choices: [
    { id: "c1", labelTh: "เส้นเล็ก", labelEn: "Thin", priceDelta: 0 },
    { id: "c2", labelTh: "เส้นใหญ่", labelEn: "Wide", priceDelta: 0 },
  ] },
  { id: "g2", nameTh: "เพิ่ม", nameEn: "Extra", type: "multi", choices: [
    { id: "c3", labelTh: "ลูกชิ้นปลา", labelEn: "Fish balls", priceDelta: 15 },
    { id: "c4", labelTh: "ไม่ใส่ผักชี", labelEn: "No coriander", priceDelta: 0 },
  ] },
];

export const RECEIPT_ITEMS = [
  line(menu("a", "ชาไทย", "Thai tea", 45), 1),
  line(menu("b", "น้ำเปล่า", "Water", 10), 12),
  line(menu("c", "ข้าวซอยไก่", "Khao soi chicken", 70), 2),
  line(menu("d", "ขนมจีนน้ำเงี้ยวซี่โครงหมูตุ๋นพิเศษใส่เลือด", "Khanom jeen nam ngiao pork rib special", 120), 3),
  line(menu("e", "ผัดซีอิ๊วเส้นใหญ่หมูนุ่มไข่ดาวกรอบ", "Pad see ew", 1250), 1, { customNote: "เพิ่มผักบุ้งน้ำมันหอย", customAddOnPrice: 20 }),
  line(menu("f", "น้ำผึ้งมะนาวโซดา", "Honey lime soda", 55), 1),
  line(menu("g", "ก๋วยเตี๋ยวต้มยำ", "Tom yum noodles", 60, { hasSpice: true, customGroups: noodleGroups }), 2,
    { spiceLevel: 2, addEgg: false, customSelections: { g1: ["c2"], g2: ["c3", "c4"] } }),
];
// คิดเอง: 45 + 120 + 140 + 360 + 1270 + 55 + (60+15)*2 = 2140
export const RECEIPT_TOTAL = 2140;

// ใบเสร็จที่ต้องเหมือนเดิมทุกตัวอักษรตอนสวิตช์ปิด (th/en × โต๊ะ/กลับบ้าน × บิลยาว/บิลสั้น)
export const RECEIPT_CASES = [
  { name: "table-3-1-full", label: { th: "ม้าหินอ่อน", en: "Marble bench" }, items: RECEIPT_ITEMS, total: RECEIPT_TOTAL },
  { name: "takeaway-short", label: { th: "T-12", en: "T-12" }, items: RECEIPT_ITEMS.slice(0, 2), total: 165 },
];
export const RECEIPT_NOW = new Date(2026, 9, 23, 12, 30);
