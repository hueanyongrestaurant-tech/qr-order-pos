import type { CartItem, Language, PaymentMethod } from "../types";
import { T } from "../translations";

// ─── Shared ticket helpers ───────────────────────────────────────────────────
// การพิมพ์จริงอยู่ที่ nativePrinter.ts (แอป Capacitor) — ไฟล์นี้เหลือแค่ส่วนที่ใช้ร่วมกัน
// (JSX KitchenTicket/ReceiptTicket + @media print เดิมถูกลบไปแล้ว ดูย้อนหลังได้ใน git history)

// ตัวเลือกที่ครัวต้องทำตาม: meat/portion/spiceLevel/addEgg/customSelections
export function kitchenOptionSummary(ci: CartItem, lang: Language): string {
  const parts: string[] = [];
  if (ci.meat) parts.push(T[lang].meats[ci.meat]);
  if (ci.portion === "special") parts.push(T[lang].special);
  if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
  if (ci.addEgg) parts.push(T[lang].eggAdded);
  ci.item.customGroups?.forEach((group) => {
    const selected = ci.customSelections?.[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
    });
  });
  return parts.join(", ");
}

export interface ReceiptData {
  label: string;
  items: CartItem[];
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number;
}
