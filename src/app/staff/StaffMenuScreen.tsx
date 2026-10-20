import { useState, useEffect, useRef } from "react";
import { GripVertical, Plus, Star, Trash2, Utensils } from "lucide-react";
import type { Category, Language, MenuAvailability, MenuItem, StaffTab } from "../types";
import { menuAvailabilitySetting } from "../utils";
import { isChoiceClosed, isQuickToggleGroup, requiredGroupAllClosed } from "../menuOptions";
import { T } from "../translations";
import { StaffHeader } from "./StaffHeader";
import { stockLevel, type StockEntry } from "../stock";
import { allPrepLinks, prepIsOut, type PrepEntry } from "../prep";
import { StaffPrepPanel, type PrepFormValue, type PrepLinks } from "./StaffPrepPanel";

// ─── Drag-to-reorder (mouse + touch via Pointer Events) ──────────────────────
// เดิมใช้ปุ่มลูกศรขึ้น/ลง เปลี่ยนมาใช้ "จับที่ไอคอน Grip แล้วลาก" แทน
// รองรับทั้งเมาส์ (desktop) และนิ้ว (แท็บเล็ต/มือถือ) เพราะใช้ Pointer Events
function useDragReorder<T extends { id: string }>(
  list: T[],
  onCommit: (orderedIds: string[]) => void
) {
  const [order, setOrder] = useState<string[]>(list.map((i) => i.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const orderRef = useRef(order);
  orderRef.current = order;

  // sync เมื่อรายการจาก Firestore เปลี่ยน (แต่ไม่ทับระหว่างลากอยู่)
  useEffect(() => {
    if (dragId) return;
    setOrder(list.map((i) => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((i) => i.id).join("|")]);

  useEffect(() => {
    if (!dragId) return;

    const handleMove = (e: PointerEvent) => {
      const current = orderRef.current;
      const draggedIdx = current.indexOf(dragId);
      if (draggedIdx === -1) return;
      let targetIdx = draggedIdx;
      for (let i = 0; i < current.length; i++) {
        if (current[i] === dragId) continue;
        const el = itemRefs.current[current[i]];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          targetIdx = i < draggedIdx ? i : i - 1;
          break;
        }
        targetIdx = i;
      }
      if (targetIdx !== draggedIdx) {
        const next = [...current];
        next.splice(draggedIdx, 1);
        next.splice(targetIdx, 0, dragId);
        setOrder(next);
      }
    };

    const handleUp = () => {
      setDragId(null);
      document.body.style.userSelect = "";
      onCommit(orderRef.current);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  const orderedList = order
    .map((id) => list.find((i) => i.id === id))
    .filter((i): i is T => !!i);

  const startDrag = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    document.body.style.userSelect = "none";
    setDragId(id);
  };

  const setItemRef = (id: string) => (el: HTMLDivElement | null) => {
    itemRefs.current[id] = el;
  };

  return { orderedList, dragId, startDrag, setItemRef };
}

interface StaffMenuProps {
  lang: Language;
  items: (MenuItem & { active?: boolean })[];
  onAdd: () => void;
  onEdit: (item: MenuItem) => void;
  onSetAvailability: (item: MenuItem, availability: MenuAvailability) => void;
  // ปุ่มเปิด/ปิดด่วนของตัวเลือก (กลุ่มที่ติ๊ก "แสดงในหน้าจัดการเมนู") — items ที่ส่งมาต้องผ่าน normalizeMenuItem แล้ว
  onSetChoiceClosed: (item: MenuItem, groupId: string, choiceId: string, closed: boolean) => void;
  onDelete: (itemId: string) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void, labels?: { confirmLabel?: string; cancelLabel?: string }) => void;
  categories: Category[];
  onAddCategory: (nameEn: string, nameTh: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onToggleRecommended: (item: MenuItem) => void;
  onReorderRecommended: (orderedIds: string[]) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onReorderMenuItems: (categoryId: string, orderedIds: string[]) => void;
  scrollTopRef: React.MutableRefObject<number>;
  stockMap: Map<string, StockEntry>;
  stockEnabled: boolean;
  onSetStockEnabled: (enabled: boolean) => void; // App ถามยืนยันก่อน
  // แท็บ "ของเตรียม" (ดู StaffPrepPanel / prep.ts)
  prepMap: Map<string, PrepEntry>;
  onSavePrep: (prepId: string | null, form: PrepFormValue, links: PrepLinks) => Promise<void>;
  onAdjustPrep: (prepId: string, delta: 1 | -1) => void;
  onSetPrepRemaining: (prepId: string, remaining: number | null) => Promise<void>;
  onDeletePrep: (prepId: string) => void;
}

// แท็บที่เปิดค้างไว้ — จำข้ามการเข้าไปแก้เมนูแล้วกลับมา (คอมโพเนนต์ถูก mount ใหม่)
let lastSection: "menu" | "prep" = "menu";

export function StaffMenuScreen({
  lang, items, onAdd, onEdit, onSetAvailability, onSetChoiceClosed, onDelete, onTabChange, onLogout, onLangToggle, onAskConfirm, categories, onAddCategory, onDeleteCategory, onToggleRecommended, onReorderRecommended, onReorderCategories, onReorderMenuItems,
  scrollTopRef, stockMap, stockEnabled, onSetStockEnabled, prepMap, onSavePrep, onAdjustPrep, onSetPrepRemaining, onDeletePrep,
}: StaffMenuProps) {
  const t = T[lang];
  const [section, setSectionState] = useState<"menu" | "prep">(lastSection);
  const setSection = (next: "menu" | "prep") => { lastSection = next; setSectionState(next); };
  const [newCatEn, setNewCatEn] = useState("");
  const [newCatTh, setNewCatTh] = useState("");

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const catDrag = useDragReorder(sortedCategories, (orderedIds) => onReorderCategories(orderedIds));
  // ลำดับเดียวกับแถบ "แนะนำ" ในหน้าสั่ง — เมนูที่ซ่อนอยู่ยังแสดง (จางๆ) ให้พนักงานเห็นว่ายังติดดาวอยู่
  const recommendedItems = items
    .filter((i) => i.recommended)
    .sort((a, b) => (a.recommendedOrder ?? 999999) - (b.recommendedOrder ?? 999999) || a.name.en.localeCompare(b.name.en));
  const recDrag = useDragReorder(recommendedItems, (orderedIds) => onReorderRecommended(orderedIds));

  useEffect(() => {
    const handleScroll = () => { scrollTopRef.current = window.scrollY; };
    window.addEventListener("scroll", handleScroll);

    // รอให้เนื้อหา (รูปภาพ ฯลฯ) เรนเดอร์จนได้ความสูงจริงก่อนค่อยเลื่อนกลับ
    const id = requestAnimationFrame(() => {
      window.scrollTo(0, scrollTopRef.current);
    });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(id);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="menu" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex gap-1 bg-muted p-1 rounded-2xl mb-4" role="tablist">
          {([
            ["menu", lang === "en" ? "Menu" : "เมนู"],
            ["prep", lang === "en" ? `Prepared items${prepMap.size ? ` (${prepMap.size})` : ""}` : `ของเตรียม${prepMap.size ? ` (${prepMap.size})` : ""}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={section === key}
              onClick={() => setSection(key)}
              className={`flex-1 min-h-[40px] rounded-xl text-sm font-semibold transition-colors ${section === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {section === "menu" && (
        <button
          onClick={onAdd}
          className="w-full mb-4 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          {lang === "en" ? "Add New Item" : "เพิ่มเมนูใหม่"}
        </button>
        )}

        {/* สวิตช์ระบบสต็อกทั้งร้าน — ตั้งจำนวนสต็อกที่หน้าแก้เมนู (เว้นว่าง = ไม่จำกัด) */}
        <div className="bg-card border border-border rounded-xl p-3 mb-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground text-sm">{lang === "en" ? "Stock system" : "ระบบสต็อก"}</div>
            <div className="text-[11px] text-muted-foreground">
              {stockEnabled
                ? (lang === "en" ? `On · ${stockMap.size} item(s) with stock set` : `เปิดอยู่ · ตั้งสต็อกไว้ ${stockMap.size} เมนู`)
                : (lang === "en" ? "Off · orders don't take from stock" : "ปิดอยู่ · ออเดอร์ไม่ตัดสต็อก")}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={stockEnabled}
            onClick={() => onSetStockEnabled(!stockEnabled)}
            className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${stockEnabled ? "bg-secondary" : "bg-muted"}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${stockEnabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {section === "prep" && (
          <StaffPrepPanel
            lang={lang}
            preps={prepMap}
            items={items}
            categories={sortedCategories}
            stockEnabled={stockEnabled}
            onSave={onSavePrep}
            onAdjust={onAdjustPrep}
            onSetRemaining={onSetPrepRemaining}
            onDelete={onDeletePrep}
            onAskConfirm={onAskConfirm}
          />
        )}

        {section === "menu" && (<>
        {/* เมนูแนะนำ (แถบแรกของหน้าสั่ง) — ติดดาวที่เมนูด้านล่าง แล้วลาก Grip เรียงลำดับตรงนี้ */}
        <div className="bg-card border border-border rounded-xl p-3 mb-4">
          <h3 className="font-semibold text-foreground text-sm mb-1 flex items-center gap-1.5">
            <Star size={14} className="text-primary" fill="currentColor" />
            {lang === "en" ? "Recommended" : "เมนูแนะนำ"}
          </h3>
          {recDrag.orderedList.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {lang === "en"
                ? "Tap ☆ on a menu item below to add it. No items = the Recommended tab is hidden."
                : "แตะ ☆ ที่เมนูด้านล่างเพื่อเพิ่ม — ยังไม่มีเมนูแนะนำ ลูกค้าจะไม่เห็นแถบนี้"}
            </p>
          ) : (
            <div className="space-y-1.5 mt-2">
              {recDrag.orderedList.map((item) => (
                <div
                  key={item.id}
                  ref={recDrag.setItemRef(item.id)}
                  className={`flex items-center gap-2 bg-background rounded-lg px-3 py-2 transition-shadow ${item.active === false ? "opacity-50" : ""
                    } ${recDrag.dragId === item.id ? "shadow-lg ring-2 ring-primary/40 relative z-10" : ""}`}
                  style={{ touchAction: recDrag.dragId ? "none" : undefined }}
                >
                  <button
                    onPointerDown={recDrag.startDrag(item.id)}
                    className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                    aria-label={lang === "en" ? "Drag to reorder" : "ลากเพื่อเรียงลำดับ"}
                  >
                    <GripVertical size={16} />
                  </button>
                  <span className="flex-1 min-w-0 text-sm text-foreground truncate">
                    {lang === "en" ? item.name.en : item.name.th}
                  </span>
                  <RecommendedStar lang={lang} on onClick={() => onToggleRecommended(item)} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category management */}
        <div className="bg-card border border-border rounded-xl p-3 mb-6">
          <h3 className="font-semibold text-foreground text-sm mb-2.5">
            {lang === "en" ? "Categories" : "จัดการหมวดหมู่"}
          </h3>
          <div className="space-y-1.5 mb-3">
            {catDrag.orderedList.map((cat) => (
              <div
                key={cat.id}
                ref={catDrag.setItemRef(cat.id)}
                className={`flex items-center gap-2 bg-background rounded-lg px-3 py-2 transition-shadow ${catDrag.dragId === cat.id ? "shadow-lg ring-2 ring-primary/40 relative z-10" : ""
                  }`}
                style={{ touchAction: catDrag.dragId ? "none" : undefined }}
              >
                <button
                  onPointerDown={catDrag.startDrag(cat.id)}
                  className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                  aria-label={lang === "en" ? "Drag to reorder" : "ลากเพื่อเรียงลำดับ"}
                >
                  <GripVertical size={16} />
                </button>
                <span className="flex-1 text-sm text-foreground">
                  {lang === "en" ? cat.nameEn : cat.nameTh}
                </span>
                <button
                  onClick={() =>
                    onAskConfirm(
                      lang === "en"
                        ? "Delete category? Items inside will be hidden from customer menu."
                        : "ลบหมวดหมู่นี้? เมนูในหมวดจะไม่แสดงในเมนูลูกค้าอีก",
                      () => onDeleteCategory(cat.id)
                    )
                  }
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newCatEn}
              onChange={(e) => setNewCatEn(e.target.value)}
              placeholder="Category (EN)"
              className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary"
            />
            <input
              value={newCatTh}
              onChange={(e) => setNewCatTh(e.target.value)}
              placeholder="หมวดหมู่ (TH)"
              className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary"
            />
            <button
              onClick={() => {
                if (newCatEn.trim() && newCatTh.trim()) {
                  onAddCategory(newCatEn.trim(), newCatTh.trim());
                  setNewCatEn("");
                  setNewCatTh("");
                }
              }}
              className="bg-primary text-primary-foreground px-3 rounded-lg text-xs font-semibold flex-shrink-0"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {sortedCategories.map((cat) => {
          const catItems = items
            .filter((i) => i.categoryId === cat.id)
            .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999) || a.name.en.localeCompare(b.name.en));
          if (catItems.length === 0) return null;
          return (
            <CategoryMenuItemsList
              key={cat.id}
              lang={lang}
              t={t}
              cat={cat}
              catItems={catItems}
              onReorderMenuItems={onReorderMenuItems}
              onToggleRecommended={onToggleRecommended}
              onSetAvailability={onSetAvailability}
              onSetChoiceClosed={onSetChoiceClosed}
              onEdit={onEdit}
              onDelete={onDelete}
              onAskConfirm={onAskConfirm}
              stockMap={stockMap}
              prepMap={prepMap}
              stockEnabled={stockEnabled}
            />
          );
        })}
        </>)}
      </div>
    </div>
  );
}

const AVAILABILITY_OPTIONS: { value: MenuAvailability; th: string; en: string; selectedClass: string }[] = [
  { value: "available", th: "ขาย", en: "On", selectedClass: "bg-secondary text-secondary-foreground shadow-sm" },
  { value: "soldOut", th: "หมด", en: "Sold out", selectedClass: "bg-primary text-primary-foreground shadow-sm" },
  { value: "hidden", th: "ซ่อน", en: "Hidden", selectedClass: "bg-[#3C2414]/70 text-[#FFF8F0] shadow-sm" },
];

// ป้ายสต็อกใต้ราคา (เฉพาะเมนูที่ตั้งจำนวนไว้) — ส้ม = ใกล้หมด (≤ ที่ตั้งเตือน) / แดง = หมดหรือติดลบ / เทา = ระบบสต็อกปิด
function StockBadge({ lang, entry, enabled }: { lang: Language; entry?: StockEntry; enabled: boolean }) {
  if (!entry) return null;
  const level = stockLevel(entry);
  const cls = !enabled
    ? "bg-muted text-muted-foreground"
    : level === "negative" || level === "out"
      ? "bg-destructive text-destructive-foreground"
      : level === "low"
        ? "bg-[#D07E35] text-white"
        : "bg-secondary/15 text-secondary";
  return (
    <span className={`px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums ${cls}`}>
      {lang === "en" ? `${entry.remaining} left` : `เหลือ ${entry.remaining}`}
    </span>
  );
}

// ป้ายของเตรียมที่เมนูนี้ผูกไว้ ทั้งเมนูและตัวเลือก (ชื่อ + จำนวน) — แดง = หมด / ส้ม = ใกล้หมด
function PrepBadges({ lang, prepIds, prepMap, enabled }: { lang: Language; prepIds?: string[]; prepMap: Map<string, PrepEntry>; enabled: boolean }) {
  return (
    <>
      {(prepIds ?? []).map((id) => {
        const p = prepMap.get(id);
        if (!p) return null;
        const level = p.remaining === undefined ? "ok" : stockLevel({ remaining: p.remaining, alertAt: p.alertAt });
        const cls = !enabled || p.remaining === undefined
          ? "bg-muted text-muted-foreground"
          : prepIsOut(p)
            ? "bg-destructive text-destructive-foreground"
            : level === "low"
              ? "bg-[#D07E35] text-white"
              : "bg-secondary/15 text-secondary";
        return (
          <span key={id} className={`px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums ${cls}`}>
            {p.name} {p.remaining ?? (lang === "en" ? "∞" : "ไม่จำกัด")}
          </span>
        );
      })}
    </>
  );
}

// ดาว = อยู่ในแถบ "แนะนำ" — แตะครั้งเดียวสลับ บันทึกทันที (ใช้ทั้งในกล่องเมนูแนะนำและแถวเมนูในหมวด)
function RecommendedStar({ lang, on, onClick }: { lang: Language; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={lang === "en" ? (on ? "Remove from Recommended" : "Add to Recommended") : (on ? "เอาออกจากเมนูแนะนำ" : "เพิ่มในเมนูแนะนำ")}
      className={`p-1 -m-1 flex-shrink-0 transition-colors active:scale-90 ${on ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
    >
      <Star size={18} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

// รายการเมนูภายในหมวดหมู่เดียว แยกเป็นคอมโพเนนต์ต่างหาก
// เพื่อให้เรียก useDragReorder ได้อย่างถูกต้องตาม Rules of Hooks (1 instance ต่อ 1 หมวดหมู่)
function CategoryMenuItemsList({
  lang, t, cat, catItems, onReorderMenuItems, onToggleRecommended, onSetAvailability, onSetChoiceClosed, onEdit, onDelete, onAskConfirm,
  stockMap, prepMap, stockEnabled,
}: {
  lang: Language;
  t: (typeof T)["en"];
  cat: Category;
  catItems: (MenuItem & { active?: boolean })[];
  onReorderMenuItems: (categoryId: string, orderedIds: string[]) => void;
  onToggleRecommended: (item: MenuItem) => void;
  onSetAvailability: (item: MenuItem, availability: MenuAvailability) => void;
  // ปุ่มเปิด/ปิดด่วนของตัวเลือก (กลุ่มที่ติ๊ก "แสดงในหน้าจัดการเมนู") — items ที่ส่งมาต้องผ่าน normalizeMenuItem แล้ว
  onSetChoiceClosed: (item: MenuItem, groupId: string, choiceId: string, closed: boolean) => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (itemId: string) => void;
  onAskConfirm: (message: string, onConfirm: () => void, labels?: { confirmLabel?: string; cancelLabel?: string }) => void;
  stockMap: Map<string, StockEntry>;
  prepMap: Map<string, PrepEntry>;
  stockEnabled: boolean;
}) {
  const itemDrag = useDragReorder(catItems, (orderedIds) => onReorderMenuItems(cat.id, orderedIds));

  return (
    <div className="mb-6">
      <h3 className="font-semibold text-foreground text-sm mb-2">
        {lang === "en" ? cat.nameEn : cat.nameTh}
      </h3>
      <div className="space-y-2">
        {itemDrag.orderedList.map((item) => {
          const quickGroups = (item.customGroups || []).filter((g) => isQuickToggleGroup(g) && g.choices.length > 0);
          // ปุ่ม ขาย/หมด/ซ่อน แสดงค่าที่ "ตั้งไว้" — กลุ่มที่ต้องเลือกถูกปิดหมดทุกตัวทำให้ลูกค้าเห็นว่าหมดก็จริง แต่ไม่เปลี่ยนปุ่ม
          // (คิดตอนแสดงผล ไม่เขียน DB) แค่บอกเหตุผลไว้ใต้ปุ่มด่วนแทน เปิดตัวเลือกกลับมา เมนูก็กลับมาขายเอง
          const setting = menuAvailabilitySetting(item);
          const choicesOut = setting === "available" && requiredGroupAllClosed(item);
          return (
          <div
            key={item.id}
            ref={itemDrag.setItemRef(item.id)}
            className={`bg-card rounded-xl border border-border p-3 flex flex-wrap items-center gap-x-3 gap-y-2 transition-shadow ${item.active === false ? "opacity-50" : ""
              } ${itemDrag.dragId === item.id ? "shadow-lg ring-2 ring-primary/40 relative z-10" : ""}`}
            style={{ touchAction: itemDrag.dragId ? "none" : undefined }}
          >
            <button
              onPointerDown={itemDrag.startDrag(item.id)}
              className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
              aria-label={lang === "en" ? "Drag to reorder" : "ลากเพื่อเรียงลำดับ"}
            >
              <GripVertical size={16} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground text-sm truncate">
                {lang === "en" ? item.name.en : item.name.th}
              </div>
              <div className="text-muted-foreground text-xs flex items-center gap-1.5 flex-wrap">
                <span>{t.thb}{item.price}</span>
                <StockBadge lang={lang} entry={stockMap.get(item.id)} enabled={stockEnabled} />
                <PrepBadges lang={lang} prepIds={allPrepLinks(item)} prepMap={prepMap} enabled={stockEnabled} />
              </div>
            </div>
            <RecommendedStar lang={lang} on={!!item.recommended} onClick={() => onToggleRecommended(item)} />
            {/* สลับสถานะการขายกดครั้งเดียว: ขาย (เขียว) / หมด (ส้ม — ลูกค้ายังเห็นแต่กดสั่งไม่ได้) / ซ่อน (เทา — หายจากหน้าสั่ง) */}
            <div className="flex flex-shrink-0 rounded-full bg-muted p-0.5" role="radiogroup">
              {AVAILABILITY_OPTIONS.map((opt) => {
                const selected = setting === opt.value;
                return (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => { if (!selected) onSetAvailability(item, opt.value); }}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${selected ? opt.selectedClass : "text-muted-foreground"}`}
                  >
                    {lang === "en" ? opt.en : opt.th}
                  </button>
                );
              })}
            </div>
            <button onClick={() => onEdit(item)} className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
              <Utensils size={16} />
            </button>
            <button
              onClick={() =>
                onAskConfirm(
                  lang === "en" ? `Delete menu item ${item.name.en || item.name.th}?` : `ลบเมนู ${item.name.th} ใช่ไหม?`,
                  () => onDelete(item.id),
                  { confirmLabel: lang === "en" ? "Delete" : "ลบ", cancelLabel: lang === "en" ? "No" : "ไม่" },
                )
              }
              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
            >
              <Trash2 size={16} />
            </button>
            {/* ปุ่มเปิด/ปิดด่วน: แถวละกลุ่ม (เฉพาะกลุ่มที่ติ๊ก "แสดงในหน้าจัดการเมนู") — แตะครั้งเดียวสลับ เปิด/ปิด บันทึกทันที */}
            {quickGroups.map((g) => (
              <div key={g.id} className="basis-full flex flex-wrap items-center gap-1.5 pl-7">
                <span className="text-[11px] text-muted-foreground mr-0.5">{(lang === "en" ? g.nameEn || g.nameTh : g.nameTh || g.nameEn)}:</span>
                {g.choices.map((c) => {
                  const closed = isChoiceClosed(c);
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSetChoiceClosed(item, g.id, c.id, !closed)}
                      aria-pressed={closed}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors active:scale-95 ${closed
                        ? "bg-primary/10 border-primary/50 text-primary"
                        : "bg-secondary/10 border-secondary/30 text-secondary"
                        }`}
                    >
                      <span className={closed ? "line-through" : ""}>{(lang === "en" ? c.labelEn || c.labelTh : c.labelTh || c.labelEn) || "—"}</span>
                      {closed && <span className="ml-1 no-underline">{lang === "en" ? "out" : "หมด"}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {/* อยู่แถวเต็มความกว้าง ไม่ใช่ใต้ชื่อ — คอลัมน์ชื่อแคบมากบนมือถือ */}
            {setting === "soldOut" && item.soldOutByPrep && (
              <div className="basis-full pl-7 text-[11px] font-medium text-primary">
                {lang === "en" ? "Sold out because a prepared item ran out — reopens when you add more" : "หมดเพราะของเตรียมหมด — เติมของเตรียมแล้วกลับมาขายเอง"}
              </div>
            )}
            {choicesOut && (
              <div className="basis-full pl-7 text-[11px] font-medium text-primary">
                {lang === "en" ? "A required option is all off — customers see Sold out" : "ตัวเลือกที่ต้องเลือกปิดหมดทุกตัว ลูกค้าเห็นว่าหมด"}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
