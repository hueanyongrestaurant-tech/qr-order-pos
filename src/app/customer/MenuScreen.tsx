import { useState, useEffect } from "react";
import { ChevronLeft, Flame, ShoppingCart, Star, Utensils, X } from "lucide-react";
import type { Category, CartItem, Language, MenuItem } from "../types";
import { T } from "../translations";
import { cartTotal, resolvePhoto } from "../utils";
import { LannaBorder, RestaurantLogo } from "../shared";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";

function OnboardingModal({ lang, onClose }: { lang: Language; onClose: () => void }) {
  const steps =
    lang === "en"
      ? [
        { emoji: "👋", text: "Welcome! Here's how ordering works" },
        { emoji: "🍽️", text: "Browse the menu and pick what you like" },
        { emoji: "🛒", text: "Add items to your cart, then confirm your order" },
        { emoji: "👨‍🍳", text: "Sit back while the kitchen gets cooking" },
        { emoji: "😋", text: "Enjoy your meal!" },
        { emoji: "💳", text: "Pay at the counter when you're done" },
      ]
      : [
        { emoji: "👋", text: "ยินดีต้อนรับค่ะ มาดูวิธีสั่งอาหารกันก่อนนะคะ" },
        { emoji: "🍽️", text: "เลือกเมนูที่ถูกใจจากหน้าเมนูได้เลยค่ะ" },
        { emoji: "🛒", text: "ใส่ตะกร้าแล้วกดยืนยันสั่งอาหารได้เลยค่ะ" },
        { emoji: "👨‍🍳", text: "รอสักครู่นะคะ ครัวกำลังปรุงอาหารให้อยู่ค่ะ" },
        { emoji: "😋", text: "ทานให้อร่อยค่ะ" },
        { emoji: "💳", text: "เสร็จแล้วชำระเงินที่เคาน์เตอร์ได้เลยค่ะ" },
      ];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center px-6"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-3xl p-6 max-w-sm w-full border border-border shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={20} />
        </button>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">
          {lang === "en" ? "How it works" : "วิธีสั่งอาหาร"}
        </p>

        <div>
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center flex-shrink-0">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex-shrink-0">
                  {i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span className="w-px h-full bg-border my-1" />
                )}
              </div>
              <p className="text-foreground text-sm leading-relaxed pt-1.5 pb-4">
                <span className="mr-1">{s.emoji}</span>
                {s.text}
              </p>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-1 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95"
        >
          {lang === "en" ? "Order Now" : "สั่งอาหาร"}
        </button>
      </div>
    </div>
  );
}

// ─── Menu Screen ──────────────────────────────────────────────────────────────

interface MenuProps {
  lang: Language;
  tableNumber: string;
  cart: CartItem[];
  menuItems: MenuItem[];
  activeCategory: string;
  onCategoryChange: (id: string) => void;
  onItemClick: (item: MenuItem) => void;
  onViewCart: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean;
  categories: Category[];
  isBusy?: boolean;
  onExit?: () => void;
}

export function MenuScreen({
  lang, tableNumber, cart, menuItems, categories, activeCategory,
  onCategoryChange, onItemClick, onViewCart, onLangToggle, isTakeaway, isBusy, onExit
}: MenuProps) {
  const t = T[lang];
  const [busyDismissed, setBusyDismissed] = useState(false);
  useEffect(() => {
    if (isBusy) setBusyDismissed(false);
  }, [isBusy]);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const dismissOnboarding = () => setShowOnboarding(false);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);
  const cartSum = cartTotal(cart);
  const filtered = menuItems
    .filter((item) => item.categoryId === activeCategory)
    .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999) || a.name.en.localeCompare(b.name.en));

  return (
    <>
      {showOnboarding && <OnboardingModal lang={lang} onClose={dismissOnboarding} />}
      <div className="min-h-screen bg-background flex flex-col">
        {/* Sticky header */}
        <header className="sticky top-0 z-50 bg-[#3C2414] shadow-xl">
          <LannaBorder />
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-1">
              {onExit && (
                <button onClick={onExit} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors mr-1">
                  <ChevronLeft size={22} />
                </button>
              )}
              <RestaurantLogo dark lang={lang} />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#4A6741] px-2.5 py-1 rounded-full">
                <Utensils size={11} className="text-[#FFF8F0]" />
                <span className="text-[#FFF8F0] text-xs font-medium">
                  {isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`}
                </span></div>
              <button
                onClick={onLangToggle}
                className="text-[#D07E35] text-[11px] font-semibold px-2 py-1 hover:text-[#FFF8F0] transition-colors"
              >
                {t.langSwitch}
              </button>
              <button onClick={onViewCart} className="relative p-1.5 text-[#FFF8F0] hover:text-[#D07E35] transition-colors">
                <ShoppingCart size={22} />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded-full flex items-center justify-center font-bold px-0.5">
                    {cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Category tabs */}
          <div
            className="flex overflow-x-auto px-4 pb-3 gap-2 pt-1"
            style={{ scrollbarWidth: "none" }}
          >
            {[...categories].sort((a, b) => a.order - b.order).map((cat) => (
              <button
                key={cat.id}
                onClick={() => onCategoryChange(cat.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${activeCategory === cat.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/10 text-[#E6D5BA] hover:bg-white/20"
                  }`}
              >
                <span>{lang === "en" ? cat.nameEn : cat.nameTh}</span>
                {cat.signature && <span className="text-[9px] opacity-70">★</span>}
              </button>
            ))}
          </div>
        </header>

        {isBusy && !busyDismissed && (
          <div className="mx-4 mt-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <Flame size={16} className="text-primary flex-shrink-0 mt-0.5" />
            <p className="flex-1 text-sm text-foreground leading-relaxed">{t.busyBanner}</p>
            <button onClick={() => setBusyDismissed(true)} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Menu grid */}
        <div className="flex-1 px-4 py-4 pb-32">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => onItemClick(item)}
                className="bg-card rounded-2xl overflow-hidden text-left border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-150 active:scale-95 group"
              >
                {item.photo && (
                  <div className="aspect-[4/3] relative bg-muted overflow-hidden">
                    <ImageWithFallback
                      src={resolvePhoto(item.photo, 400, 300)}
                      alt={lang === "en" ? item.name.en : item.name.th}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {(item.popular || categories.find((c) => c.id === item.categoryId)?.signature) && (
                      <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Star size={8} fill="currentColor" />
                        {t.popular}
                      </div>
                    )}
                  </div>
                )}
                <div className="p-2.5">
                  {!item.photo && (item.popular || categories.find((c) => c.id === item.categoryId)?.signature) && (
                    <div className="inline-flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full mb-1.5">
                      <Star size={8} fill="currentColor" />
                      {t.popular}
                    </div>
                  )}
                  <div className="font-semibold text-foreground text-sm leading-snug">
                    {lang === "en" ? item.name.en : item.name.th}
                  </div>
                  <div className="text-muted-foreground text-[10px] mt-0.5 leading-snug">
                    {lang === "en" ? item.name.th : item.name.en}
                  </div>
                  <div className="mt-1.5 font-bold text-primary text-sm">
                    {t.thb}{item.price}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Floating cart bar */}
        {cartCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
            <button
              onClick={onViewCart}
              className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base flex items-center justify-between px-5 shadow-2xl hover:bg-primary/90 transition-all active:scale-95"
            >
              <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-bold">{cartCount}</span>
              <span>{t.viewCart}</span>
              <span className="font-bold">{t.thb}{cartSum}</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
