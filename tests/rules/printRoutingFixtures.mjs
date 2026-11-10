// ออเดอร์ตัวอย่างจากเมนูจริง (fixtures/menuItems-2026-10-20.json) สำหรับทดสอบ หมวด → จุดพิมพ์
// ใช้ร่วมกันระหว่าง printRouting.test.mjs กับ fixtures/station-tickets-golden.json (ผลของ planTickets+layoutTicket
// จับไว้จากโค้ดก่อนเพิ่ม status/printRouting — ccc3aab) ห้ามแก้ของเดิมในไฟล์นี้ ไม่งั้น golden ไม่ตรง
import menuFixture from "./fixtures/menuItems-2026-10-20.json";

// ชื่อหมวดสมมติตามของในหมวด (fixture มีแต่ id) — เครื่องดื่ม/ของฝากขึ้นต้นตาม COUNTER_CATEGORY_PREFIXES
export const ROUTING_CATEGORIES = [
  ["FzjtnouB5Mf8BCNgYILS", "อาหารเหนือ"],
  ["JrE0GUnuZVq70DFN7JJy", "ต้ม/แกง"],
  ["mxympcjEz6sLCqF3UjQ5", "ยำ"],
  ["Wk2oV2pWLt9mQOhBvmeU", "ของทอด"],
  ["A209qGE7hdKpiVKOsZs7", "ผัด"],
  ["2NXv4pNZRU9yjVl9OIEq", "ข้าวผัด"],
  ["qwxD1JbhmdBDvc23f2mH", "ข้าว/เส้น"],
  ["aR7y3YHQYS3LdCbFJWcf", "เครื่องดื่ม"],
  ["cYpEAYtt7l5CMLTPWq4l", "ของฝาก"],
  ["5mIYAa6JGcKLBnA9tYhC", "อาหารเจ"],
].map(([id, nameTh], order) => ({ id, nameTh, nameEn: id, order, active: true }));
// เมนูในหมวด appetizers/drinks/desserts/... (หมวดชุดเก่าที่ไม่มีแล้ว) = เมนูของหมวดที่ถูกลบ

const MENU = menuFixture.menuItems.map(({ id, data }) => ({ id, ...data, customGroups: data.customGroups || [] }));
const ADDON = { id: "addon-bag", categoryId: "__addon__", name: { th: "ค่าถุง", en: "Bag" }, description: { th: "", en: "" }, photo: "", price: 5, customGroups: [] };

// LCG — ออเดอร์เหมือนเดิมทุกครั้งที่รัน
let seed = 20261111;
const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
const NOTES = ["ไม่เผ็ด", "แยกน้ำ", "ไม่ใส่ผัก", ""];
export const ROUTING_NOW = new Date(2026, 10, 11, 12, 30);

export const ROUTING_ORDERS = [];
for (let o = 0; o < 80; o++) {
  const lines = [];
  const count = 1 + rnd(7);
  for (let i = 0; i < count; i++) {
    const item = MENU[rnd(MENU.length)];
    const extra = {};
    if (rnd(5) === 0) extra.note = NOTES[rnd(NOTES.length)];
    if (rnd(8) === 0) { extra.customNote = "เพิ่มไข่ดาว"; extra.customAddOnPrice = 10; }
    if (rnd(12) === 0) extra.voided = true;
    lines.push({ cartId: `o${o}-${i}`, item, quantity: 1 + rnd(3), spiceLevel: 0, addEgg: false, addOns: [], customSelections: {}, ...extra });
  }
  if (rnd(6) === 0) lines.push({ cartId: `o${o}-addon`, item: ADDON, quantity: 1, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} });
  ROUTING_ORDERS.push({
    id: `ord${o}`,
    tableNumber: `${1 + rnd(3)}-${1 + rnd(5)}`,
    isTakeaway: rnd(10) === 0 ? true : undefined,
    timestamp: ROUTING_NOW,
    status: "in-progress",
    items: lines,
  });
}
// ออเดอร์ที่มีแต่ add-on
ROUTING_ORDERS.push({ id: "addon-only", tableNumber: "1-1", timestamp: ROUTING_NOW, status: "in-progress",
  items: [{ cartId: "ao", item: ADDON, quantity: 2, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} }] });

export const ROUTING_ROLES = ["all", "counter", "inner", "outer", "kitchen"];
