import { ChevronLeft, Minus, Plus, ShoppingCart, X } from "lucide-react";
import type { CartItem, Language } from "../types";
import { ADD_ONS } from "../constants";
import { T } from "../translations";
import { cartItemTotal, cartTotal, resolvePhoto } from "../utils";
import { LannaBorder } from "../shared";

// ─── Cart Screen ──────────────────────────────────────────────────────────────

interface CartProps {
  lang: Language;
  tableNumber: string;
  cart: CartItem[];
  onBack: () => void;
  onUpdateQty: (cartId: string, qty: number) => void;
  onRemove: (cartId: string) => void;
  onConfirm: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean;
  submitting?: boolean;
}

export function CartScreen({ lang, tableNumber, cart, onBack, onUpdateQty, onRemove, onConfirm, onLangToggle, isTakeaway, submitting }: CartProps) {
  const t = T[lang];
  const total = cartTotal(cart);

  function optionSummary(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(T[lang].meats[ci.meat]);
    if (ci.portion === "special") parts.push(t.special);
    if (ci.item.hasSpice) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(t.eggAdded);
    (ci.addOns || []).forEach((id) => {
      const addon = ADD_ONS.find((a) => a.id === id);
      if (addon) parts.push(lang === "en" ? addon.label.en : addon.label.th);
    });
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(" · ");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-lg text-[#FFF8F0]">{t.cart}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onLangToggle}
              className="text-[#D07E35] text-xs font-semibold hover:text-[#FFF8F0] transition-colors"
            >
              {t.langSwitch}
            </button>
            <div className="bg-[#4A6741] px-2.5 py-1 rounded-full">
              <span className="text-[#FFF8F0] text-xs font-medium">
                {isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex-1 px-4 py-4 pb-36 overflow-y-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
              <ShoppingCart className="text-muted-foreground" size={34} />
            </div>
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">{t.emptyCart}</h2>
            <p className="text-muted-foreground text-sm mb-6">{t.emptyCartSub}</p>
            <button
              onClick={onBack}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-all"
            >
              {t.goToMenu}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((ci) => (
              <div key={ci.cartId} className="bg-card rounded-2xl p-4 border border-border">
                <div className="flex gap-3">
                  {ci.item.photo && (
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                      <img
                        src={resolvePhoto(ci.item.photo, 128, 128)}
                        alt={lang === "en" ? ci.item.name.en : ci.item.name.th}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-foreground text-sm leading-snug">
                        {lang === "en" ? ci.item.name.en : ci.item.name.th}
                      </div>
                      <button
                        onClick={() => onRemove(ci.cartId)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {optionSummary(ci) && (
                      <div className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
                        {optionSummary(ci)}
                      </div>
                    )}
                    {ci.note && (
                      <div className="text-muted-foreground text-xs mt-0.5 italic">"{ci.note}"</div>
                    )}
                    <div className="flex items-center justify-between mt-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onUpdateQty(ci.cartId, ci.quantity - 1)}
                          className="w-7 h-7 rounded-full bg-muted flex items-center justify-center hover:bg-primary/10 transition-all active:scale-90"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-sm font-bold w-5 text-center">{ci.quantity}</span>
                        <button
                          onClick={() => onUpdateQty(ci.cartId, ci.quantity + 1)}
                          className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all active:scale-90"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="font-bold text-primary">{t.thb}{cartItemTotal(ci)}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border px-4 pb-4 pt-3">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-foreground text-base">{t.total}</span>
            <span className="font-display font-bold text-2xl text-primary">{t.thb}{total}</span>
          </div>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className={`w-full bg-secondary text-secondary-foreground py-4 rounded-2xl font-semibold text-lg shadow-lg transition-all ${submitting ? "opacity-60 cursor-not-allowed" : "hover:bg-secondary/90 active:scale-95"
              }`}
          >
            {t.confirmOrder}
          </button>
        </div>
      )}
    </div>
  );
}
