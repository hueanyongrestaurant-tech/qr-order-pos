import { useState } from "react";
import { Check, ChevronLeft, Plus, Trash2, X } from "lucide-react";
import type { Category, CustomGroup, Language, MenuItem } from "../types";
import { T } from "../translations";
import { compressImage, resolvePhoto, uid } from "../utils";
import { isChoiceClosed, normalizeMenuItem } from "../menuOptions";
import { LannaBorder } from "../shared";
import { parseStockInput, stockLevel, type StockEntry } from "../stock";
import type { PrepEntry } from "../prep";

// ค่าสต็อกจากฟอร์ม — remaining null = ไม่จำกัด | remainingChanged = พนักงานแก้ช่องจำนวนจริง
// (ไม่แก้ = ไม่เขียนทับ remaining ที่ลูกค้าอาจเพิ่งตัดไประหว่างเปิดหน้านี้ค้างไว้)
export interface StockFormValue {
  remaining: number | null;
  alertAt: number | null;
  remainingChanged: boolean;
}

interface StaffMenuEditProps {
  lang: Language;
  item: MenuItem;
  onSave: (item: MenuItem, stock: StockFormValue) => Promise<void>;
  // สวิตช์ เปิด/ปิด ตัวเลือก — เขียนลง DB ทันที (ไม่รอปุ่มบันทึก) คืน false = ตัวเลือกนี้ยังไม่มีใน DB เก็บไว้ในฟอร์มก่อน
  onSetChoiceClosed: (itemId: string, groupId: string, choiceId: string, closed: boolean) => Promise<boolean>;
  onCancel: () => void;
  onLangToggle: () => void;
  categories: Category[];
  stock?: StockEntry; // สต็อกปัจจุบันของเมนูนี้ (ไม่มี = ไม่จำกัด)
  prepMap: Map<string, PrepEntry>; // ของเตรียมทั้งหมด — ติ๊กผูกกับเมนูนี้ได้ในแท็บสต็อก (บันทึกพร้อมปุ่มบันทึก)
  stockEnabled: boolean;
}

type EditTab = "info" | "stock" | "options";

const INPUT = "w-full min-w-0 bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
const SMALL_INPUT = "w-full min-w-0 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary";

export function StaffMenuEditScreen({ lang, item, onSave, onSetChoiceClosed, onCancel, onLangToggle, categories, stock, prepMap, stockEnabled }: StaffMenuEditProps) {
  const t = T[lang];
  const en = lang === "en";
  // ตัวเลือกทั้งหมดอยู่ใน customGroups — เมนูแบบเดิม (ตัวเลือกในตัว) ถูกแปลงเป็นกลุ่มตรงนี้ บันทึกแล้วเป็นแบบใหม่ใน DB เลย
  const [form, setForm] = useState<MenuItem>(() => normalizeMenuItem(item));
  const [tab, setTab] = useState<EditTab>("info");
  const initialRemaining = stock ? String(stock.remaining) : "";
  const [remainingInput, setRemainingInput] = useState(initialRemaining);
  const [alertInput, setAlertInput] = useState(stock?.alertAt !== undefined ? String(stock.alertAt) : "");
  // ตัวเลือกที่กดสวิตช์แล้วแต่ยังไม่มีใน DB (เพิ่งเพิ่ม) — มีผลตอนกดบันทึก
  const [pendingSwitches, setPendingSwitches] = useState<Set<string>>(new Set());

  const update = (patch: Partial<MenuItem>) => setForm((prev) => ({ ...prev, ...patch }));
  const groups = form.customGroups || [];
  const setGroups = (next: CustomGroup[]) => update({ customGroups: next });
  const patchGroup = (gIdx: number, patch: Partial<CustomGroup>) =>
    setGroups(groups.map((g, i) => (i === gIdx ? { ...g, ...patch } : g)));

  // บันทึกไม่สำเร็จ (เช่น session หลุด/เน็ตหลุด/rules ปฏิเสธ) เดิมเงียบหายไปเลย — ตอนนี้แสดงข้อความค้างไว้ให้เห็น
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const errorCode = (err: unknown) => (err as { code?: string })?.code ?? (err as Error)?.message ?? String(err);
  const handleSave = async () => {
    const remainingChanged = remainingInput.trim() !== initialRemaining;
    // จำนวนติดลบที่ค้างอยู่ (จากคืนรายการ) ยังบันทึกต่อได้ถ้าไม่ได้แก้ช่องนี้
    const remaining = remainingChanged ? parseStockInput(remainingInput) : stock ? stock.remaining : null;
    const alertAt = parseStockInput(alertInput);
    if (remaining === "invalid" || alertAt === "invalid") {
      setTab("stock");
      setSaveError(en ? "Stock must be a whole number (leave blank for unlimited)" : "สต็อกต้องเป็นจำนวนเต็ม (เว้นว่าง = ไม่จำกัด)");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(form, { remaining, alertAt, remainingChanged });
    } catch (err) {
      console.error("save menu item failed", err);
      setSaveError(`${en ? "Save failed" : "บันทึกไม่สำเร็จ"} (${errorCode(err)})`);
    } finally {
      setSaving(false);
    }
  };

  // สวิตช์ เปิด/ปิด: เปลี่ยนในฟอร์มทันที แล้วเขียนลง DB ทันที (เหมือนปุ่มด่วนในหน้าจัดการเมนู)
  const toggleChoice = async (groupId: string, choiceId: string, closed: boolean) => {
    const apply = (value: boolean) => setForm((prev) => ({
      ...prev,
      customGroups: (prev.customGroups || []).map((g) => g.id !== groupId ? g : {
        ...g,
        choices: g.choices.map((c) => {
          if (c.id !== choiceId) return c;
          const { soldOut: _soldOut, active: _active, ...rest } = c;
          return value ? { ...rest, soldOut: true } : rest;
        }),
      }),
    }));
    apply(closed);
    const key = `${groupId}:${choiceId}`;
    try {
      const written = await onSetChoiceClosed(form.id, groupId, choiceId, closed);
      setPendingSwitches((prev) => {
        const next = new Set(prev);
        if (written) next.delete(key); else next.add(key);
        return next;
      });
    } catch (err) {
      console.error("set choice closed failed", err);
      apply(!closed);
      setSaveError(`${en ? "Could not switch the option" : "เปิด/ปิดตัวเลือกไม่สำเร็จ"} (${errorCode(err)})`);
    }
  };

  const level = stock ? stockLevel(stock) : null;
  const prepIds = form.prepIds ?? [];
  const togglePrep = (id: string) =>
    update({ prepIds: prepIds.includes(id) ? prepIds.filter((p) => p !== id) : [...prepIds, id] });
  const sortedPreps = [...prepMap].sort(([, a], [, b]) => a.name.localeCompare(b.name, "th"));
  const tabs: { key: EditTab; label: string; badge?: { text: string; warn?: boolean } }[] = [
    { key: "info", label: en ? "Menu info" : "ข้อมูลเมนู" },
    {
      key: "stock",
      label: en ? "Stock" : "สต็อก",
      badge: stock ? { text: String(stock.remaining), warn: level === "low" || level === "negative" || level === "out" } : undefined,
    },
    { key: "options", label: en ? "Options" : "ตัวเลือก", badge: groups.length > 0 ? { text: String(groups.length) } : undefined },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-50">
        <div className="bg-[#3C2414]">
          <LannaBorder />
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
              <ChevronLeft size={24} />
            </button>
            <div className="font-display font-semibold text-[#FFF8F0]">
              {en ? "Edit Menu Item" : "แก้ไขเมนู"}
            </div>
            <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
          </div>
        </div>
        <div className="bg-background px-4 pt-3 pb-2">
          <div className="max-w-3xl mx-auto flex gap-1 bg-muted p-1 rounded-2xl" role="tablist">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                role="tab"
                aria-selected={tab === tb.key}
                onClick={() => { setTab(tb.key); window.scrollTo(0, 0); }}
                className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${tab === tb.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {tb.label}
                {tb.badge && (
                  <span className={`text-[11px] leading-[18px] px-1.5 rounded-full text-primary-foreground ${tb.badge.warn ? "bg-[#D07E35]" : "bg-primary"}`}>
                    {tb.badge.text}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full max-w-3xl mx-auto px-4 pt-3 pb-32">
        {tab === "info" && (
          <>
            <div className="mb-5">
              <label className="text-sm font-semibold text-foreground block mb-1.5">{en ? "Photo" : "รูปภาพ"}</label>
              {form.photo ? (
                <div className="relative w-full h-40 rounded-xl overflow-hidden bg-muted mb-2">
                  <img src={resolvePhoto(form.photo, 600, 400)} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => update({ photo: "" })}
                    className="absolute top-2 right-2 bg-black/60 text-white p-1.5 rounded-full hover:bg-black/80 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <div className="w-full h-40 rounded-xl bg-muted flex items-center justify-center mb-2 text-muted-foreground text-sm">
                  {en ? "No photo" : "ยังไม่มีรูป"}
                </div>
              )}
              <label className="block w-full text-center bg-card border-2 border-dashed border-border rounded-xl py-2.5 text-sm font-medium text-foreground cursor-pointer hover:border-primary/40 transition-all">
                {en ? "Upload Photo" : "อัปโหลดรูปภาพ"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) update({ photo: await compressImage(file) });
                  }}
                />
              </label>
            </div>

            <div className="mb-4">
              <label className="text-sm font-semibold text-foreground block mb-1.5">{en ? "Category" : "หมวดหมู่"}</label>
              <select value={form.categoryId} onChange={(e) => update({ categoryId: e.target.value })} className={INPUT}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{en ? c.nameEn : c.nameTh}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              <div className="mb-4">
                <label className="text-sm font-semibold text-foreground block mb-1.5">ชื่อ (ภาษาไทย)</label>
                <input value={form.name.th} onChange={(e) => update({ name: { ...form.name, th: e.target.value } })} className={INPUT} />
              </div>
              <div className="mb-4">
                <label className="text-sm font-semibold text-foreground block mb-1.5">Name (English)</label>
                <input value={form.name.en} onChange={(e) => update({ name: { ...form.name, en: e.target.value } })} className={INPUT} />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm font-semibold text-foreground block mb-1.5">{en ? "Price (THB)" : "ราคา (บาท)"}</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.price === 0 ? "" : form.price}
                onChange={(e) => update({ price: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                placeholder="0"
                className={INPUT}
              />
            </div>

            <div className="mb-4">
              <label className="text-sm font-semibold text-foreground block mb-1.5">คำอธิบาย (ภาษาไทย)</label>
              <textarea
                value={form.description.th}
                onChange={(e) => update({ description: { ...form.description, th: e.target.value } })}
                rows={3}
                className={`${INPUT} resize-none`}
              />
            </div>
            <div className="mb-4">
              <label className="text-sm font-semibold text-foreground block mb-1.5">Description (English)</label>
              <textarea
                value={form.description.en}
                onChange={(e) => update({ description: { ...form.description, en: e.target.value } })}
                rows={3}
                className={`${INPUT} resize-none`}
              />
            </div>
          </>
        )}

        {tab === "stock" && (
          <div>
            {stock && (
              <div className="flex items-baseline gap-1.5 mb-4 px-3 py-2.5 rounded-xl bg-[#D07E35]/12">
                <span className="text-sm text-foreground">{en ? "Left now" : "เหลือตอนนี้"}</span>
                <span className="text-2xl font-bold text-[#a3561b]">{stock.remaining}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-foreground block mb-1.5">{en ? "Plates/pieces left" : "จำนวนที่เหลือ (จาน/ชิ้น)"}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={remainingInput}
                  onChange={(e) => setRemainingInput(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder={en ? "Unlimited" : "ไม่จำกัด"}
                  className={INPUT}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-foreground block mb-1.5">{en ? "Warn at ≤" : "เตือนเมื่อเหลือ ≤"}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={alertInput}
                  onChange={(e) => setAlertInput(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="-"
                  className={INPUT}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {en
                ? "Blank = unlimited. Each order takes from it; at 0 the item shows Sold out. Entering a new number puts it back on sale."
                : "เว้นว่าง = ไม่จำกัด ตัดทุกครั้งที่สั่ง เหลือ 0 ขึ้น \"หมด\" เอง ใส่จำนวนใหม่ = เปิดขายอีกครั้ง"}
              {!stockEnabled && (en ? " (Stock system is OFF — the number is kept but not used.)" : " (ระบบสต็อกปิดอยู่ — เก็บจำนวนไว้แต่ยังไม่ตัด)")}
            </p>

            {/* ของเตรียมที่เมนูนี้ใช้ — สร้าง/แก้จำนวนที่แท็บ "ของเตรียม" ในหน้าจัดการเมนู */}
            <div className="mt-6">
              <label className="text-sm font-semibold text-foreground block mb-1.5">{en ? "Uses prepared items" : "ใช้ของเตรียม"}</label>
              {sortedPreps.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {en ? "No prepared items yet — add them in Menu → Prepared items." : "ยังไม่มีของเตรียม — เพิ่มได้ที่หน้าจัดการเมนู → แท็บ \"ของเตรียม\""}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {sortedPreps.map(([id, p]) => {
                      const on = prepIds.includes(id);
                      return (
                        <button
                          key={id}
                          onClick={() => togglePrep(id)}
                          aria-pressed={on}
                          className={`min-h-[40px] px-3 rounded-full border-2 text-sm font-medium flex items-center gap-1.5 transition-colors active:scale-95 ${on ? "bg-secondary/10 border-secondary text-secondary" : "border-border text-muted-foreground"}`}
                        >
                          {on ? <Check size={14} /> : <Plus size={14} />}
                          {p.name}
                          <span className="text-[11px] tabular-nums opacity-80">· {p.remaining ?? (en ? "∞" : "ไม่จำกัด")}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {en
                      ? "Each plate takes 1 from every ticked item. Sold out when any of them (or this menu's own stock) hits 0."
                      : "สั่ง 1 จาน หักของเตรียมที่ติ๊กไว้อย่างละ 1 — หมดเมื่ออันใดอันหนึ่ง (หรือสต็อกของเมนูนี้) เหลือ 0"}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "options" && (
          <div>
            {groups.map((group, gIdx) => (
              <div key={group.id} className="bg-card border border-border rounded-2xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={group.nameTh}
                    onChange={(e) => patchGroup(gIdx, { nameTh: e.target.value })}
                    placeholder="ชื่อกลุ่ม (TH)"
                    className={SMALL_INPUT}
                  />
                  <input
                    value={group.nameEn}
                    onChange={(e) => patchGroup(gIdx, { nameEn: e.target.value })}
                    placeholder="Group name (EN)"
                    className={SMALL_INPUT}
                  />
                  <button
                    onClick={() => setGroups(groups.filter((_, i) => i !== gIdx))}
                    className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 p-1"
                    aria-label={en ? "Delete group" : "ลบกลุ่ม"}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-muted-foreground">
                  <span>{en ? "Can choose:" : "เลือกได้:"}</span>
                  <select
                    value={group.type}
                    onChange={(e) => patchGroup(gIdx, { type: e.target.value as "single" | "multi" })}
                    className="bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none"
                  >
                    <option value="single">{en ? "1 only" : "1 อย่าง"}</option>
                    <option value="multi">{en ? "Several" : "หลายอย่าง"}</option>
                  </select>
                  <button
                    onClick={() => patchGroup(gIdx, { required: !group.required })}
                    aria-pressed={!!group.required}
                    className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${group.required ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {group.required ? "✓ " : ""}{en ? "Required" : "ต้องเลือก"}
                  </button>
                </div>

                <button
                  onClick={() => patchGroup(gIdx, { quickToggle: !group.quickToggle })}
                  aria-pressed={!!group.quickToggle}
                  className={`w-full flex items-center gap-2 text-left text-[13px] rounded-xl px-2.5 py-2 mb-2.5 border transition-colors ${group.quickToggle
                    ? "bg-secondary/10 border-secondary/30 text-secondary font-semibold"
                    : "bg-transparent border-border text-muted-foreground"
                    }`}
                >
                  <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center flex-shrink-0 ${group.quickToggle ? "bg-secondary border-secondary text-white" : "border-current"}`}>
                    {group.quickToggle && <Check size={12} strokeWidth={3} />}
                  </span>
                  {en ? "Show on Menu screen (quick on/off buttons)" : "แสดงในหน้าจัดการเมนู (ปุ่มเปิด/ปิดด่วน)"}
                </button>

                <div className="space-y-2 mb-2">
                  {group.choices.map((choice, cIdx) => {
                    const closed = isChoiceClosed(choice);
                    const patchChoice = (patch: Partial<typeof choice>) =>
                      patchGroup(gIdx, { choices: group.choices.map((c, i) => (i === cIdx ? { ...c, ...patch } : c)) });
                    return (
                      <div
                        key={choice.id}
                        className={`grid grid-cols-[auto_1fr_3.5rem_auto] sm:grid-cols-[auto_1fr_1fr_5rem_auto] gap-x-1.5 gap-y-1 items-center ${closed ? "[&_input]:opacity-50 [&_input]:line-through" : ""}`}
                      >
                        <button
                          onClick={() => toggleChoice(group.id, choice.id, !closed)}
                          role="switch"
                          aria-checked={!closed}
                          className="row-span-2 sm:row-span-1 flex flex-col items-center flex-shrink-0 pr-1"
                        >
                          <span className={`w-11 h-6 rounded-full relative transition-colors ${closed ? "bg-muted-foreground/40" : "bg-secondary"}`}>
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${closed ? "left-0.5" : "left-[22px]"}`} />
                          </span>
                          <span className={`text-[10px] font-bold mt-0.5 ${closed ? "text-destructive" : "text-secondary"}`}>
                            {closed ? (en ? "Off" : "ปิด") : (en ? "On" : "เปิด")}
                          </span>
                        </button>
                        <input
                          value={choice.labelTh}
                          onChange={(e) => patchChoice({ labelTh: e.target.value })}
                          placeholder="ตัวเลือก (TH)"
                          className={SMALL_INPUT}
                        />
                        <input
                          value={choice.labelEn}
                          onChange={(e) => patchChoice({ labelEn: e.target.value })}
                          placeholder="Choice (EN)"
                          className={`${SMALL_INPUT} col-start-2 col-span-2 row-start-2 sm:col-auto sm:col-span-1 sm:row-auto text-xs sm:text-sm`}
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          value={choice.priceDelta || ""}
                          onChange={(e) => patchChoice({ priceDelta: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                          placeholder="+฿"
                          className={`${SMALL_INPUT} col-start-3 row-start-1 sm:col-auto sm:row-auto`}
                        />
                        <button
                          onClick={() => patchGroup(gIdx, { choices: group.choices.filter((_, i) => i !== cIdx) })}
                          className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 p-1 col-start-4 row-start-1 sm:col-auto sm:row-auto"
                          aria-label={en ? "Delete choice" : "ลบตัวเลือก"}
                        >
                          <X size={14} />
                        </button>
                        {pendingSwitches.has(`${group.id}:${choice.id}`) && (
                          <span className="col-start-2 col-span-3 sm:col-span-4 text-[10px] text-muted-foreground">
                            {en ? "New option — takes effect when you Save" : "ตัวเลือกใหม่ — มีผลเมื่อกดบันทึก"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={() => patchGroup(gIdx, { choices: [...group.choices, { id: uid(), labelEn: "", labelTh: "", priceDelta: 0 }] })}
                  className="text-primary text-xs font-semibold flex items-center gap-1 py-1"
                >
                  <Plus size={12} /> {en ? "Add Choice" : "เพิ่มตัวเลือก"}
                </button>
              </div>
            ))}

            <p className="text-[11px] text-muted-foreground mb-3">
              {en
                ? "Off = customers still see it, greyed out as Sold out. Switches take effect right away (no need to Save). If every choice of a Required group is off, the item shows Sold out."
                : "ปิด = ลูกค้ายังเห็นแต่เป็นสีเทา \"หมด\" เลือกไม่ได้ · กดสวิตช์แล้วมีผลทันที ไม่ต้องกดบันทึก · กลุ่ม \"ต้องเลือก\" ที่ปิดหมดทุกตัว = เมนูขึ้นหมด"}
            </p>
            <button
              onClick={() => setGroups([...groups, { id: uid(), nameTh: "", nameEn: "", type: "single", quickToggle: false, choices: [] }])}
              className="w-full border-2 border-dashed border-primary/40 text-primary font-semibold rounded-xl py-2.5 text-sm flex items-center justify-center gap-1"
            >
              <Plus size={14} /> {en ? "Add option group" : "เพิ่มกลุ่มตัวเลือก"}
            </button>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
        <div className="max-w-3xl mx-auto">
          {saveError && (
            <div className="mb-2 px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-sm font-medium text-center">
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !form.name.en || !form.name.th}
            className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base disabled:opacity-40 hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
          >
            {saving ? (en ? "Saving…" : "กำลังบันทึก…") : (en ? "Save" : "บันทึก")}
          </button>
        </div>
      </div>
    </div>
  );
}
