import { useState } from "react";
import { ChevronLeft, Minus, Plus, ShoppingCart } from "lucide-react";
import type { CartItem, Language, MenuItem } from "../types";
import { T } from "../translations";
import { itemPrice, menuAvailability, resolvePhoto, uid } from "../utils";
import { isChoiceClosed, normalizeMenuItem } from "../menuOptions";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";

// ─── Item Detail Screen ───────────────────────────────────────────────────────

// ตัวเลือกที่ปิดอยู่ (ทุกกลุ่ม) — สีเทา ขอบประ กดไม่ได้
const SOLD_OUT_CHOICE_CLASS = "bg-muted border-dashed border-border text-muted-foreground opacity-60 cursor-not-allowed";

interface ItemDetailProps {
  lang: Language;
  tableNumber: string;
  item: MenuItem;
  cart: CartItem[];
  onBack: () => void;
  onAddToCart: (ci: CartItem) => void;
  onViewCart: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean;
  isStaffMode?: boolean; // true เฉพาะตอนพนักงานพิมพ์ออเดอร์แทนลูกค้า (manual order) — คุม custom add-on ห้ามให้ลูกค้าเห็น
}

export function ItemDetailScreen({
  lang, tableNumber, item: rawItem, cart, onBack, onAddToCart, onViewCart, onLangToggle, isTakeaway, isStaffMode,
}: ItemDetailProps) {
  const t = T[lang];
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);
  // ตัวเลือกทั้งหมดอยู่ใน customGroups (เมนูแบบเดิมแปลงให้ตรงนี้) — รายการที่ใส่ตะกร้าเก็บเมนูรูปใหม่นี้ไว้
  // ตั๋วครัว/ใบเสร็จ/สถิติ จึงเห็นตัวเลือกเหมือนกันหมด
  const item = normalizeMenuItem(rawItem);
  // ลูกค้าต้องเลือกเองทุกกลุ่ม — ไม่มีตัวเลือกเริ่มต้น
  const [customSelections, setCustomSelections] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [customAddOnPrice, setCustomAddOnPrice] = useState(0);
  const [quantity, setQuantity] = useState(1);

  const effectiveCustomAddOnPrice = isStaffMode ? customAddOnPrice : 0;
  const totalPrice = itemPrice(item, undefined, undefined, false, [], customSelections, effectiveCustomAddOnPrice) * quantity;

  const toggleCustomChoice = (groupId: string, choiceId: string, type: "single" | "multi") => {
    setCustomSelections((prev) => {
      const current = prev[groupId] || [];
      if (type === "single") {
        return { ...prev, [groupId]: current.includes(choiceId) ? [] : [choiceId] };
      }
      const next = current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId];
      return { ...prev, [groupId]: next };
    });
  };

  const missingRequired = item.customGroups?.some(
    (g) => g.required && (customSelections[g.id] || []).length === 0
  );
  // item เป็นข้อมูลสด (App ส่งจาก menuItems) — เมนูหรือเนื้อที่เลือกไว้อาจเพิ่งถูกกด "หมด" ระหว่างเปิดหน้านี้
  const soldOut = menuAvailability(item) !== "available";
  const selectedChoiceClosed = (item.customGroups || []).some((g) =>
    g.choices.some((c) => isChoiceClosed(c) && (customSelections[g.id] || []).includes(c.id)));

  const handleAdd = () => {
    onAddToCart({
      cartId: uid(),
      item,
      spiceLevel: 0,
      addEgg: false,
      addOns: [],
      customSelections,
      note: note.trim() || undefined,
      // customNote/customAddOnPrice เป็นของ staff mode เท่านั้น — กันไว้อีกชั้นไม่ให้หลุดไปแม้ isStaffMode จะ false
      customNote: isStaffMode ? (customNote.trim() || undefined) : undefined,
      customAddOnPrice: isStaffMode && customAddOnPrice > 0 ? customAddOnPrice : undefined,
      quantity,
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero photo */}
      <div className="relative h-[42vh] bg-muted flex-shrink-0 overflow-hidden">
        {item.photo && (
          <ImageWithFallback
            src={resolvePhoto(item.photo, 400, 300)}
            alt={lang === "en" ? item.name.en : item.name.th}
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />

        {/* Top controls */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 pt-safe">
          <button
            onClick={onBack}
            className="bg-black/40 backdrop-blur-sm text-white p-2.5 rounded-full hover:bg-black/60 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
              {isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`}
            </div>
            <button
              onClick={onLangToggle}
              className="bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full hover:bg-black/60 transition-colors"
            >
              {t.langSwitch}
            </button>
            <button
              onClick={onViewCart}
              className="relative bg-black/40 backdrop-blur-sm text-white p-2.5 rounded-full hover:bg-black/60 transition-colors"
            >
              <ShoppingCart size={18} />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] min-w-[16px] h-4 rounded-full flex items-center justify-center font-bold px-0.5">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-5 pt-3 pb-32"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Title & price */}
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex-1 mr-3">
            <h1 className="font-display text-2xl font-semibold text-foreground leading-tight">
              {lang === "en" ? item.name.en : item.name.th}
            </h1>
            <div className="text-muted-foreground text-sm mt-0.5">
              {lang === "en" ? item.name.th : item.name.en}
            </div>
          </div>
          <div className="font-display text-2xl font-bold text-primary flex-shrink-0">
            {t.thb}{item.price}
          </div>
        </div>

        <p className="text-foreground/75 text-sm leading-relaxed mb-5">
          {lang === "en" ? item.description.en : item.description.th}
        </p>

        <div className="h-px bg-border mb-5" />

        {/* Custom option groups — สร้างเองจากหน้าจัดการเมนู */}
        {item.customGroups?.map((group) => (
          <div key={group.id} className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">
              {lang === "en" ? group.nameEn : group.nameTh}
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.choices.map((choice) => {
                const selected = (customSelections[group.id] || []).includes(choice.id);
                // ปิด = ยังเห็นแต่เป็นสีเทา "หมด" เลือกไม่ได้ (ทุกกลุ่ม)
                const out = isChoiceClosed(choice);
                return (
                  <button
                    key={choice.id}
                    onClick={() => toggleCustomChoice(group.id, choice.id, group.type)}
                    disabled={out}
                    className={`px-3.5 py-2 rounded-xl text-sm font-medium border-2 transition-all ${out
                      ? SOLD_OUT_CHOICE_CLASS
                      : selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-foreground hover:border-primary/40"
                      }`}
                  >
                    {lang === "en" ? choice.labelEn : choice.labelTh}
                    {out ? (
                      <span className="ml-1 text-[10px] font-bold">{t.soldOut}</span>
                    ) : choice.priceDelta ? (
                      <span className="ml-1 text-[10px] opacity-70">+{t.thb}{choice.priceDelta}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Custom add-on — staff-only: พนักงานพิมพ์รายการ/ราคาที่ลูกค้าขอเพิ่มเอง (ไม่มีในเมนู) ต่อท้ายรายการนี้
            ห้ามแสดงตอนลูกค้าสแกนสั่งเอง (isStaffMode จะเป็น false เสมอในเคสนั้น) */}
        {isStaffMode && (
          <div className="mb-5 p-4 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/50 dark:bg-amber-950/20">
            <h3 className="font-semibold text-foreground mb-3 text-sm">
              {lang === "en" ? "Custom Add-on" : "Add-on"}
            </h3>
            <input
              type="text"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder={lang === "en" ? "Item name" : "ชื่อรายการ"}
              className="w-full bg-card border-2 border-border rounded-xl px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-all mb-2"
            />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">{t.thb}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={customAddOnPrice === 0 ? "" : customAddOnPrice}
                onChange={(e) => setCustomAddOnPrice(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
                className="flex-1 bg-card border-2 border-border rounded-xl px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-all"
              />
            </div>
          </div>
        )}

        {/* Note */}
        <div className="mb-5">
          <h3 className="font-semibold text-foreground mb-3 text-sm">
            {lang === "en" ? "Special Requests" : "หมายเหตุ"}
          </h3>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={lang === "en" ? "e.g. no cilantro, less oil..." : "เช่น ไม่ใส่ผักชี, น้ำมันน้อย..."}
            className="w-full bg-card border-2 border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-primary transition-all resize-none"
            rows={2}
          />
        </div>

        {/* Quantity */}
        <div className="mb-4">
          <h3 className="font-semibold text-foreground mb-3 text-sm">{t.quantity}</h3>
          <div className="flex items-center gap-5">
            <button
              onClick={() => quantity > 1 && setQuantity((q) => q - 1)}
              disabled={quantity <= 1}
              className="w-11 h-11 rounded-full bg-card border-2 border-border flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-all active:scale-90"
            >
              <Minus size={16} />
            </button>
            <span className="text-2xl font-bold text-foreground w-8 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all active:scale-90 shadow-md"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Add to cart bar */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
        <button
          onClick={handleAdd}
          disabled={missingRequired || soldOut || selectedChoiceClosed}
          className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base flex items-center justify-between px-5 shadow-2xl hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-bold">{quantity}</span>
          <span>{soldOut ? t.soldOut : t.addToCart}</span>
          <span className="font-bold">{t.thb}{totalPrice}</span>
        </button>
      </div>
    </div>
  );
}
