import { useState } from "react";
import { Check, ChevronDown, Minus, Plus, Search, Trash2 } from "lucide-react";
import type { Category, Language, MenuItem } from "../types";
import { normalizeMenuItem } from "../menuOptions";
import { choiceKey, prepLinks, type ChoiceRef, type PrepEntry } from "../prep";
import { parseStockInput, stockLevel } from "../stock";

// ─── แท็บ "ของเตรียม" ในหน้าจัดการเมนู (ดู prep.ts) ─────────────────────────────────
// การ์ดละ 1 ของเตรียม: −/+ บันทึกทันที | แตะตัวเลข/ปุ่ม "ใส่จำนวนใหม่" = หน้าต่างกรอกจำนวน กดยืนยันก่อนบันทึก
// แตะชื่อ = หน้าต่างแก้ (ชื่อ / จำนวน / เตือน / ติ๊กเมนูทั้งเมนู หรือเฉพาะตัวเลือก) — ปุ่มทุกปุ่มสูง ≥ 40px กดง่ายบนแท็บเล็ต

// ที่ผูก: ทั้งเมนู (menuIds) และรายตัวเลือก (choices) — ตรงกับ prepLinks ใน prep.ts
export interface PrepLinks {
  menuIds: string[];
  choices: ChoiceRef[];
}

export interface PrepFormValue {
  name: string;
  remaining: number | null; // null = ไม่จำกัด
  alertAt: number | null;
  remainingChanged: boolean;
}

interface PrepPanelProps {
  lang: Language;
  preps: Map<string, PrepEntry>;
  items: (MenuItem & { active?: boolean })[];
  categories: Category[];
  stockEnabled: boolean;
  onSave: (prepId: string | null, form: PrepFormValue, links: PrepLinks) => Promise<void>;
  onAdjust: (prepId: string, delta: 1 | -1) => void;
  onSetRemaining: (prepId: string, remaining: number | null) => Promise<void>;
  onDelete: (prepId: string) => void;
  onAskConfirm: (message: string, onConfirm: () => void, labels?: { confirmLabel?: string; cancelLabel?: string }) => void;
}

const INPUT = "w-full min-w-0 bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
const STEP_BTN = "w-12 h-12 rounded-xl bg-muted text-foreground flex items-center justify-center active:scale-95 transition-all";
const errorText = (err: unknown) => (err as { code?: string })?.code ?? (err as Error)?.message ?? String(err);
const menuName = (lang: Language, m: MenuItem) => (lang === "en" ? m.name.en || m.name.th : m.name.th || m.name.en);
const label = (lang: Language, th: string, en: string) => (lang === "en" ? en || th : th || en) || "—";
// ชื่อที่ผูกไว้ทั้งหมด เช่น "ลาบหมูคั่วเมือง", "ไข่เจียวลาบ (หมู)" — soldOut = เมนู/ตัวเลือกนั้นปิดอยู่
function linkLabels(lang: Language, items: MenuItem[], prepId: string): { key: string; text: string; soldOut: boolean }[] {
  const { menuIds, choices } = prepLinks(items, prepId);
  const byId = new Map(items.map((m) => [m.id, m]));
  return [
    ...menuIds.flatMap((id) => {
      const m = byId.get(id);
      return m ? [{ key: id, text: menuName(lang, m), soldOut: !!m.soldOut }] : [];
    }),
    ...choices.flatMap((c) => {
      const m = byId.get(c.menuId);
      const choice = m && normalizeMenuItem(m).customGroups?.find((g) => g.id === c.groupId)?.choices.find((x) => x.id === c.choiceId);
      if (!m || !choice) return [];
      return [{
        key: `${c.menuId}:${choiceKey(c.groupId, c.choiceId)}`,
        text: `${menuName(lang, m)} (${label(lang, choice.labelTh, choice.labelEn)})`,
        soldOut: !!choice.soldOut || !!m.soldOut,
      }];
    }),
  ];
}

export function StaffPrepPanel({ lang, preps, items, categories, stockEnabled, onSave, onAdjust, onSetRemaining, onDelete, onAskConfirm }: PrepPanelProps) {
  const en = lang === "en";
  // editing: null = ปิด | "new" = เพิ่มใหม่ | id = แก้ของเดิม
  const [editing, setEditing] = useState<string | null>(null);
  const [settingId, setSettingId] = useState<string | null>(null);
  const sorted = [...preps].sort(([, a], [, b]) => a.name.localeCompare(b.name, "th"));

  return (
    <div>
      <button
        onClick={() => setEditing("new")}
        className="w-full mb-4 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <Plus size={16} />
        {en ? "Add prepared item" : "เพิ่มของเตรียม"}
      </button>
      <p className="text-[11px] text-muted-foreground mb-3">
        {en
          ? "Something made in batches and used by several menus. Each plate ordered takes 1. At 0 every linked menu shows Sold out."
          : "ของที่ทำไว้เป็นหม้อ/ชุดแล้วใช้หลายเมนู สั่ง 1 จาน หัก 1 — เหลือ 0 ทุกเมนูที่ผูกขึ้น \"หมด\" พร้อมกัน"}
        {!stockEnabled && (en ? " (Stock system is OFF — numbers are kept but not used.)" : " (ระบบสต็อกปิดอยู่ — เก็บจำนวนไว้แต่ยังไม่ตัด)")}
      </p>

      {sorted.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
          {en ? "No prepared items yet" : "ยังไม่มีของเตรียม"}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map(([id, prep]) => (
            <PrepCard
              key={id}
              lang={lang}
              prep={prep}
              linked={linkLabels(lang, items, id)}
              stockEnabled={stockEnabled}
              onEdit={() => setEditing(id)}
              onSetNumber={() => setSettingId(id)}
              onAdjust={(delta) => onAdjust(id, delta)}
            />
          ))}
        </div>
      )}

      {editing !== null && (
        <PrepEditModal
          lang={lang}
          prepId={editing === "new" ? null : editing}
          prep={editing === "new" ? undefined : preps.get(editing)}
          items={items}
          categories={categories}
          onCancel={() => setEditing(null)}
          onSave={async (form, links) => {
            await onSave(editing === "new" ? null : editing, form, links);
            setEditing(null);
          }}
          onDelete={editing === "new" ? undefined : () => {
            const id = editing;
            const name = preps.get(id)?.name ?? "";
            onAskConfirm(
              en ? `Delete ${name}? Linked menus and options will be unlinked.` : `ลบ ${name}? เมนูและตัวเลือกที่ผูกไว้จะถูกถอดออก`,
              () => { onDelete(id); setEditing(null); },
              { confirmLabel: en ? "Delete" : "ลบ", cancelLabel: en ? "No" : "ไม่" },
            );
          }}
        />
      )}

      {settingId !== null && preps.has(settingId) && (
        <SetRemainingModal
          lang={lang}
          prep={preps.get(settingId)!}
          onCancel={() => setSettingId(null)}
          onConfirm={async (value) => {
            await onSetRemaining(settingId, value);
            setSettingId(null);
          }}
        />
      )}
    </div>
  );
}

function PrepCard({ lang, prep, linked, stockEnabled, onEdit, onSetNumber, onAdjust }: {
  lang: Language;
  prep: PrepEntry;
  linked: { key: string; text: string; soldOut: boolean }[];
  stockEnabled: boolean;
  onEdit: () => void;
  onSetNumber: () => void;
  onAdjust: (delta: 1 | -1) => void;
}) {
  const en = lang === "en";
  const limited = prep.remaining !== undefined;
  const level = limited ? stockLevel({ remaining: prep.remaining!, alertAt: prep.alertAt }) : "ok";
  const out = level === "out" || level === "negative";
  const badge = !limited
    ? { text: en ? "Unlimited" : "ไม่จำกัด", cls: "bg-muted text-muted-foreground" }
    : !stockEnabled
      ? { text: en ? "Stock off" : "ระบบสต็อกปิด", cls: "bg-muted text-muted-foreground" }
      : out
        ? { text: en ? "Sold out" : "หมด", cls: "bg-destructive text-destructive-foreground" }
        : level === "low"
          ? { text: en ? "Running low" : "ใกล้หมด", cls: "bg-[#D07E35] text-white" }
          : { text: en ? "OK" : "พอ", cls: "bg-secondary/15 text-secondary" };
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-start gap-2">
        <button onClick={onEdit} className="flex-1 min-w-0 text-left font-semibold text-foreground text-sm py-1 hover:text-primary transition-colors">
          {prep.name || "—"}
        </button>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${badge.cls}`}>{badge.text}</span>
      </div>

      {limited ? (
        <div className="flex items-center justify-center gap-4 my-3">
          <button onClick={() => onAdjust(-1)} className={STEP_BTN} aria-label="-1">
            <Minus size={20} />
          </button>
          <button
            onClick={onSetNumber}
            className={`min-w-[64px] min-h-[48px] text-center font-display font-bold text-3xl tabular-nums rounded-xl hover:bg-muted transition-colors ${out ? "text-destructive" : "text-foreground"}`}
            aria-label={en ? "Enter a new number" : "ใส่จำนวนใหม่"}
          >
            {prep.remaining}
          </button>
          <button onClick={() => onAdjust(1)} className={STEP_BTN} aria-label="+1">
            <Plus size={20} />
          </button>
        </div>
      ) : (
        <div className="my-3 text-center text-2xl font-display font-bold text-muted-foreground">∞</div>
      )}

      {(out || !limited) && (
        <button
          onClick={onSetNumber}
          className="w-full min-h-[44px] mb-2 rounded-xl text-sm font-semibold border-2 border-primary text-primary hover:bg-primary/10 active:scale-95 transition-all"
        >
          {limited ? (en ? "Enter a new number" : "ใส่จำนวนใหม่") : (en ? "Set a number" : "ตั้งจำนวน")}
        </button>
      )}

      <div className="text-[11px] text-muted-foreground">
        {prep.alertAt !== undefined && limited && (en ? `Warn at ≤ ${prep.alertAt} · ` : `เตือนเมื่อเหลือ ≤ ${prep.alertAt} · `)}
        {en ? `${linked.length} linked` : `ผูก ${linked.length} รายการ`}
      </div>
      {linked.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {linked.map((l) => (
            <span key={l.key} className={`text-[11px] px-2 py-0.5 rounded-full bg-muted ${l.soldOut ? "text-primary line-through" : "text-muted-foreground"}`}>
              {l.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ใส่จำนวนใหม่ทั้งก้อน — ต้องกดยืนยันก่อนบันทึก (เว้นว่าง = ไม่จำกัด)
function SetRemainingModal({ lang, prep, onCancel, onConfirm }: {
  lang: Language;
  prep: PrepEntry;
  onCancel: () => void;
  onConfirm: (value: number | null) => Promise<void>;
}) {
  const en = lang === "en";
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const value = parseStockInput(input);
    if (value === "invalid") { setError(en ? "Enter a whole number" : "ใส่จำนวนเต็ม"); return; }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(value);
    } catch (err) {
      console.error("set prep remaining failed", err);
      setError(`${en ? "Save failed" : "บันทึกไม่สำเร็จ"} (${errorText(err)})`);
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onCancel}>
      <div className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-foreground text-sm font-semibold">{en ? `New number for ${prep.name}` : `ใส่จำนวนใหม่ ${prep.name}`}</p>
        <p className="text-muted-foreground text-xs mt-1 tabular-nums">
          {en ? "Now: " : "ตอนนี้: "}{prep.remaining ?? (en ? "unlimited" : "ไม่จำกัด")}
        </p>
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => { setInput(e.target.value.replace(/[^0-9]/g, "")); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={en ? "Blank = unlimited" : "เว้นว่าง = ไม่จำกัด"}
          className={`${INPUT} my-4 text-center text-2xl font-bold tabular-nums`}
        />
        {error && <p className="text-xs text-destructive -mt-2 mb-3">{error}</p>}
        <div className="flex gap-2.5">
          <button onClick={onCancel} className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all">
            {en ? "Cancel" : "ยกเลิก"}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-all disabled:opacity-60"
          >
            {input.trim() === ""
              ? (en ? "Confirm unlimited" : "ยืนยัน ไม่จำกัด")
              : (en ? `Confirm ${input}` : `ยืนยัน ${input}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

// หน้าต่างแก้ของเตรียม: ชื่อ / จำนวน / เตือน + ติ๊กที่ผูก (แบ่งตามหมวด ค้นหาได้)
// ติ๊กช่องหน้าชื่อ = ทั้งเมนู (ทุกจานหัก) | กด "ตัวเลือก" แล้วติ๊กตัวเลือก = หักเฉพาะจานที่ลูกค้าเลือกตัวนั้น
function PrepEditModal({ lang, prepId, prep, items, categories, onCancel, onSave, onDelete }: {
  lang: Language;
  prepId: string | null;
  prep?: PrepEntry;
  items: (MenuItem & { active?: boolean })[];
  categories: Category[];
  onCancel: () => void;
  onSave: (form: PrepFormValue, links: PrepLinks) => Promise<void>;
  onDelete?: () => void;
}) {
  const en = lang === "en";
  const initialRemaining = prep?.remaining !== undefined ? String(prep.remaining) : "";
  const [name, setName] = useState(prep?.name ?? "");
  const [remainingInput, setRemainingInput] = useState(initialRemaining);
  const [alertInput, setAlertInput] = useState(prep?.alertAt !== undefined ? String(prep.alertAt) : "");
  const initialLinks = prepId ? prepLinks(items, prepId) : { menuIds: [], choices: [] };
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialLinks.menuIds));
  // ตัวเลือกที่ผูก: key = "menuId|groupId:choiceId"
  const refKey = (menuId: string, groupId: string, choiceId: string) => `${menuId}|${choiceKey(groupId, choiceId)}`;
  const [selectedChoices, setSelectedChoices] = useState<Set<string>>(
    () => new Set(initialLinks.choices.map((c) => refKey(c.menuId, c.groupId, c.choiceId))));
  // เมนูที่กางตัวเลือกอยู่ — เริ่มกางเมนูที่มีตัวเลือกผูกไว้แล้ว
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialLinks.choices.map((c) => c.menuId)));
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const flip = (set: (fn: (prev: Set<string>) => Set<string>) => void, key: string) => set((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggle = (id: string) => flip(setSelected, id);

  const q = search.trim().toLowerCase();
  const matches = (m: MenuItem) => !q || m.name.th.toLowerCase().includes(q) || m.name.en.toLowerCase().includes(q);
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const byCategory = sortedCategories
    .map((c) => ({
      cat: c,
      menus: items
        .filter((m) => m.categoryId === c.id && matches(m))
        .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999) || a.name.en.localeCompare(b.name.en)),
    }))
    .filter((g) => g.menus.length > 0);

  const submit = async () => {
    const remainingChanged = remainingInput.trim() !== initialRemaining;
    // จำนวนติดลบที่ค้างอยู่ยังบันทึกต่อได้ถ้าไม่ได้แก้ช่องนี้
    const remaining = remainingChanged ? parseStockInput(remainingInput) : prep?.remaining ?? null;
    const alertAt = parseStockInput(alertInput);
    if (!name.trim()) { setError(en ? "Enter a name" : "ใส่ชื่อของเตรียม"); return; }
    if (remaining === "invalid" || alertAt === "invalid") {
      setError(en ? "Numbers must be whole numbers (blank = unlimited)" : "จำนวนต้องเป็นจำนวนเต็ม (เว้นว่าง = ไม่จำกัด)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const choices = [...selectedChoices].map((k) => {
        const [menuId, rest] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
        const groupId = rest.slice(0, rest.indexOf(":"));
        return { menuId, groupId, choiceId: rest.slice(groupId.length + 1) };
      });
      await onSave({ name: name.trim(), remaining, alertAt, remainingChanged }, { menuIds: [...selected], choices });
    } catch (err) {
      console.error("save prep failed", err);
      setError(`${en ? "Save failed" : "บันทึกไม่สำเร็จ"} (${errorText(err)})`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border">
          <p className="text-foreground font-semibold mb-3">{prepId ? (en ? "Edit prepared item" : "แก้ของเตรียม") : (en ? "New prepared item" : "เพิ่มของเตรียม")}</p>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">{en ? "Name" : "ชื่อ"}</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} className={INPUT} />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">{en ? "Left" : "เหลือ"}</label>
              <input
                type="text"
                inputMode="numeric"
                value={remainingInput}
                onChange={(e) => { setRemainingInput(e.target.value.replace(/[^0-9]/g, "")); setError(null); }}
                placeholder={en ? "Unlimited" : "ไม่จำกัด"}
                className={INPUT}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">{en ? "Warn at ≤" : "เตือนเมื่อ ≤"}</label>
              <input
                type="text"
                inputMode="numeric"
                value={alertInput}
                onChange={(e) => { setAlertInput(e.target.value.replace(/[^0-9]/g, "")); setError(null); }}
                placeholder="-"
                className={INPUT}
              />
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">
            {en ? "Used by (1 per plate) — tick a whole menu, or open Options to tick just a choice" : "ใช้กับ (หัก 1 ต่อ 1 จาน) — ติ๊กทั้งเมนู หรือกด \"ตัวเลือก\" แล้วติ๊กเฉพาะตัวเลือก"}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {en ? `${selected.size + selectedChoices.size} selected` : `เลือกแล้ว ${selected.size + selectedChoices.size}`}
          </span>
        </div>
        <div className="px-4 pt-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={en ? "Search menus" : "ค้นหาเมนู"} className={`${INPUT} pl-9`} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {byCategory.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">{en ? "No menus match" : "ไม่พบเมนู"}</p>}
          {byCategory.map(({ cat, menus }) => (
            <div key={cat.id} className="mb-2">
              <div className="text-xs font-semibold text-muted-foreground pt-2 pb-1">{en ? cat.nameEn : cat.nameTh}</div>
              {menus.map((m) => {
                const on = selected.has(m.id);
                const groups = (normalizeMenuItem(m).customGroups ?? []).filter((g) => g.choices.length > 0);
                const open = expanded.has(m.id);
                const choiceCount = groups.reduce((n, g) => n + g.choices.filter((c) => selectedChoices.has(refKey(m.id, g.id, c.id))).length, 0);
                return (
                  <div key={m.id} className="border-b border-border">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggle(m.id)}
                        aria-pressed={on}
                        className={`flex-1 min-w-0 min-h-[44px] flex items-center gap-3 px-2 text-left text-sm transition-colors ${on ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${on ? "bg-secondary border-secondary text-secondary-foreground" : "border-border"}`}>
                          {on && <Check size={14} />}
                        </span>
                        <span className="flex-1 min-w-0 truncate">{menuName(lang, m)}</span>
                        {m.active === false && <span className="text-[11px] text-muted-foreground">{en ? "hidden" : "ซ่อน"}</span>}
                      </button>
                      {groups.length > 0 && (
                        <button
                          onClick={() => flip(setExpanded, m.id)}
                          aria-expanded={open}
                          className={`min-h-[40px] px-3 rounded-lg text-xs font-medium flex items-center gap-1 flex-shrink-0 transition-colors ${choiceCount > 0 ? "text-secondary" : "text-muted-foreground"} hover:bg-muted`}
                        >
                          {en ? "Options" : "ตัวเลือก"}{choiceCount > 0 ? ` (${choiceCount})` : ""}
                          <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                    {open && (
                      <div className="pl-11 pr-2 pb-2.5 space-y-1.5">
                        {groups.map((g) => (
                          <div key={g.id} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground mr-0.5">{label(lang, g.nameTh, g.nameEn)}:</span>
                            {g.choices.map((c) => {
                              const key = refKey(m.id, g.id, c.id);
                              const cOn = selectedChoices.has(key);
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => flip(setSelectedChoices, key)}
                                  aria-pressed={cOn}
                                  className={`min-h-[36px] px-3 rounded-full border-2 text-xs font-medium flex items-center gap-1 transition-colors active:scale-95 ${cOn ? "bg-secondary/10 border-secondary text-secondary" : "border-border text-muted-foreground"}`}
                                >
                                  {cOn && <Check size={12} />}
                                  {label(lang, c.labelTh, c.labelEn)}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border">
          {error && <p className="text-xs text-destructive mb-2">{error}</p>}
          <div className="flex items-center gap-2.5">
            {onDelete && (
              <button onClick={onDelete} className="min-h-[44px] px-3 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 flex items-center gap-1.5 transition-all">
                <Trash2 size={16} />
                {en ? "Delete" : "ลบ"}
              </button>
            )}
            <div className="flex-1" />
            <button onClick={onCancel} className="min-h-[44px] px-5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all">
              {en ? "Cancel" : "ยกเลิก"}
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="min-h-[44px] px-6 rounded-xl text-sm font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-all disabled:opacity-60"
            >
              {saving ? (en ? "Saving…" : "กำลังบันทึก…") : (en ? "Save" : "บันทึก")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
