// ─── ตัวเลือกของเมนู: ใช้แค่กลุ่มที่สร้างเอง (customGroups) อย่างเดียว ────────────────
// ตัวเลือกในตัวแบบเดิม (hasMeatChoice / hasSpice / hasPortion / hasEggAddon / hasPlainAddOns) เลิกใช้แล้ว
// เมนูที่ยังเป็นแบบเดิม (ก่อนรันสคริปต์แปลงข้อมูล หรือถูกแอปเก่าแก้กลับ) ถูกแปลงเป็นกลุ่มตอนอ่านด้วย
// normalizeMenuItem — ผลเหมือนกับที่สคริปต์แปลงเขียนลง DB ทุกตัวอักษร (id ของกลุ่ม/ตัวเลือกคงที่)
// ไฟล์นี้ต้องไม่ import อะไรที่แตะ Firebase — สคริปต์แปลงข้อมูลและ test ใช้ร่วมกัน
//
// สถานะของตัวเลือก: soldOut = "ปิด" (ลูกค้ายังเห็นเป็นสีเทา "หมด" เลือกไม่ได้) ใช้ได้ทุกกลุ่ม
// active === false (ปุ่ม "ซ่อน" เดิม ซึ่งแอปเก่ายังกดได้) นับเป็นปิดเหมือนกัน ไม่ให้โผล่กลับมาสั่งได้

import type { CartItem, CustomChoice, CustomGroup, Language, MeatChoice, MenuItem } from "./types";
import { ADD_ONS } from "./constants";
import { T } from "./translations";

export const MEAT_CHOICES: MeatChoice[] = ["pork", "chicken", "beef"];

// id คงที่ของกลุ่มที่แปลงมาจากตัวเลือกในตัว — id ตัวเลือกใช้ค่าเดิมของแบบในตัว (pork, regular, ...)
// ทำให้ออเดอร์ที่สั่งก่อน/หลังแปลง หรือแปลงตอนอ่านกับแปลงใน DB ได้ id เดียวกันเสมอ
export const BUILTIN_GROUP_IDS = {
  meat: "builtin-meat",
  spice: "builtin-spice",
  portion: "builtin-portion",
  egg: "builtin-egg",
  addOns: "builtin-addons",
} as const;
export const EGG_PRICE = 15;
const SPICE_CHOICE_IDS = ["spice0", "spice1", "spice2", "spice3"];

// field ของตัวเลือกในตัวแบบเดิม — สคริปต์แปลง/ย้อนกลับแตะเฉพาะ field ชุดนี้ + customGroups
export const LEGACY_OPTION_FLAGS = ["hasMeatChoice", "hasSpice", "hasPortion", "hasEggAddon", "hasPlainAddOns"] as const;
export const LEGACY_OPTION_VALUES = ["meatPriceDeltas", "portionPriceDelta", "disabledMeats", "soldOutMeats"] as const;
export const OPTION_FIELDS = [...LEGACY_OPTION_FLAGS, ...LEGACY_OPTION_VALUES, "customGroups"] as const;

// กลุ่มที่ชื่อมีคำว่า "เนื้อสัตว์" — ใช้แค่เป็นค่าตั้งต้นของ "แสดงในหน้าจัดการเมนู" ตอนกลุ่มยังไม่เคยตั้ง (quickToggle ไม่มีค่า)
export function isMeatGroup(group: CustomGroup): boolean {
  return (group.nameTh || "").includes("เนื้อสัตว์");
}

// true = ตัวเลือกของกลุ่มนี้ขึ้นเป็นปุ่มเปิด/ปิดด่วนในหน้าจัดการเมนู
export function isQuickToggleGroup(group: CustomGroup): boolean {
  return group.quickToggle ?? isMeatGroup(group);
}

export function isChoiceClosed(choice: CustomChoice): boolean {
  return !!choice.soldOut || choice.active === false;
}

// true = เมนูนี้มีตัวเลือกในตัวแบบเดิมเปิดอยู่ หรือยังมี field แบบเดิม/สถานะ "ซ่อน" ค้างอยู่ (ต้องแปลง)
export function hasLegacyOptions(item: MenuItem): boolean {
  if (item.hasMeatChoice || item.hasSpice || item.hasPortion) return true;
  if (item.hasEggAddon !== false || item.hasPlainAddOns !== false) return true;
  if (LEGACY_OPTION_VALUES.some((k) => item[k] !== undefined)) return true;
  return (item.customGroups || []).some((g) =>
    g.defaultChoiceId !== undefined || g.quickToggle === undefined || g.choices.some((c) => c.active !== undefined));
}

function choice(id: string, labelTh: string, labelEn: string, priceDelta: number, closed = false): CustomChoice {
  return { id, labelTh, labelEn, priceDelta, ...(closed ? { soldOut: true } : {}) };
}

// กลุ่มที่ได้จากตัวเลือกในตัวของเมนูนี้ เรียงเหมือนที่ลูกค้าเห็นเดิม: เนื้อ → เผ็ด → ขนาด → ไข่ดาว → จาน/ช้อน/แก้ว
// ไม่มีตัวเลือกเริ่มต้น (ลูกค้าเลือกเอง) | เนื้อที่ "ซ่อน" หรือ "หมด" อยู่ → ปิด
export function legacyGroups(item: MenuItem): CustomGroup[] {
  const groups: CustomGroup[] = [];
  if (item.hasMeatChoice) {
    groups.push({
      id: BUILTIN_GROUP_IDS.meat, nameTh: T.th.meatChoice, nameEn: T.en.meatChoice, type: "single", required: true, quickToggle: true,
      choices: MEAT_CHOICES.map((m) => choice(m, T.th.meats[m], T.en.meats[m], item.meatPriceDeltas?.[m] || 0,
        !!item.disabledMeats?.includes(m) || !!item.soldOutMeats?.includes(m))),
    });
  }
  if (item.hasSpice) {
    groups.push({
      id: BUILTIN_GROUP_IDS.spice, nameTh: T.th.spiceLevel, nameEn: T.en.spiceLevel, type: "single", required: true, quickToggle: false,
      choices: SPICE_CHOICE_IDS.map((id, level) => choice(id, T.th.spiceLevels[level], T.en.spiceLevels[level], 0)),
    });
  }
  if (item.hasPortion) {
    groups.push({
      id: BUILTIN_GROUP_IDS.portion, nameTh: T.th.portion, nameEn: T.en.portion, type: "single", required: true, quickToggle: false,
      choices: [choice("regular", T.th.regular, T.en.regular, 0), choice("special", T.th.special, T.en.special, item.portionPriceDelta || 0)],
    });
  }
  // ไม่มี field = เปิด (ค่าเริ่มต้นของแบบเดิม)
  if (item.hasEggAddon !== false) {
    groups.push({
      id: BUILTIN_GROUP_IDS.egg, nameTh: T.th.addEgg, nameEn: T.en.addEgg, type: "multi", required: false, quickToggle: false,
      choices: [choice("egg", "ไข่ดาว", "Fried Egg", EGG_PRICE)],
    });
  }
  if (item.hasPlainAddOns !== false) {
    groups.push({
      id: BUILTIN_GROUP_IDS.addOns, nameTh: T.th.addOns, nameEn: T.en.addOns, type: "multi", required: false, quickToggle: false,
      choices: ADD_ONS.map((a) => choice(a.id, a.label.th, a.label.en, a.price)),
    });
  }
  return groups;
}

// กลุ่มเดิมให้อยู่ในรูปใหม่: ไม่มีตัวเลือกเริ่มต้น, ตั้ง quickToggle ชัดเจน, "ซ่อน" → ปิด
function normalizeGroup(g: CustomGroup): CustomGroup {
  const { defaultChoiceId: _default, ...rest } = g;
  return {
    ...rest,
    quickToggle: isQuickToggleGroup(g),
    choices: g.choices.map((c) => {
      const { active: _active, soldOut: _soldOut, ...cRest } = c;
      return isChoiceClosed(c) ? { ...cRest, soldOut: true } : cRest;
    }),
  };
}

// เมนูในรูปใหม่ (ตัวเลือกทั้งหมดอยู่ใน customGroups) — เมนูที่แปลงแล้วคืนตัวเดิม (object เดิม) ไม่ต้อง copy
// ตัวเลือกในตัวตั้งเป็น false ไว้ ไม่ลบทิ้ง: แอปเก่านับ "ไม่มี field" ของไข่ดาว/จาน-ช้อน-แก้ว ว่าเปิดอยู่
export function normalizeMenuItem<M extends MenuItem>(item: M): M {
  if (!hasLegacyOptions(item)) return item;
  const converted = [...legacyGroups(item), ...(item.customGroups || []).map(normalizeGroup)];
  const next: M = { ...item, hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false };
  LEGACY_OPTION_VALUES.forEach((k) => { delete next[k]; });
  delete next.customGroups;
  return converted.length > 0 ? { ...next, customGroups: converted } : next;
}

// true = เมนูนี้สั่งไม่ได้ เพราะกลุ่มที่ "ต้องเลือก" กลุ่มใดกลุ่มหนึ่งถูกปิดหมดทุกตัว — คิดตอนแสดงผล ไม่เขียนลง DB
// เปิดกลับมาตัวเดียว เมนูก็กลับมาขายเองทันที
export function requiredGroupAllClosed(item: MenuItem): boolean {
  return (normalizeMenuItem(item).customGroups || []).some((g) =>
    g.required && g.choices.length > 0 && g.choices.every(isChoiceClosed));
}

// ตัวเลือกที่รายการในตะกร้าเลือกไว้ (รวมแบบเดิมที่เก็บเป็น meat/portion/spiceLevel/addEgg/addOns)
// คืนเป็น id กลุ่ม → id ตัวเลือก ในรูปใหม่ — ใช้เทียบกับเมนูล่าสุดตอนเช็คของหมด
export function cartItemSelections(ci: CartItem): Record<string, string[]> {
  const selections: Record<string, string[]> = { ...(ci.customSelections || {}) };
  if (ci.meat) selections[BUILTIN_GROUP_IDS.meat] = [ci.meat];
  if (ci.portion) selections[BUILTIN_GROUP_IDS.portion] = [ci.portion];
  if (ci.item.hasSpice) selections[BUILTIN_GROUP_IDS.spice] = [SPICE_CHOICE_IDS[ci.spiceLevel] ?? "spice0"];
  if (ci.addEgg) selections[BUILTIN_GROUP_IDS.egg] = ["egg"];
  if (ci.addOns?.length) selections[BUILTIN_GROUP_IDS.addOns] = [...ci.addOns];
  return selections;
}

// รายการในตะกร้าเลือกตัวเลือกที่ตอนนี้ปิดอยู่ (เทียบกับเมนูล่าสุด fresh) — ทุกกลุ่ม ไม่ใช่แค่เนื้อสัตว์
export function closedSelectedChoices(ci: CartItem, fresh: MenuItem): CustomChoice[] {
  const selections = cartItemSelections(ci);
  return (normalizeMenuItem(fresh).customGroups || []).flatMap((g) =>
    g.choices.filter((c) => isChoiceClosed(c) && (selections[g.id] || []).includes(c.id)));
}

// ชื่อตัวเลือกที่เลือกไว้ทั้งหมด ตามลำดับกลุ่ม (สำหรับสถิติ: จัดกลุ่มตามชื่อ ไม่ใช่ id)
// ออเดอร์แบบเดิมได้ชื่อเดียวกับที่แปลงแล้ว เช่น ความเผ็ดระดับ 0 = "ไม่เผ็ด", จานธรรมดา = "ธรรมดา", ไข่ดาว = "ไข่ดาว"
// สถิติจึงรวมแถวก่อน/หลังแปลงเป็นแถวเดียวกัน
export function choiceLabels(ci: CartItem, lang: Language): string[] {
  const labels: string[] = [];
  const t = T[lang];
  if (ci.meat) labels.push(t.meats[ci.meat]);
  if (ci.item.hasSpice) labels.push(t.spiceLevels[ci.spiceLevel] ?? t.spiceLevels[0]);
  if (ci.portion) labels.push(ci.portion === "special" ? t.special : t.regular);
  if (ci.addEgg) labels.push(lang === "en" ? "Fried Egg" : "ไข่ดาว");
  (ci.addOns || []).forEach((id) => {
    const addon = ADD_ONS.find((a) => a.id === id);
    if (addon) labels.push(addon.label[lang]);
  });
  ci.item.customGroups?.forEach((group) => {
    const selected = ci.customSelections?.[group.id] || [];
    group.choices.forEach((c) => {
      if (selected.includes(c.id)) labels.push((lang === "en" ? c.labelEn : c.labelTh) || c.labelTh || c.labelEn);
    });
  });
  return labels;
}

// ตั้ง ปิด/เปิด ตัวเลือก 1 ตัวในกลุ่ม (คืน customGroups ชุดใหม่) — null = ไม่มีกลุ่ม/ตัวเลือกนี้ในเมนู
export function setChoiceClosed(groups: CustomGroup[], groupId: string, choiceId: string, closed: boolean): CustomGroup[] | null {
  const group = groups.find((g) => g.id === groupId);
  if (!group || !group.choices.some((c) => c.id === choiceId)) return null;
  return groups.map((g) => g.id !== groupId ? g : {
    ...g,
    choices: g.choices.map((c) => {
      if (c.id !== choiceId) return c;
      const { soldOut: _soldOut, active: _active, ...rest } = c; // เปิด = ลบฟิลด์ออก (ไม่มีค่า = ขายปกติ)
      return closed ? { ...rest, soldOut: true } : rest;
    }),
  });
}
