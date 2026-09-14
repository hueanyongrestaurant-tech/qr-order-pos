import { useState } from "react";
import { ChevronLeft, Plus, Trash2, X } from "lucide-react";
import type { Category, Language, MeatChoice, MenuItem } from "../types";
import { T } from "../translations";
import { compressImage, resolvePhoto, uid } from "../utils";
import { LannaBorder } from "../shared";

interface StaffMenuEditProps {
  lang: Language;
  item: MenuItem;
  onSave: (item: MenuItem) => void;
  onCancel: () => void;
  onLangToggle: () => void;
  categories: Category[];
}

export function StaffMenuEditScreen({ lang, item, onSave, onCancel, onLangToggle, categories, }: StaffMenuEditProps) {
  const t = T[lang];
  const [form, setForm] = useState<MenuItem>(item);

  const update = (patch: Partial<MenuItem>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {lang === "en" ? "Edit Menu Item" : "แก้ไขเมนู"}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-5 overflow-y-auto pb-28" style={{ scrollbarWidth: "none" }}>
        <div className="mb-5">
          <label className="text-sm font-semibold text-foreground block mb-1.5">
            {lang === "en" ? "Photo" : "รูปภาพ"}
          </label>
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
              {lang === "en" ? "No photo" : "ยังไม่มีรูป"}
            </div>
          )}
          <label className="block w-full text-center bg-card border-2 border-dashed border-border rounded-xl py-2.5 text-sm font-medium text-foreground cursor-pointer hover:border-primary/40 transition-all">
            {lang === "en" ? "Upload Photo" : "อัปโหลดรูปภาพ"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const base64 = await compressImage(file);
                  update({ photo: base64 });
                }
              }}
            />
          </label>
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">
            {lang === "en" ? "Category" : "หมวดหมู่"}
          </label>
          <select
            value={form.categoryId}
            onChange={(e) => update({ categoryId: e.target.value })}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{lang === "en" ? c.nameEn : c.nameTh}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">Name (English)</label>
          <input
            value={form.name.en}
            onChange={(e) => update({ name: { ...form.name, en: e.target.value } })}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">ชื่อ (ภาษาไทย)</label>
          <input
            value={form.name.th}
            onChange={(e) => update({ name: { ...form.name, th: e.target.value } })}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">Description (English)</label>
          <textarea
            value={form.description.en}
            onChange={(e) => update({ description: { ...form.description, en: e.target.value } })}
            rows={3}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary resize-none"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">คำอธิบาย (ภาษาไทย)</label>
          <textarea
            value={form.description.th}
            onChange={(e) => update({ description: { ...form.description, th: e.target.value } })}
            rows={3}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary resize-none"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">
            {lang === "en" ? "Price (THB)" : "ราคา (บาท)"}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={form.price === 0 ? "" : form.price}
            onChange={(e) => update({ price: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
            placeholder="0"
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="h-px bg-border my-5" />

        <h3 className="font-semibold text-foreground text-sm mb-3">
          {lang === "en" ? "Options" : "ตัวเลือกของเมนูนี้"}
        </h3>

        {/* Built-in toggles */}
        <div className="space-y-2 mb-5">
          {[
            { key: "hasMeatChoice" as const, label: lang === "en" ? "Meat Choice" : "เลือกเนื้อสัตว์" },
            { key: "hasSpice" as const, label: lang === "en" ? "Spice Level" : "ระดับความเผ็ด" },
            { key: "hasPortion" as const, label: lang === "en" ? "Portion Size" : "ขนาดจาน (ธรรมดา/พิเศษ)" },
            { key: "hasEggAddon" as const, label: lang === "en" ? "Add Fried Egg" : "เพิ่มไข่ดาว" },
            { key: "hasPlainAddOns" as const, label: lang === "en" ? "Extra Plate/Cutlery/Water" : "จาน/ช้อนส้อม/แก้วน้ำเพิ่ม" },
            { key: "popular" as const, label: t.popular },
          ].map((opt) => {
            const isOn = opt.key === "hasEggAddon" || opt.key === "hasPlainAddOns"
              ? form[opt.key] !== false
              : !!form[opt.key];
            return (
              <button
                key={opt.key}
                onClick={() => update({ [opt.key]: !isOn } as Partial<MenuItem>)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${isOn ? "bg-primary/8 border-primary" : "bg-card border-border"
                  }`}
              >
                <span className="text-sm font-medium text-foreground">{opt.label}</span>
                <div className={`w-11 h-6 rounded-full relative transition-colors ${isOn ? "bg-primary" : "bg-muted"}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${isOn ? "left-[22px]" : "left-0.5"}`} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Meat price deltas — only if meat choice is on */}
        {form.hasMeatChoice && (
          <div className="mb-5">
            <label className="text-sm font-semibold text-foreground block mb-2">
              {lang === "en" ? "Extra price per meat type (0 = same price)" : "ราคาเพิ่มต่อชนิดเนื้อ (0 = ราคาเท่ากัน)"}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["pork", "chicken", "beef"] as MeatChoice[]).map((m) => {
                const isDisabled = form.disabledMeats?.includes(m);
                return (
                  <div key={m}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{T[lang].meats[m]}</span>
                      <button
                        onClick={() => {
                          const current = form.disabledMeats || [];
                          update({
                            disabledMeats: isDisabled ? current.filter((x) => x !== m) : [...current, m],
                          });
                        }}
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${isDisabled ? "bg-muted text-muted-foreground" : "bg-secondary/15 text-secondary"}`}
                      >
                        {isDisabled ? (lang === "en" ? "Off" : "ปิด") : (lang === "en" ? "On" : "เปิด")}
                      </button>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.meatPriceDeltas?.[m] || ""}
                      onChange={(e) =>
                        update({
                          meatPriceDeltas: { ...form.meatPriceDeltas, [m]: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 },
                        })
                      }
                      placeholder="0"
                      disabled={isDisabled}
                      className="w-full bg-card border-2 border-border rounded-lg px-2 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-40"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Portion price delta — only if portion is on */}
        {form.hasPortion && (
          <div className="mb-5">
            <label className="text-sm font-semibold text-foreground block mb-1.5">
              {lang === "en" ? "Extra price for Special portion" : "ราคาเพิ่มถ้าเลือกขนาดพิเศษ"}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={form.portionPriceDelta || ""}
              onChange={(e) => update({ portionPriceDelta: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
              placeholder="0"
              className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        )}

        {/* Custom groups manager */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-foreground">
              {lang === "en" ? "Custom Option Groups" : "ตัวเลือกที่สร้างเอง"}
            </label>
            <button
              onClick={() =>
                update({
                  customGroups: [
                    ...(form.customGroups || []),
                    { id: uid(), nameTh: "", nameEn: "", type: "single", choices: [] },
                  ],
                })
              }
              className="text-primary text-xs font-semibold flex items-center gap-1"
            >
              <Plus size={14} /> {lang === "en" ? "Add Group" : "เพิ่มกลุ่ม"}
            </button>
          </div>

          {(form.customGroups || []).map((group, gIdx) => (
            <div key={group.id} className="bg-card border border-border rounded-xl p-3 mb-2.5">
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={group.nameEn}
                  onChange={(e) => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, nameEn: e.target.value };
                    update({ customGroups: groups });
                  }}
                  placeholder="Group name (EN)"
                  className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <input
                  value={group.nameTh}
                  onChange={(e) => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, nameTh: e.target.value };
                    update({ customGroups: groups });
                  }}
                  placeholder="ชื่อกลุ่ม (TH)"
                  className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={() => {
                    const groups = (form.customGroups || []).filter((_, i) => i !== gIdx);
                    update({ customGroups: groups });
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs text-muted-foreground">
                  {lang === "en" ? "Selection type:" : "แบบเลือก:"}
                </span>
                <select
                  value={group.type}
                  onChange={(e) => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, type: e.target.value as "single" | "multi" };
                    update({ customGroups: groups });
                  }}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none"
                >
                  <option value="single">{lang === "en" ? "Choose 1" : "เลือกได้ 1"}</option>
                  <option value="multi">{lang === "en" ? "Choose many" : "เลือกได้หลายอย่าง"}</option>
                </select>
                <button
                  onClick={() => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, required: !group.required };
                    update({ customGroups: groups });
                  }}
                  className={`text-[10px] px-2 py-1 rounded-full font-medium ${group.required ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                >
                  {lang === "en" ? "Required" : "บังคับเลือก"}
                </button>
              </div>

              <div className="space-y-1.5 mb-2">
                {group.choices.map((choice, cIdx) => (
                  <div key={choice.id} className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, active: choice.active === false ? true : false };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      className={`text-[9px] px-1.5 py-1.5 rounded-md font-medium flex-shrink-0 ${choice.active === false ? "bg-muted text-muted-foreground" : "bg-secondary/15 text-secondary"}`}
                    >
                      {choice.active === false ? (lang === "en" ? "Off" : "ปิด") : (lang === "en" ? "On" : "เปิด")}
                    </button>
                    <input
                      value={choice.labelEn}
                      onChange={(e) => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, labelEn: e.target.value };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      placeholder="Choice (EN)"
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <input
                      value={choice.labelTh}
                      onChange={(e) => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, labelTh: e.target.value };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      placeholder="ตัวเลือก (TH)"
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={choice.priceDelta || ""}
                      onChange={(e) => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, priceDelta: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      placeholder="+฿"
                      className="w-16 bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => {
                        const groups = [...(form.customGroups || [])];
                        groups[gIdx] = { ...group, choices: group.choices.filter((_, i) => i !== cIdx) };
                        update({ customGroups: groups });
                      }}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => {
                  const groups = [...(form.customGroups || [])];
                  groups[gIdx] = {
                    ...group,
                    choices: [...group.choices, { id: uid(), labelEn: "", labelTh: "", priceDelta: 0 }],
                  };
                  update({ customGroups: groups });
                }}
                className="text-primary text-xs font-semibold flex items-center gap-1"
              >
                <Plus size={12} /> {lang === "en" ? "Add Choice" : "เพิ่มตัวเลือก"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.en || !form.name.th}
          className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base disabled:opacity-40 hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
        >
          {lang === "en" ? "Save" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
