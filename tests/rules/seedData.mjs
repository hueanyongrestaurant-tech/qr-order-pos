// ข้อมูลตัวอย่างชุดเดียว ใช้ทั้งพรีวิวบนเครื่อง (preview-seed.mjs) และเทสต์ยอดสรุปรายวัน (dailyStats.test.mjs)
// เป็นข้อมูลแต่งขึ้นทั้งหมด (ไม่ใช่ข้อมูลร้านจริง) — เวลาอิงจาก "ตอนนี้" (now) จะได้มีวันนี้/เมื่อวาน/วันเก่าเสมอ
// มีเคสยาก ๆ ที่สรุปรายวันต้องคิดให้ตรงกับหน้าสถิติเดิม:
//   เมนูเปลี่ยนชื่อ / เมนูถูกลบ / ตัวเลือกเปลี่ยนชื่อ / ตัวเลือกถูกลบ / ตัวเลือกแบบเดิม (ความเผ็ด) / ลำดับตัวเลือกต่างกันแต่ key เดียวกัน
//   จ่ายแยก (split) / บิลเก่าไม่มีวิธีจ่าย / กลับบ้าน / รายการ void / ออเดอร์ยกเลิก / บิลรวมข้ามเที่ยงคืน
//   ออเดอร์ค้างในวันเก่า / บิลย้อนหลัง

const base = { description: { th: "", en: "" }, photo: "", hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false, customGroups: [] };
const meatGroup = (labels) => ({
  id: "meat", nameTh: "เนื้อสัตว์", nameEn: "Meat", type: "single", required: true,
  choices: labels.map(([id, th, en]) => ({ id, labelTh: th, labelEn: en, priceDelta: id === "duck" ? 20 : 0 })),
});
const extrasGroup = { id: "extras", nameTh: "เพิ่ม", nameEn: "Extras", type: "multi", choices: [
  { id: "x", labelTh: "หมูกรอบ", labelEn: "Crispy pork", priceDelta: 20 },
  { id: "y", labelTh: "ไข่ต้ม", labelEn: "Boiled egg", priceDelta: 10 },
] };

// เมนู "ตอนสั่ง" (snapshot ที่อยู่ในออเดอร์)
const ORDERED = {
  khaosoi: { ...base, id: "khaosoi", categoryId: "food", name: { th: "ข้าวซอยไก่", en: "Khao Soi Chicken" }, price: 70, customGroups: [extrasGroup] },
  sai: { ...base, id: "sai", categoryId: "food", name: { th: "ไส้อั่ว", en: "Northern Sausage" }, price: 90 },
  larb: { ...base, id: "larb", categoryId: "food", name: { th: "ลาบคั่ว", en: "Larb Khua" }, price: 80, customGroups: [meatGroup([["pork", "หมู", "Pork"], ["chicken", "ไก่", "Chicken"], ["duck", "เป็ด", "Duck"]])] },
  rice: { ...base, id: "rice", categoryId: "food", name: { th: "ข้าวเหนียว", en: "Sticky Rice" }, price: 10 },
  tea: { ...base, id: "tea", categoryId: "drinks", name: { th: "ชาเย็น", en: "Thai Iced Tea" }, price: 35 },
  water: { ...base, id: "water", categoryId: "drinks", name: { th: "น้ำเปล่า", en: "Water" }, price: 15 },
  tomyum: { ...base, id: "tomyum", categoryId: "food", name: { th: "ต้มยำ", en: "Tom Yum" }, price: 120 },
  tomyumNew: { ...base, id: "tomyum", categoryId: "food", name: { th: "ต้มยำ (สูตรใหม่)", en: "Tom Yum (new)" }, price: 130 },
  somtam: { ...base, id: "somtam", categoryId: "food", name: { th: "ส้มตำ", en: "Papaya Salad" }, price: 50, hasSpice: true },
};

// เมนู "ปัจจุบัน" ในระบบ: ข้าวซอยเปลี่ยนชื่อ, ลาบเปลี่ยนชื่อตัวเลือกหมู + ลบเป็ด + สลับลำดับกลุ่ม, ต้มยำถูกลบ (ไม่มีในนี้)
export const CURRENT_MENU = {
  khaosoi: { ...ORDERED.khaosoi, name: { th: "ข้าวซอยไก่ (ชามใหญ่)", en: "Khao Soi Chicken (large)" }, order: 0 },
  sai: { ...ORDERED.sai, order: 1 },
  larb: { ...ORDERED.larb, customGroups: [meatGroup([["chicken", "ไก่", "Chicken"], ["pork", "หมูสับ", "Minced pork"]])], order: 2 },
  rice: { ...ORDERED.rice, order: 3 },
  somtam: { ...ORDERED.somtam, order: 4 },
  tea: { ...ORDERED.tea, order: 0 },
  water: { ...ORDERED.water, order: 1 },
};
export const CATEGORIES = {
  food: { nameTh: "อาหาร", nameEn: "Food", order: 0 },
  drinks: { nameTh: "เครื่องดื่ม", nameEn: "Drinks", order: 1 },
};

// orders: { [id]: data } พร้อม setDoc — Timestamp มาจาก firebase/firestore ของผู้เรียก (instance เดียวกับ emulator)
export function seedOrders(Timestamp, now = new Date()) {
  let n = 0;
  const line = (m, quantity, extra = {}) => ({ cartId: `c${n++}`, item: ORDERED[m], quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {}, ...extra });
  const at = (daysAgo, hh, mm = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hh, mm);
  const ts = (d) => Timestamp.fromDate(d);
  const orders = {};
  const paid = (id, d, items, more = {}) => {
    orders[id] = {
      tableNumber: `1-${1 + (n % 6)}`, status: "paid", items, createdAt: ts(d), paidAt: ts(new Date(d.getTime() + 45 * 60000)),
      paymentMethod: "cash", paymentBatchId: `pb-${id}`, ...more,
    };
  };

  // ยอดย้อนหลัง ~14 เดือน (ให้กราฟ สัปดาห์/เดือน/ปี มีข้อมูล) — 1 บิลต่อ 2 วัน บางวัน 2 บิล
  for (let d = 420; d >= 2; d -= 2) {
    const bills = d % 6 === 0 ? 2 : 1;
    for (let b = 0; b < bills; b++) {
      const items = [
        line("khaosoi", 1 + ((d + b) % 3), (d + b) % 5 === 0 ? { customSelections: { extras: ["x", "y"] } } : {}),
        line("tea", 1 + (d % 2)),
        ...(d % 4 === 0 ? [line("sai", 1)] : []),
        ...(d % 10 === 0 ? [line("larb", 1, { customSelections: { meat: [d % 20 === 0 ? "duck" : "pork"] } })] : []),
        ...(d % 14 === 0 ? [line(d > 60 ? "tomyum" : "tomyumNew", 1)] : []),
        ...(d % 8 === 0 ? [line("somtam", 1, { spiceLevel: 2 })] : []),
      ];
      const method = (d + b) % 3 === 0 ? "transfer" : (d + b) % 7 === 0 ? "split" : "cash";
      paid(`p${d}-${b}`, at(d, 12 + (d % 7) + b), items, {
        paymentMethod: method,
        ...(method === "split" ? { transferAmount: 50, cashReceived: 100 } : {}),
      });
    }
  }

  // ── เคสพิเศษ ──
  // key เดียวกัน (extras x,y) แต่ลำดับต่างกัน — แถวต้องโชว์ลำดับของออเดอร์ล่าสุด
  paid("order-swap", at(9, 18), [line("khaosoi", 1, { customSelections: { extras: ["y", "x"] } })]);
  // void 1 บรรทัด (ไม่นับ) + กลับบ้าน (ไม่นับเป็นโต๊ะ)
  paid("void-line", at(11, 13), [line("sai", 2), line("tea", 3, { voided: true, voidReason: "ลูกค้าเปลี่ยนใจ" })]);
  paid("takeaway", at(11, 14), [line("rice", 4)], { tableNumber: "0", isTakeaway: true, takeawayLabel: "T-3" });
  // บิลเก่าไม่มีวิธีจ่าย (นับยอด แต่ไม่เข้าเงินสด/โอน)
  paid("no-method", at(30, 12), [line("water", 2)], { paymentMethod: undefined });
  delete orders["no-method"].paymentMethod;
  // ยกเลิกทั้งใบ (ไม่นับ)
  orders["cancelled-old"] = { tableNumber: "2-1", status: "cancelled", items: [line("sai", 5)], createdAt: ts(at(12, 19)), cancelledAt: ts(at(12, 19, 30)) };
  // บิลรวมข้ามเที่ยงคืน: รอบแรก 23:30 ของ 16 วันก่อน + รอบสอง 00:20 ของ 15 วันก่อน — batch เดียวกัน = 1 โต๊ะเมื่อดูทั้งสองวัน
  paid("midnight-a", at(16, 23, 30), [line("larb", 1, { customSelections: { meat: ["chicken"] } })], { tableNumber: "1-5", paymentBatchId: "pb-midnight" });
  paid("midnight-b", at(15, 0, 20), [line("tea", 2)], { tableNumber: "1-5", paymentBatchId: "pb-midnight" });
  // ออเดอร์ค้างในวันเก่า (รอชำระ 6 วันก่อน) — วันนั้นยังไม่บันทึกสรุปจนกว่าจะปิด
  orders["stuck-open"] = { tableNumber: "2-3", status: "awaiting-payment", items: [line("sai", 1)], createdAt: ts(at(6, 20)) };
  // บิลย้อนหลังของ 4 วันก่อน (ยกเลิกได้จากหน้าประวัติ)
  paid("backfill-old", at(4, 15), [line("khaosoi", 2), line("water", 1)], { backfilled: true, backfilledAt: ts(at(3, 9)), paymentMethod: "transfer" });

  // ── เมื่อวาน + วันนี้ ──
  paid("y-1", at(1, 12), [line("khaosoi", 2), line("tea", 2)]);
  paid("y-2", at(1, 19), [line("larb", 1, { customSelections: { meat: ["pork"] } }), line("rice", 2)], { paymentMethod: "transfer" });
  paid("t-1", at(0, 0, 5) > now ? at(0, 0, 0) : at(0, 0, 5), [line("water", 1)], { paymentMethod: "split", transferAmount: 5, cashReceived: 20 });

  // รอชำระวันนี้: 1-2 (2 รอบ), 1-3, 2-1 — ใช้กับหน้าจ่ายเงิน/ลิงก์ลูกค้า
  const minsAgo = (m) => ts(new Date(now.getTime() - m * 60000));
  orders.o12a = { tableNumber: "1-2", status: "awaiting-payment", items: [line("khaosoi", 2), line("rice", 2)], createdAt: minsAgo(70) };
  orders.o12b = { tableNumber: "1-2", status: "awaiting-payment", items: [line("tea", 2)], createdAt: minsAgo(40) };
  orders.o13a = { tableNumber: "1-3", status: "awaiting-payment", items: [line("sai", 1), line("larb", 1, { customSelections: { meat: ["chicken"] } }), line("water", 2)], createdAt: minsAgo(55) };
  orders.o21a = { tableNumber: "2-1", status: "awaiting-payment", items: [line("larb", 1, { customSelections: { meat: ["pork"] } }), line("rice", 1)], createdAt: minsAgo(30) };
  return orders;
}
