import { useState, useEffect, useRef } from "react";
import { GripVertical, Plus, Trash2, Utensils } from "lucide-react";
import type { Category, Language, MenuAvailability, MenuItem, StaffTab } from "../types";
import { allMeatsSoldOut, meatOptions, menuAvailabilitySetting, type MeatOption } from "../utils";
import { T } from "../translations";
import { StaffHeader } from "./StaffHeader";

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
  onToggleMeatSoldOut: (item: MenuItem, option: MeatOption) => void;
  onDelete: (itemId: string) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  categories: Category[];
  onAddCategory: (nameEn: string, nameTh: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onToggleCategorySignature: (categoryId: string, signature: boolean) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onReorderMenuItems: (categoryId: string, orderedIds: string[]) => void;
  scrollTopRef: React.MutableRefObject<number>;
}

export function StaffMenuScreen({
  lang, items, onAdd, onEdit, onSetAvailability, onToggleMeatSoldOut, onDelete, onTabChange, onLogout, onLangToggle, onAskConfirm, categories, onAddCategory, onDeleteCategory, onToggleCategorySignature, onReorderCategories, onReorderMenuItems,
  scrollTopRef,
}: StaffMenuProps) {
  const t = T[lang];
  const [newCatEn, setNewCatEn] = useState("");
  const [newCatTh, setNewCatTh] = useState("");

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const catDrag = useDragReorder(sortedCategories, (orderedIds) => onReorderCategories(orderedIds));

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
        <button
          onClick={onAdd}
          className="w-full mb-4 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          {lang === "en" ? "Add New Item" : "เพิ่มเมนูใหม่"}
        </button>

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
                  onClick={() => onToggleCategorySignature(cat.id, !cat.signature)}
                  className={`text-[10px] px-2 py-1 rounded-full font-medium flex-shrink-0 ${cat.signature ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                >
                  {t.popular}
                </button>
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
              onSetAvailability={onSetAvailability}
              onToggleMeatSoldOut={onToggleMeatSoldOut}
              onEdit={onEdit}
              onDelete={onDelete}
              onAskConfirm={onAskConfirm}
            />
          );
        })}
      </div>
    </div>
  );
}

const AVAILABILITY_OPTIONS: { value: MenuAvailability; th: string; en: string; selectedClass: string }[] = [
  { value: "available", th: "ขาย", en: "On", selectedClass: "bg-secondary text-secondary-foreground shadow-sm" },
  { value: "soldOut", th: "หมด", en: "Sold out", selectedClass: "bg-primary text-primary-foreground shadow-sm" },
  { value: "hidden", th: "ซ่อน", en: "Hidden", selectedClass: "bg-[#3C2414]/70 text-[#FFF8F0] shadow-sm" },
];

// รายการเมนูภายในหมวดหมู่เดียว แยกเป็นคอมโพเนนต์ต่างหาก
// เพื่อให้เรียก useDragReorder ได้อย่างถูกต้องตาม Rules of Hooks (1 instance ต่อ 1 หมวดหมู่)
function CategoryMenuItemsList({
  lang, t, cat, catItems, onReorderMenuItems, onSetAvailability, onToggleMeatSoldOut, onEdit, onDelete, onAskConfirm,
}: {
  lang: Language;
  t: (typeof T)["en"];
  cat: Category;
  catItems: (MenuItem & { active?: boolean })[];
  onReorderMenuItems: (categoryId: string, orderedIds: string[]) => void;
  onSetAvailability: (item: MenuItem, availability: MenuAvailability) => void;
  onToggleMeatSoldOut: (item: MenuItem, option: MeatOption) => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (itemId: string) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
}) {
  const itemDrag = useDragReorder(catItems, (orderedIds) => onReorderMenuItems(cat.id, orderedIds));

  return (
    <div className="mb-6">
      <h3 className="font-semibold text-foreground text-sm mb-2">
        {lang === "en" ? cat.nameEn : cat.nameTh}
      </h3>
      <div className="space-y-2">
        {itemDrag.orderedList.map((item) => {
          const meats = meatOptions(item);
          // ปุ่ม ขาย/หมด/ซ่อน แสดงค่าที่ "ตั้งไว้" — เนื้อหมดทุกตัวทำให้ลูกค้าเห็นว่าหมดก็จริง แต่ไม่เปลี่ยนปุ่ม
          // (คิดตอนแสดงผล ไม่เขียน DB) แค่บอกเหตุผลไว้ใต้ราคาแทน เปิดเนื้อกลับมาขาย เมนูก็กลับมาขายเอง
          const setting = menuAvailabilitySetting(item);
          const meatsOut = setting === "available" && allMeatsSoldOut(item);
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
              <div className="text-muted-foreground text-xs">{t.thb}{item.price}</div>
            </div>
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
                onAskConfirm(lang === "en" ? "Delete this item?" : "ลบเมนูนี้?", () => onDelete(item.id))
              }
              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
            >
              <Trash2 size={16} />
            </button>
            {/* ชิปตัวเลือกเนื้อสัตว์ (แสดงตลอด เฉพาะเมนูที่มี) — แตะครั้งเดียวสลับ ขาย/หมด บันทึกทันที
                ตัวเลือกที่ถูกซ่อนไว้ไม่แสดง (meatOptions กรองออกแล้ว) */}
            {meats.length > 0 && (
              <div className="basis-full flex flex-wrap items-center gap-1.5 pl-7">
                <span className="text-[11px] text-muted-foreground mr-0.5">{lang === "en" ? "Meat:" : "เนื้อ:"}</span>
                {meats.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => onToggleMeatSoldOut(item, o)}
                    aria-pressed={o.soldOut}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors active:scale-95 ${o.soldOut
                      ? "bg-primary/10 border-primary/50 text-primary"
                      : "bg-secondary/10 border-secondary/30 text-secondary"
                      }`}
                  >
                    <span className={o.soldOut ? "line-through" : ""}>{lang === "en" ? o.labelEn : o.labelTh}</span>
                    {o.soldOut && <span className="ml-1 no-underline">{lang === "en" ? "out" : "หมด"}</span>}
                  </button>
                ))}
                {/* อยู่แถวชิป (เต็มความกว้าง) ไม่ใช่ใต้ชื่อ — คอลัมน์ชื่อแคบมากบนมือถือ */}
                {meatsOut && (
                  <span className="text-[11px] font-medium text-primary ml-0.5">
                    {lang === "en" ? "· all out, shown as sold out" : "· เนื้อหมดทุกตัว ลูกค้าเห็นว่าหมด"}
                  </span>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
