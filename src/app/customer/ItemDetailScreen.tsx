import { useState } from "react";
import { Check, ChevronLeft, Flame, Minus, Plus, ShoppingCart, Star } from "lucide-react";
import type { CartItem, Language, MeatChoice, MenuItem, Portion, SpiceLevel } from "../types";
import { ADD_ONS } from "../constants";
import { T } from "../translations";
import { itemPrice, resolvePhoto, uid } from "../utils";

// ─── Item Detail Screen ───────────────────────────────────────────────────────

interface ItemDetailProps {
  lang: Language;
  tableNumber: string;
  item: MenuItem;
  cart: CartItem[];
  onBack: () => void;
  onAddToCart: (ci: CartItem) => void;
  onViewCart: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean
}

export function ItemDetailScreen({
  lang, tableNumber, item, cart, onBack, onAddToCart, onViewCart, onLangToggle, isTakeaway,
}: ItemDetailProps) {
  const t = T[lang];
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);
  const [meat, setMeat] = useState<MeatChoice>("chicken");
  const [portion, setPortion] = useState<Portion>("regular");
  const [spice, setSpice] = useState<SpiceLevel>(1);
  const [addEgg, setAddEgg] = useState(false);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [customSelections, setCustomSelections] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(1);

  const meats: MeatChoice[] = (["pork", "chicken", "beef"] as MeatChoice[]).filter((m) => !item.disabledMeats?.includes(m));
  const spiceLevels: SpiceLevel[] = [0, 1, 2, 3];
  const totalPrice = itemPrice(item, meat, portion, addEgg, selectedAddOns, customSelections) * quantity;

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

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const missingRequired = item.customGroups?.some(
    (g) => g.required && (customSelections[g.id] || []).length === 0
  );

  const handleAdd = () => {
    onAddToCart({
      cartId: uid(),
      item,
      meat: item.hasMeatChoice ? meat : undefined,
      portion: item.hasPortion ? portion : undefined,
      spiceLevel: item.hasSpice ? spice : 0,
      addEgg,
      addOns: selectedAddOns,
      customSelections,
      note: note.trim() || undefined,
      quantity,
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero photo */}
      <div className="relative h-[42vh] bg-muted flex-shrink-0 overflow-hidden">
        {item.photo && (
          <img
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

        {item.popular && (
          <div className="absolute top-4 left-16 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
            <Star size={10} fill="currentColor" /> {t.popular}
          </div>
        )}
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

        {/* Meat choice */}
        {item.hasMeatChoice && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">{t.meatChoice}</h3>
            <div className="flex gap-2">
              {meats.map((m) => (
                <button
                  key={m}
                  onClick={() => setMeat(m)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${meat === m
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                    }`}
                >
                  {T[lang].meats[m]}
                  {item.meatPriceDeltas?.[m] ? (
                    <span className="block text-[10px] opacity-70">+{t.thb}{item.meatPriceDeltas[m]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Spice level */}
        {item.hasSpice && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm flex items-center gap-1.5">
              <Flame size={15} className="text-primary" /> {t.spiceLevel}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {spiceLevels.map((level) => (
                <button
                  key={level}
                  onClick={() => setSpice(level)}
                  className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all text-center ${spice === level
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                    }`}
                >
                  {T[lang].spiceLevels[level]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Portion size */}
        {item.hasPortion && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">{t.portion}</h3>
            <div className="flex gap-2">
              {(["regular", "special"] as Portion[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPortion(p)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${portion === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                    }`}
                >
                  {p === "regular" ? t.regular : t.special}
                  {p === "special" && item.portionPriceDelta ? (
                    <span className="block text-[10px] opacity-70">+{t.thb}{item.portionPriceDelta}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add egg toggle */}
        {item.hasEggAddon !== false && (
          <div className="mb-5">
            <button
              onClick={() => setAddEgg(!addEgg)}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${addEgg
                ? "bg-primary/8 border-primary"
                : "bg-card border-border hover:border-primary/30"
                }`}
            >
              <div className="flex items-center gap-3">
                <div className="text-left">
                  <div className="font-semibold text-foreground text-sm">{t.addEgg}</div>
                  <div className="text-muted-foreground text-xs">{t.eggPrice}</div>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full relative transition-colors ${addEgg ? "bg-primary" : "bg-muted"}`}>
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${addEgg ? "left-[22px]" : "left-0.5"
                    }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Add-ons */}
        {item.hasPlainAddOns !== false && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">{t.addOns}</h3>
            <div className="space-y-2">
              {ADD_ONS.map((addon) => (
                <button
                  key={addon.id}
                  onClick={() => toggleAddOn(addon.id)}
                  className={`w-full flex items-center justify-between p-3.5 rounded-xl border-2 transition-all ${selectedAddOns.includes(addon.id)
                    ? "bg-primary/8 border-primary"
                    : "bg-card border-border hover:border-primary/30"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${selectedAddOns.includes(addon.id)
                        ? "bg-primary border-primary"
                        : "border-border"
                        }`}
                    >
                      {selectedAddOns.includes(addon.id) && (
                        <Check size={11} className="text-primary-foreground" />
                      )}
                    </div>
                    <span className="text-foreground text-sm font-medium">
                      {lang === "en" ? addon.label.en : addon.label.th}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {addon.price > 0 ? `+${t.thb}${addon.price}` : t.freeLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom option groups — สร้างเองจากหน้าจัดการเมนู */}
        {item.customGroups?.map((group) => (
          <div key={group.id} className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">
              {lang === "en" ? group.nameEn : group.nameTh}
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.choices.filter((c) => c.active !== false).map((choice) => {
                const selected = (customSelections[group.id] || []).includes(choice.id);
                return (
                  <button
                    key={choice.id}
                    onClick={() => toggleCustomChoice(group.id, choice.id, group.type)}
                    className={`px-3.5 py-2 rounded-xl text-sm font-medium border-2 transition-all ${selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:border-primary/40"
                      }`}
                  >
                    {lang === "en" ? choice.labelEn : choice.labelTh}
                    {choice.priceDelta ? (
                      <span className="ml-1 text-[10px] opacity-70">+{t.thb}{choice.priceDelta}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Note */}
        <div className="mb-5">
          <h3 className="font-semibold text-foreground mb-3 text-sm">
            {lang === "en" ? "Special Requests" : "หมายเหตุเพิ่มเติม"}
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
          disabled={missingRequired}
          className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base flex items-center justify-between px-5 shadow-2xl hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-bold">{quantity}</span>
          <span>{t.addToCart}</span>
          <span className="font-bold">{t.thb}{totalPrice}</span>
        </button>
      </div>
    </div>
  );
}
