import { useState, useEffect, useRef } from "react";
import logo from "../assets/logo.png";
import logoImg from "../assets/logo-black.png";
import {
  ShoppingCart,
  ChevronLeft,
  Plus,
  Minus,
  X,
  Flame,
  Check,
  Eye,
  EyeOff,
  Leaf,
  CreditCard,
  LogOut,
  Star,
  Lock,
  Utensils,
  Clock,
  CheckCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Receipt,
  Printer,
  Pencil,
  Camera,
  Download,
  Loader2,
  ClipboardList,
  Ban,
  AlertTriangle,
} from "lucide-react";

import { toPng } from "html-to-image";
import { BarChart, Bar, XAxis, CartesianGrid } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./components/ui/chart";

import { db, getAuthInstance } from "../lib/firebase";
import { getSupabaseClient, MENU_PHOTOS_BUCKET } from "../lib/supabase";
import { collection, addDoc, setDoc, onSnapshot, query, orderBy, where, limit, getDocs, doc, updateDoc, deleteDoc, serverTimestamp, runTransaction, arrayUnion } from "firebase/firestore";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

import type {
  Language,
  View,
  StaffTab,
  MeatChoice,
  SpiceLevel,
  Portion,
  CustomChoice,
  CustomGroup,
  OrderStatus,
  PaymentMethod,
  ActivityAction,
  ActivityLog,
  MenuItem,
  CartItem,
  Order,
  ExpenseLineItem,
  ExpenseDay,
  ExpenseCatalogEntry,
  Category,
} from "./types";
import { ADD_ONS } from "./constants";
import { T } from "./translations";
import {
  resolvePhoto,
  itemPrice,
  cartItemUnitPrice,
  cartItemTotal,
  stripItemPhoto,
  liveItems,
  liveItemCount,
  cartTotal,
  orderTotal,
  cartItemKey,
  mergeIntoCart,
  formatOptionDetails,
  parseTableKey,
  compareTables,
  timeAgo,
  formatClock,
  mapOrderDoc,
  expenseCatalogId,
  uid,
  getTodayKey,
  compressImage,
} from "./utils";
import { LannaBorder, RestaurantLogo } from "./shared";
import { StaffLoginScreen } from "./staff/StaffLoginScreen";
import { StaffOrdersScreen } from "./staff/StaffOrdersScreen";
import { StaffPaymentScreen } from "./staff/StaffPaymentScreen";
import { StaffMenuScreen } from "./staff/StaffMenuScreen";
import { StaffManualTableScreen } from "./staff/StaffManualTableScreen";
import { StaffMenuEditScreen } from "./staff/StaffMenuEditScreen";
import { StaffHistoryScreen } from "./staff/StaffHistoryScreen";
import { StaffExpensesScreen } from "./staff/StaffExpensesScreen";
import { StaffStatsScreen } from "./staff/StaffStatsScreen";
import { StaffActivityScreen } from "./staff/StaffActivityScreen";

// แปลง data URL (base64 ที่ compressImage คืนมา) เป็น Blob — ใช้ตอนจะอัปโหลดขึ้น Storage จริง
// (ยังคง base64 ไว้เป็น local preview เหมือนเดิมตอนเลือกรูป แปลงเป็น Blob แค่ตอนกดบันทึก)
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

// ─── Activity Log helpers ─────────────────────────────────────────────────────

// เขียน 1 บรรทัดลง activityLogs — ตัด field ที่เป็น undefined ออกก่อน (Firestore ไม่รับ undefined)
async function logActivity(entry: Omit<ActivityLog, "id" | "createdAt">): Promise<void> {
  const clean: Record<string, any> = {};
  Object.entries(entry).forEach(([k, v]) => {
    if (v !== undefined) clean[k] = v;
  });
  try {
    await addDoc(collection(db, "activityLogs"), { ...clean, createdAt: serverTimestamp() });
  } catch (err) {
    // ไม่ให้ log ที่ล้มเหลวมาบล็อกงานหน้าร้าน แต่แจ้งไว้ใน console
    console.error("logActivity failed", err);
  }
}

// เพิ่มเหตุผลใหม่เข้า list ที่ใช้เลือกซ้ำได้ (ไม่ต้องมีหน้าจัดการแยก)
async function addVoidReason(reason: string): Promise<void> {
  const r = reason.trim();
  if (!r) return;
  try {
    await setDoc(doc(db, "voidReasons", "list"), { reasons: arrayUnion(r) }, { merge: true });
  } catch (err) {
    console.error("addVoidReason failed", err);
  }
}

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

function ConfirmModal({ message, onConfirm, onCancel, lang }: { message: string; onConfirm: () => void; onCancel: () => void; lang: Language }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm mb-5 leading-relaxed">{message}</p>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all"
          >
            {lang === "en" ? "Cancel" : "ยกเลิก"}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all"
          >
            {lang === "en" ? "Confirm" : "ยืนยัน"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reason Picker (บังคับกรอก/เลือกเหตุผลก่อน void / cancel) ──────────────────

interface ReasonPickerModalProps {
  title: string;
  reasons: string[];
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  lang: Language;
}

function ReasonPickerModal({ title, reasons, onConfirm, onCancel, lang }: ReasonPickerModalProps) {
  const [selected, setSelected] = useState<string>("");
  const [typed, setTyped] = useState<string>("");
  const reason = (typed.trim() || selected).trim();
  const canConfirm = reason.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center px-6" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm font-semibold mb-1">{title}</p>
        <p className="text-muted-foreground text-xs mb-4">
          {lang === "en" ? "Pick or type a reason — required" : "เลือกหรือพิมพ์เหตุผล — จำเป็นต้องกรอก"}
        </p>

        {reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {reasons.map((r) => (
              <button
                key={r}
                onClick={() => { setSelected(r); setTyped(""); }}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium border-2 transition-all ${
                  !typed.trim() && selected === r
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={lang === "en" ? "Other reason…" : "เหตุผลอื่น…"}
          className="w-full bg-background border-2 border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary mb-4"
        />

        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all"
          >
            {lang === "en" ? "Cancel" : "ยกเลิก"}
          </button>
          <button
            onClick={() => { if (canConfirm) onConfirm(reason); }}
            disabled={!canConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {lang === "en" ? "Confirm" : "ยืนยัน"}
          </button>
        </div>
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

function MenuScreen({
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
                    <img
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

function ItemDetailScreen({
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

function CartScreen({ lang, tableNumber, cart, onBack, onUpdateQty, onRemove, onConfirm, onLangToggle, isTakeaway, submitting }: CartProps) {
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

// ─── Order Sent Screen ────────────────────────────────────────────────────────

interface OrderSentProps {
  lang: Language;
  tableNumber: string;
  onOrderMore: () => void;
}

function LinkExpiredScreen({ lang }: { lang: Language }) {
  const t = T[lang];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <Clock className="text-destructive" size={44} />
      </div>
      <h1 className="font-display text-2xl font-semibold text-foreground mb-3">{t.linkExpired}</h1>
      <p className="text-muted-foreground text-base leading-relaxed max-w-xs">{t.linkExpiredMsg}</p>
    </div>
  );
}

function OrderSentScreen({ lang, tableNumber, onOrderMore }: OrderSentProps) {
  const t = T[lang];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center mb-6"
        style={{ background: "linear-gradient(135deg, #4A6741/20, #4A6741/5)" }}
      >
        <div className="w-28 h-28 rounded-full bg-secondary/15 flex items-center justify-center">
          <CheckCircle className="text-secondary" size={56} />
        </div>
      </div>

      <h1 className="font-display text-3xl font-semibold text-foreground mb-3">{t.orderSent}</h1>
      <p className="text-muted-foreground text-base leading-relaxed mb-6 max-w-xs">{t.orderSentMsg}</p>

      <div
        className="rounded-2xl px-6 py-3 mb-8 border"
        style={{
          background: "rgba(74, 103, 65, 0.08)",
          borderColor: "rgba(74, 103, 65, 0.25)",
        }}
      >
        <div className="text-secondary font-semibold text-sm">
          {t.tableLabel} {tableNumber}
        </div>
      </div>

      <div
        className="w-full max-w-xs h-px mb-8"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(60,36,20,0.15), transparent)",
        }}
      />

      <button
        onClick={onOrderMore}
        className="px-10 py-4 bg-primary text-primary-foreground rounded-2xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
      >
        {t.orderMore}
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function getTableFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("table");
    if (raw && /^[0-9]+-[0-9]+$/.test(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

// ─── หน้าจอค้าง / จำหน้าล่าสุดตอนรีเฟรช ────────────────────────────────────────
// ใช้ sessionStorage (อยู่แค่ในแท็บนี้ ไม่ตกค้างข้ามอุปกรณ์/ข้ามการสแกนใหม่)
// เพื่อจำว่าอยู่หน้าไหนอยู่ ตอนกด refresh จะได้ไม่กระเด้งกลับไปหน้าแรก

const STORAGE_PREFIX = "hyk-pos";

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}:${key}`);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}:${key}`);
    } else {
      sessionStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
    }
  } catch {
    // sessionStorage ใช้ไม่ได้ (โหมดส่วนตัว ฯลฯ) — ปล่อยผ่าน ไม่ทำให้แอปพัง
  }
}

// เฉพาะวิวเหล่านี้ที่ฝั่งลูกค้าจะถูกจำไว้ตอนรีเฟรช (ตัดพวกที่ sub-state เสี่ยงเกินไปออก)
const CUSTOMER_RESUMABLE_VIEWS: View[] = ["menu", "item-detail", "cart", "order-sent"];

// อายุ cache เมนู (categories+menuItems) ฝั่งลูกค้าใน sessionStorage — ดู effect ที่ใช้ค่านี้
const MENU_CACHE_TTL_MS = 3 * 60 * 1000;

const STAFF_TAB_VIEW: Record<StaffTab, View> = {
  orders: "staff-orders",
  payment: "staff-payment",
  menu: "staff-menu",
  history: "staff-history",
  stats: "staff-stats",
  expenses: "staff-expenses",
  activity: "staff-activity",
};
const STAFF_TABS: StaffTab[] = ["orders", "payment", "menu", "history", "expenses", "stats", "activity"];
function isStaffTab(v: unknown): v is StaffTab {
  return typeof v === "string" && (STAFF_TABS as string[]).includes(v);
}

export default function App() {
  const initialTableFromUrl = getTableFromUrl();
  // เชื่อ session ที่บันทึกไว้ได้ก็ต่อเมื่อเป็นโต๊ะเดียวกับที่บันทึกไว้เท่านั้น (กันเคสสแกนโต๊ะอื่นในแท็บเดิม)
  const savedCustomerTable = initialTableFromUrl ? readSession<string>("customerTable") : null;
  const isResumingCustomerSession = !!initialTableFromUrl && savedCustomerTable === initialTableFromUrl;

  const [lang, setLang] = useState<Language>("th");
  const [view, setView] = useState<View>(() => {
    if (!initialTableFromUrl) return "staff-login"; // ฝั่งพนักงาน: effect ของ onAuthStateChanged จะจัดหน้าที่ถูกต้องให้เอง
    if (isResumingCustomerSession) {
      const savedView = readSession<View>("customerView");
      if (savedView && CUSTOMER_RESUMABLE_VIEWS.includes(savedView)) return savedView;
    }
    return "menu";
  });
  const [tableNumber, setTableNumber] = useState<string | null>(() => initialTableFromUrl);

  // Customer state
  const [cart, setCart] = useState<CartItem[]>(() =>
    isResumingCustomerSession ? readSession<CartItem[]>("customerCart") || [] : []
  );
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");

  // Staff state
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [expenseDays, setExpenseDays] = useState<ExpenseDay[]>([]);
  const [expenseCatalog, setExpenseCatalog] = useState<ExpenseCatalogEntry[]>([]);
  const [voidReasons, setVoidReasons] = useState<string[]>([]);
  // ช่วงวันที่ของหน้า Expenses — ยกขึ้นมาไว้ที่ App เพื่อให้ listener ดึงเฉพาะช่วงที่กำลังดู
  // (handler เพิ่ม/แก้/ลบ ทำงานกับวันที่ในช่วงนี้เสมอ จึงมีข้อมูลครบ)
  const [expenseRangeStart, setExpenseRangeStart] = useState<string>(getTodayKey());
  const [expenseRangeEnd, setExpenseRangeEnd] = useState<string>(getTodayKey());

  const [allMenuItems, setAllMenuItems] = useState<(MenuItem & { active?: boolean })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [staffLoggedIn, setStaffLoggedIn] = useState(false);
  // ต่างจาก staffLoggedIn: latch เป็น true เมื่อ login สำเร็จครั้งแรก แล้วค้าง true จนกว่าจะ
  // กดปุ่ม logout จริงๆ — ไม่กลับเป็น false เวลา onAuthStateChanged fire null ชั่วคราว
  // (เช่นตอน Auth IndexedDB สะดุดเพราะเปิดหลายแท็บ) ใช้เป็น gate ของ Firestore listener ฝั่งพนักงาน
  // เพื่อไม่ให้ listener ถูก unsubscribe ทิ้งกลางคันแล้วข้อมูลหายทั้งที่ยัง login อยู่
  const [everAuthed, setEverAuthed] = useState(false);
  const allMenuItemsRef = useRef(allMenuItems);
  useEffect(() => {
    allMenuItemsRef.current = allMenuItems;
  }, [allMenuItems]);

  // ฝั่งพนักงาน (ไม่มี ?table=): realtime listener เดิม — เห็นการแก้ไขเมนูทันทีเสมอ
  useEffect(() => {
    if (getTableFromUrl() !== null) return; // ลูกค้า: ใช้ effect แยกด้านล่างที่มี cache แทน
    const unsubscribe = onSnapshot(query(collection(db, "categories"), orderBy("order", "asc")), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Category));
      setAllCategories(data);
      setCategories(data.filter((c) => c.active !== false));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (getTableFromUrl() !== null) return;
    const unsubscribe = onSnapshot(collection(db, "menuItems"), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem & { active?: boolean }));
      setAllMenuItems(data);
      setMenuItems(data.filter((m) => m.active !== false));
    });
    return () => unsubscribe();
  }, []);

  // ฝั่งลูกค้า (มี ?table=): cache categories+menuItems ใน sessionStorage แทน realtime listener
  // ลด Firestore reads ต่อการเปิด/รีเฟรชหน้าเมนู 1 ครั้ง (ก่อนหน้านี้ทุกครั้งที่เปิดหน้า = subscribe
  // ใหม่ = อ่านทุก document ใหม่หมด) — cache หมดอายุใน 3 นาที ถึงจะยิง Firestore ใหม่ 1 ครั้ง (ไม่ realtime)
  // แล้วอัปเดต cache ใหม่ ลูกค้าจึงเห็นการแก้ไขเมนูของ staff ช้าสุด 3 นาที ไม่ใช่ค้างตลอดไป
  useEffect(() => {
    if (getTableFromUrl() === null) return; // ฝั่งพนักงานไม่เกี่ยว ใช้ realtime listener ข้างบนแทน
    let cancelled = false;

    const cached = readSession<{
      categories: Category[];
      menuItems: (MenuItem & { active?: boolean })[];
      timestamp: number;
    }>("customerMenuCache");
    if (cached && Date.now() - cached.timestamp < MENU_CACHE_TTL_MS) {
      setAllCategories(cached.categories);
      setCategories(cached.categories.filter((c) => c.active !== false));
      setAllMenuItems(cached.menuItems);
      setMenuItems(cached.menuItems.filter((m) => m.active !== false));
      return;
    }

    (async () => {
      const [categorySnap, menuSnap] = await Promise.all([
        getDocs(query(collection(db, "categories"), orderBy("order", "asc"))),
        getDocs(collection(db, "menuItems")),
      ]);
      if (cancelled) return;
      const categoryData = categorySnap.docs.map((d) => ({ id: d.id, ...d.data() } as Category));
      const menuData = menuSnap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem & { active?: boolean }));
      setAllCategories(categoryData);
      setCategories(categoryData.filter((c) => c.active !== false));
      setAllMenuItems(menuData);
      setMenuItems(menuData.filter((m) => m.active !== false));
      writeSession("customerMenuCache", { categories: categoryData, menuItems: menuData, timestamp: Date.now() });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // รีเฟรชตอนอยู่หน้ารายละเอียดเมนู: menuItems ยังโหลดไม่มา ต้องรอแล้วค่อยหา item ที่จำไว้กลับมาใส่
  useEffect(() => {
    if (view !== "item-detail" || selectedItem || manualSelectedItem || menuItems.length === 0) return;
    const savedId = readSession<string>("customerSelectedItemId");
    const found = savedId ? menuItems.find((m) => m.id === savedId) : undefined;
    if (found) {
      setSelectedItem(found);
    } else {
      setView("menu"); // หา item เดิมไม่เจอ (ถูกลบ/ปิดไปแล้ว) กลับไปหน้าเมนูแทนที่จะค้างหน้าเปล่า
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedItem, menuItems]);

  // จำหน้า/ตะกร้า/รายการที่กำลังดูไว้ ตอนกดรีเฟรชฝั่งลูกค้าจะได้กลับมาหน้าเดิม (ไม่ใช่ทุกทีที่กระโดดกลับไปหน้าแรก)
  useEffect(() => {
    if (!tableNumber) return; // ฝั่งพนักงานไม่เกี่ยว
    writeSession("customerTable", tableNumber);
    if (CUSTOMER_RESUMABLE_VIEWS.includes(view)) writeSession("customerView", view);
    writeSession("customerCart", cart);
    // ตอนเพิ่งรีเฟรชที่หน้า item-detail, selectedItem จะยังเป็น null อยู่ชั่วคราว
    // (รอ menuItems โหลดเสร็จก่อนถึงจะหา item เดิมเจอ) ถ้าเขียนทับตอนนี้ด้วย null
    // จะไปลบค่าที่บันทึกไว้ก่อนที่ effect ฟื้นคืนค่าจะทันได้อ่าน — เลยข้ามการเขียนไปก่อน
    if (view !== "item-detail" || selectedItem) {
      writeSession("customerSelectedItemId", selectedItem?.id ?? null);
    }
  }, [tableNumber, view, cart, selectedItem]);

  // iOS Safari (โดยเฉพาะเปิดผ่านแอปกล้อง/แอปแชทที่ใช้ in-app browser) มักดึงหน้าที่ถูก
  // "แช่แข็ง" ไว้ใน back-forward cache กลับมาแสดงโดยไม่รันโค้ดใหม่เลย ทำให้ Firestore
  // listener ค้าง/ไม่อัปเดต ดูเหมือนสแกนแล้วไม่ขึ้นอะไร ต้องรีเฟรชเองถึงจะเห็น —
  // ตรวจจับเคสนี้แล้วรีโหลดหน้าให้อัตโนมัติ
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // Watchdog เฉพาะฝั่งลูกค้า (มี ?table= ใน URL): แอปกล้อง/แอปแชทบนมือถือ (โดยเฉพาะ iPhone)
  // มักจะ preload หน้าเว็บล่วงหน้าก่อนผู้ใช้กดเปิดจริง ทำให้ Firestore onSnapshot เริ่มทำงาน
  // ตอนแท็บยังไม่ active แล้วค้าง ไม่เคย resolve ข้อมูลกลับมา ลูกค้าเลยเห็นแค่หน้าเปล่าโดยไม่มี error —
  // ถ้าผ่านไป ~6 วิ แล้ว categories/menuItems ยังว่างอยู่ ให้รีโหลดหน้าอัตโนมัติ 1 ครั้ง
  // (กัน reload วนลูปด้วย flag ใน sessionStorage เผื่อเน็ตหลุด/Firestore ล่มจริงๆ)
  useEffect(() => {
    if (!getTableFromUrl()) return; // ฝั่งพนักงานไม่เกี่ยว
    const RELOAD_FLAG = "customerDataWatchdogReloaded";

    if (categories.length > 0 || menuItems.length > 0) {
      // โหลดข้อมูลสำเร็จแล้ว — เคลียร์ flag เผื่อผู้ใช้เปิดหน้าใหม่ในเซสชันเดิมแล้วเจอปัญหาซ้ำ
      writeSession(RELOAD_FLAG, null);
      return;
    }

    const timer = window.setTimeout(() => {
      if (categories.length > 0 || menuItems.length > 0) return;
      if (readSession<boolean>(RELOAD_FLAG)) return; // รีโหลดไปแล้ว 1 รอบ ไม่รีโหลดซ้ำ
      writeSession(RELOAD_FLAG, true);
      window.location.reload();
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [categories.length, menuItems.length]);
  useEffect(() => {
    const isStaff = getTableFromUrl() === null; // ถ้าไม่มี ?table= = ฝั่งพนักงาน
    if (!isStaff) return; // ลูกค้าไม่ต้องฟัง orders เลย เลี่ยง permission error
    if (!everAuthed) return; // รอ login สำเร็จจริง (latch) — ทน auth กระพริบ ไม่ unsubscribe กลางคัน

    // ฟังเฉพาะออเดอร์ที่ยัง "ทำงานอยู่" — ครอบคลุมทุกอย่างที่หน้า Orders/Payment,
    // การคำนวณสถานะยุ่ง และ handler ปิดโต๊ะ/void/cancel ต้องใช้ ส่วนออเดอร์ที่
    // paid แล้ว หน้า History/Stats จะ query แยกตามช่วงวันที่เอง (ไม่ค้าง listener)
    // ไม่ใส่ orderBy ที่นี่ตั้งใจ — จะได้ไม่ต้องพึ่ง composite index (ฟิลเตอร์ status "in" อย่างเดียว
    // ใช้ single-field index อัตโนมัติ) แล้วเรียงลำดับ createdAt ฝั่ง client แทน
    // limit(300) เป็น safety cap เฉยๆ — ออเดอร์ active พร้อมกัน 300 ใบไม่เกิดขึ้นจริงในร้านนี้
    const q = query(
      collection(db, "orders"),
      where("status", "in", ["in-progress", "awaiting-payment"]),
      limit(300),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map((d) => mapOrderDoc(d.id, d.data()))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      setOrders(data);
    });
    return () => unsubscribe();
  }, [everAuthed]);

  // บัญชีรายจ่าย — ดึงเฉพาะช่วงวันที่ที่หน้า Expenses กำลังดู (1 doc ต่อวัน, id = "YYYY-MM-DD")
  // re-subscribe เมื่อช่วงวันที่เปลี่ยน — handler เพิ่ม/แก้/ลบ ทำงานกับวันที่ในช่วงนี้เสมอ
  useEffect(() => {
    const isStaff = getTableFromUrl() === null;
    if (!isStaff) return;
    if (!everAuthed) return;

    const unsubscribeExpenses = onSnapshot(
      query(
        collection(db, "expenses"),
        where("date", ">=", expenseRangeStart),
        where("date", "<=", expenseRangeEnd),
        limit(750),
      ),
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            date: raw.date,
            items: raw.items || [],
            totalAmount: raw.totalAmount || 0,
            updatedAt: raw.updatedAt?.toDate ? raw.updatedAt.toDate() : new Date(),
          } as ExpenseDay;
        });
        setExpenseDays(data);
      },
    );
    return () => unsubscribeExpenses();
  }, [everAuthed, expenseRangeStart, expenseRangeEnd]);

  // รายชื่อของที่เคยกรอก (autocomplete) — เป็น catalog ที่มีจำนวนจำกัด ดึงทั้งหมดได้ แต่ใส่ limit กันหลุด
  useEffect(() => {
    const isStaff = getTableFromUrl() === null;
    if (!isStaff) return;
    if (!everAuthed) return;

    const unsubscribeCatalog = onSnapshot(
      query(collection(db, "expenseItems"), limit(1000)),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseCatalogEntry));
        setExpenseCatalog(data);
      },
    );
    return () => unsubscribeCatalog();
  }, [everAuthed]);

  // รายการเหตุผลที่ใช้ซ้ำได้ (void/cancel) — เฉพาะฝั่งพนักงานเท่านั้น
  // ส่วน activityLogs ย้ายไป query รายวันในหน้า StaffActivityScreen เอง (ไม่ดึงทั้งหมดมาค้าง)
  useEffect(() => {
    const isStaff = getTableFromUrl() === null;
    if (!isStaff) return;
    if (!everAuthed) return;

    const unsubscribeReasons = onSnapshot(doc(db, "voidReasons", "list"), (snap) => {
      const raw = snap.data();
      setVoidReasons(Array.isArray(raw?.reasons) ? raw!.reasons : []);
    });
    return () => unsubscribeReasons();
  }, [everAuthed]);

  const [selectedPayTable, setSelectedPayTable] = useState<string | null>(null);
  const [loginError, setLoginError] = useState(false);
  const [staffTab, setStaffTab] = useState<StaffTab>("orders");
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const menuScrollTopRef = useRef(0);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const askConfirm = (message: string, onConfirm: () => void) => setConfirmDialog({ message, onConfirm });
  const [reasonPrompt, setReasonPrompt] = useState<{ title: string; onConfirm: (reason: string) => void } | null>(null);
  const askReason = (title: string, onConfirm: (reason: string) => void) => setReasonPrompt({ title, onConfirm });
  const [busyTables, setBusyTables] = useState(0);
  const [busyItems, setBusyItems] = useState(0);

  // ค่าล่าสุดของ doc status/live ที่ได้จาก listener — ใช้เทียบก่อนเขียน เพื่อกัน write ซ้ำ
  const liveStatusRef = useRef<{ busyTables: number; busyItems: number }>({ busyTables: 0, busyItems: 0 });
  const statusWriteTimerRef = useRef<number | null>(null);
  const pendingStatusRef = useRef<{ busyTables: number; busyItems: number } | null>(null);

  // ฟัง status สรุปที่ฝั่งพนักงาน (client ใครก็ตามที่ login อยู่) คำนวณและอัปเดตไว้ให้
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "status", "live"), (snap) => {
      const data = snap.data();
      const busyTables = data?.busyTables || 0;
      const busyItems = data?.busyItems || 0;
      liveStatusRef.current = { busyTables, busyItems };
      setBusyTables(busyTables);
      setBusyItems(busyItems);
    });
    return () => unsubscribe();
  }, []);

  // คำนวณสถานะยุ่งจากออเดอร์ที่เห็น (มีผลจริงเฉพาะฝั่งพนักงานที่ login แล้วเท่านั้น เพราะลูกค้าอ่าน orders ไม่ได้)
  // กัน write storm 2 ชั้น:
  //  1) guard — เขียนเฉพาะตอนค่าที่คำนวณได้ต่างจาก doc ปัจจุบัน (พนักงานหลายเครื่องคำนวณค่าเดียวกัน)
  //  2) throttle 4 วิ — เขียนได้มากสุด 1 ครั้ง/4 วิ ต่อเครื่อง โดย flush "ค่าล่าสุด" เสมอ (ไม่ตกหล่นตอนรัชชั่วโมง)
  useEffect(() => {
    if (!staffLoggedIn) return; // rules อนุญาตเขียนเฉพาะ auth อยู่แล้ว — เลี่ยงยิง setDoc ที่จะโดนปฏิเสธ
    const dineInProgress = orders.filter((o) => o.status === "in-progress" && !o.isTakeaway);
    const allInProgress = orders.filter((o) => o.status === "in-progress");
    const tables = new Set(dineInProgress.map((o) => o.tableNumber)).size;
    const items = allInProgress.reduce((s, o) => s + liveItemCount(o.items), 0);

    if (liveStatusRef.current.busyTables === tables && liveStatusRef.current.busyItems === items) {
      pendingStatusRef.current = null;
      return;
    }
    pendingStatusRef.current = { busyTables: tables, busyItems: items };
    if (statusWriteTimerRef.current !== null) return; // มี flush ค้างอยู่แล้ว — เดี๋ยวมันหยิบค่าล่าสุดไปเอง

    statusWriteTimerRef.current = window.setTimeout(() => {
      statusWriteTimerRef.current = null;
      const p = pendingStatusRef.current;
      pendingStatusRef.current = null;
      if (!p) return;
      // เช็คอีกรอบ เผื่อเครื่องอื่นเขียนค่านี้ไปแล้วระหว่างรอ
      if (liveStatusRef.current.busyTables === p.busyTables && liveStatusRef.current.busyItems === p.busyItems) return;
      setDoc(doc(db, "status", "live"), p).catch(() => { });
    }, 4000);
  }, [orders, staffLoggedIn]);

  const isBusy = busyTables >= 4 || busyItems > 10;
  const [manualTable, setManualTable] = useState<string | null>(null);
  const [manualCart, setManualCart] = useState<CartItem[]>([]);
  const [manualCategory, setManualCategory] = useState<string>("");
  const [manualSelectedItem, setManualSelectedItem] = useState<MenuItem | null>(null);
  const [manualIsTakeaway, setManualIsTakeaway] = useState(false);

  useEffect(() => {
    if (getTableFromUrl()) return; // ฝั่งลูกค้าไม่เกี่ยวกับ auth เลย ไม่ต้อง subscribe แม้แต่เพื่อเช็ค session
    // (getAuthInstance() ก็เรียกแค่ตรงนี้ — ไม่ใช่ตอนโหลดไฟล์ — เลี่ยง network call เช่น accounts:lookup / getProjectConfig)
    const unsubscribe = onAuthStateChanged(getAuthInstance(), (user) => {
      if (user && !getTableFromUrl()) {
        setView((v) => {
          if (v !== "staff-login") return v;
          const savedTab = readSession<StaffTab>("staffTab");
          if (isStaffTab(savedTab)) {
            setStaffTab(savedTab);
            return STAFF_TAB_VIEW[savedTab];
          }
          return "staff-orders";
        });
      }
      setStaffLoggedIn(!!user);
      if (user) setEverAuthed(true); // latch — ไม่มีการ set false ตรงนี้ (ทำเฉพาะตอนกด logout)
    });
    return () => unsubscribe();
  }, []);

  // รีเซ็ตเมนูที่ถูกปิดไว้ให้กลับมาเปิดทั้งหมดเมื่อขึ้นวันใหม่
  // ทำงานเฉพาะฝั่งพนักงานที่ login อยู่ (เพราะ security rules อนุญาตให้เขียน menuItems ได้เฉพาะ auth != null)
  // เช็คทันทีตอน login/เปิดแอป และเช็คซ้ำทุก 5 นาที เผื่อเปิดแท็บค้างข้ามเที่ยงคืนโดยไม่รีเฟรช
  // (เดิมเช็คทุก 1 นาที — งานนี้ทำสำเร็จแค่ครั้งเดียว/วันก็พอ ไม่ต้องละเอียดระดับนาที
  // ลดความถี่ให้กินโควต้า Firestore น้อยลงเป็น baseline โดยไม่กระทบว่าจะรีเซ็ตได้ตรงหรือไม่
  // — worst case แค่ช้าไปสูงสุด ~5 นาทีหลังเที่ยงคืน แทนที่จะเป็น ~1 นาที)
  useEffect(() => {
    if (!staffLoggedIn) return;

    let stopped = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const scheduleNext = (delayMs: number) => {
      if (stopped) return;
      timer = window.setTimeout(runOnce, delayMs);
    };

    // ทำงานทีละรอบ (ไม่ใช้ setInterval คงที่) — รอบถัดไปเริ่มก็ต่อเมื่อรอบก่อนจบแล้วเท่านั้น
    // กันไม่ให้ยิงซ้อนกันถ้ารอบก่อนค้าง/ช้า (เช่น Firestore โควต้าหมด/unavailable ชั่วคราว)
    const runOnce = async () => {
      try {
        const todayKey = getTodayKey();
        const lockRef = doc(db, "counters", `menu-reset-${todayKey}`);
        const claimed = await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(lockRef);
          if (snap.exists()) return false; // มีเครื่องอื่นรีเซ็ตของวันนี้ไปแล้ว
          transaction.set(lockRef, { resetAt: serverTimestamp() });
          return true;
        });

        if (claimed) {
          const toReset = (allMenuItemsRef.current || []).filter((m) => m.active === false);
          if (toReset.length > 0) {
            await Promise.all(
              toReset.map((m) => updateDoc(doc(db, "menuItems", m.id), { active: true }))
            );
          }
        }

        consecutiveFailures = 0;
        scheduleNext(5 * 60_000); // ปกติเช็คทุก 5 นาที
      } catch (err) {
        consecutiveFailures++;
        console.error("checkAndResetDailyMenu failed", err);
        // error ต่อเนื่อง (เช่น Firestore โควต้าหมด) → ถอยห่างแบบทวีคูณ ลดโหลดแทนการยิงรัวทุกนาที
        // เริ่ม 2 นาที เพิ่มเป็น 2 เท่าทุกครั้งที่ยัง fail สูงสุด 30 นาที แล้วกลับมาเร็วปกติเองเมื่อสำเร็จ
        const backoffMs = Math.min(60_000 * 2 ** consecutiveFailures, 30 * 60_000);
        scheduleNext(backoffMs);
      }
    };

    runOnce();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [staffLoggedIn]);

  const toggleLang = () => setLang((l) => (l === "en" ? "th" : "en"));
  useEffect(() => {
    if (!activeCategory && categories.length > 0) setActiveCategory(categories[0].id);
    if (!manualCategory && categories.length > 0) setManualCategory(categories[0].id);
  }, [categories, activeCategory, manualCategory]);

  const handleSelectItem = (item: MenuItem) => {
    setSelectedItem(item);
    setView("item-detail");
  };

  const handleAddToCart = (ci: CartItem) => {
    setCart((prev) => mergeIntoCart(prev, ci));
    setView("menu");
  };

  const handleUpdateQty = (cartId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
    } else {
      setCart((prev) => prev.map((ci) => (ci.cartId === cartId ? { ...ci, quantity: qty } : ci)));
    }
  };

  const handleRemoveItem = (cartId: string) => {
    setCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
  };

  const isSubmittingOrderRef = useRef(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  const handleConfirmOrder = async () => {
    // กันกดปุ่ม/แตะจอซ้ำเร็ว ๆ (พบบ่อยทั้ง iOS และ Android) ที่ทำให้ยิง addDoc สองครั้ง
    // กลายเป็นออเดอร์เบิ้ล — เช็คด้วย ref เพราะ state อาจอัปเดตไม่ทันถ้าแตะรัวมาก
    if (isSubmittingOrderRef.current) return;
    if (!(tableNumber && cart.length > 0)) return;
    isSubmittingOrderRef.current = true;
    setIsSubmittingOrder(true);
    try {
      // JSON round-trip: ตัดฟิลด์ undefined ให้ Firestore | .map(stripItemPhoto): ตัดรูป base64 ที่ทำ doc บวม
      const cleanItems = (JSON.parse(JSON.stringify(cart)) as CartItem[]).map(stripItemPhoto);
      await addDoc(collection(db, "orders"), {
        tableNumber,
        items: cleanItems,
        status: "in-progress",
        createdAt: serverTimestamp(),
      });
      setCart([]);
      setView("order-sent");
    } finally {
      isSubmittingOrderRef.current = false;
      setIsSubmittingOrder(false);
    }
  };

  const handleStartManualOrder = () => {
    setManualTable(null);
    setManualIsTakeaway(false);
    setManualCart([]);
    setManualCategory(categories[0]?.id || "");
    setView("staff-manual-table");
  };

  const handlePickManualTable = (tn: string) => {
    setManualTable(tn);
    setManualIsTakeaway(false);
    setView("staff-manual-menu");
  };

  const handlePickManualTakeaway = () => {
    setManualTable(null);
    setManualIsTakeaway(true);
    setView("staff-manual-menu");
  };

  const handleManualAddToCart = (ci: CartItem) => {
    setManualCart((prev) => mergeIntoCart(prev, ci));
    setView("staff-manual-menu");
  };

  const handleManualUpdateQty = (cartId: string, qty: number) => {
    if (qty <= 0) {
      setManualCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
    } else {
      setManualCart((prev) => prev.map((ci) => (ci.cartId === cartId ? { ...ci, quantity: qty } : ci)));
    }
  };

  const handleManualRemove = (cartId: string) => {
    setManualCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
  };

  const handleExitManualOrder = () => {
    const reset = () => {
      setManualCart([]);
      setManualTable(null);
      setManualIsTakeaway(false);
      setView("staff-orders");
    };
    if (manualCart.length > 0) {
      askConfirm(lang === "en" ? "Discard this order?" : "ยกเลิกออเดอร์นี้?", reset);
    } else {
      reset();
    }
  };

  const isSubmittingManualOrderRef = useRef(false);
  const [isSubmittingManualOrder, setIsSubmittingManualOrder] = useState(false);

  const handleConfirmManualOrder = async () => {
    if (isSubmittingManualOrderRef.current) return; // กันแตะซ้ำเช่นเดียวกับฝั่งลูกค้า
    if (manualCart.length === 0) return;
    if (!manualIsTakeaway && !manualTable) return;
    isSubmittingManualOrderRef.current = true;
    setIsSubmittingManualOrder(true);
    try {
      const cleanItems = (JSON.parse(JSON.stringify(manualCart)) as CartItem[]).map(stripItemPhoto);
      if (manualIsTakeaway) {
        const counterRef = doc(db, "counters", `takeaway-${getTodayKey()}`);
        const nextNumber = await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(counterRef);
          const current = snap.exists() ? (snap.data().count || 0) : 0;
          const next = current + 1;
          transaction.set(counterRef, { count: next });
          return next;
        });
        await addDoc(collection(db, "orders"), {
          tableNumber: "0",
          isTakeaway: true,
          takeawayLabel: `T-${nextNumber}`,
          items: cleanItems,
          status: "in-progress",
          createdAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "orders"), {
          tableNumber: manualTable,
          items: cleanItems,
          status: "in-progress",
          createdAt: serverTimestamp(),
        });
      }
      setManualCart([]);
      setManualTable(null);
      setManualIsTakeaway(false);
      setView("staff-orders");
    } finally {
      isSubmittingManualOrderRef.current = false;
      setIsSubmittingManualOrder(false);
    }
  };

  const takeawayCounterRef = { current: 0 };

  // Staff handlers
  const STAFF_EMAIL = "admin@hueanyong.local";

  const handleStaffLogin = async (pw: string) => {
    try {
      await signInWithEmailAndPassword(getAuthInstance(), STAFF_EMAIL, pw);
      setLoginError(false);
      setStaffTab("orders");
      writeSession("staffTab", "orders");
      setView("staff-orders");
    } catch {
      setLoginError(true);
    }
  };

  const handleMarkServed = async (orderId: string) => {
    await updateDoc(doc(db, "orders", orderId), { status: "awaiting-payment" });
  };

  // mark 1 รายการใน order เป็น voided — ยังคงอยู่ใน items[] เสมอ (ห้ามลบออกจาก array)
  // + ตัดรูปทิ้ง + เขียน log void_item ถ้าทุกรายการถูก void หมด เปลี่ยน status เป็น "cancelled" (ไม่ลบ doc)
  const voidOrderItem = async (order: Order, cartId: string, reason: string) => {
    const target = order.items.find((ci) => ci.cartId === cartId);
    if (!target || target.voided) return;
    const amount = cartItemUnitPrice(target) * target.quantity;
    const newItems = order.items.map((ci) =>
      ci.cartId === cartId
        ? stripItemPhoto({ ...ci, voided: true, voidReason: reason, voidedAt: new Date() })
        : ci
    );
    const allVoided = newItems.every((ci) => ci.voided);
    await logActivity({
      action: "void_item",
      orderId: order.id,
      tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
      itemName: target.item.name.th,
      amount,
      reason,
    });
    await addVoidReason(reason);
    await updateDoc(doc(db, "orders", order.id), {
      items: newItems,
      ...(allVoided
        ? { status: "cancelled", cancelReason: reason, cancelledAt: new Date() }
        : {}),
    });
  };

  const handleRemoveOrderItem = async (orderId: string, cartId: string, reason: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    await voidOrderItem(order, cartId, reason);
  };

  const handleCancelOrder = async (orderId: string, reason: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    await logActivity({
      action: "cancel_order",
      orderId,
      tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
      amount: orderTotal(order),
      reason,
      details: {
        isTakeaway: !!order.isTakeaway,
        takeawayLabel: order.takeawayLabel ?? null,
        items: order.items.map((ci) => ({
          name: ci.item.name.th,
          quantity: ci.quantity,
          unitPrice: cartItemUnitPrice(ci),
          voided: !!ci.voided,
        })),
      },
    });
    await addVoidReason(reason);
    await updateDoc(doc(db, "orders", orderId), {
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: new Date(),
      items: order.items.map(stripItemPhoto), // ออเดอร์ที่ถูกยกเลิก ไม่เก็บรูปไว้เลย
    });
  };

  const handleCloseTable = async (tableNum: string, paymentMethod: PaymentMethod, cashReceived?: number) => {
    const toClose = orders.filter(
      (o) => o.tableNumber === tableNum && o.status === "awaiting-payment"
    );
    if (toClose.length === 0) return;
    const batchId = uid();
    await Promise.all(
      toClose.map((o) =>
        updateDoc(doc(db, "orders", o.id), {
          status: "paid",
          paymentMethod,
          paymentBatchId: batchId,
          ...(cashReceived !== undefined ? { cashReceived } : {}),
        })
      )
    );
    setSelectedPayTable(null);
  };

  const handleCloseTakeawayOrder = async (orderId: string, paymentMethod: PaymentMethod, cashReceived?: number) => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "paid",
      paymentMethod,
      ...(cashReceived !== undefined ? { cashReceived } : {}),
    });
  };

  // ปรับจำนวนรายการตอนชำระเงิน — ลดจนเหลือ 0 = void (ต้องกรอกเหตุผลก่อน) แทนการลบออกจาก array
  const handleAdjustPaymentItem = async (contributingOrders: Order[], key: string, delta: number) => {
    for (const order of contributingOrders) {
      const target = order.items.find((ci) => !ci.voided && cartItemKey(ci) === key);
      if (!target) continue;
      const newQty = target.quantity + delta;
      if (newQty > 0) {
        const newItems = order.items.map((ci) =>
          ci.cartId === target.cartId ? { ...ci, quantity: newQty } : ci
        );
        await updateDoc(doc(db, "orders", order.id), { items: newItems });
      } else {
        askReason(T[lang].voidItemReasonTitle, (reason) => {
          void voidOrderItem(order, target.cartId, reason);
        });
      }
      return;
    }
  };

  const handleAdjustTakeawayItem = async (orderId: string, key: string, delta: number) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const target = order.items.find((ci) => !ci.voided && cartItemKey(ci) === key);
    if (!target) return;
    const newQty = target.quantity + delta;
    if (newQty > 0) {
      const newItems = order.items.map((ci) =>
        ci.cartId === target.cartId ? { ...ci, quantity: newQty } : ci
      );
      await updateDoc(doc(db, "orders", orderId), { items: newItems });
    } else {
      askReason(T[lang].voidItemReasonTitle, (reason) => {
        void voidOrderItem(order, target.cartId, reason);
      });
    }
  };

  const handleStaffTabChange = (tab: StaffTab) => {
    setStaffTab(tab);
    writeSession("staffTab", tab);
    setView(STAFF_TAB_VIEW[tab]);
  };

  const handleAddNewItem = () => {
    setEditingItem({
      id: uid(),
      categoryId: categories[0]?.id || "",
      name: { en: "", th: "" },
      description: { en: "", th: "" },
      price: 0,
      photo: "",
      hasMeatChoice: false,
      hasSpice: false,
      hasPortion: false,
      hasEggAddon: false,
      hasPlainAddOns: false,
    });
    setView("staff-menu-edit");
  };

  const handleEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setView("staff-menu-edit");
  };

  const handleSaveItem = async (item: MenuItem) => {
    const prev = allMenuItems.find((m) => m.id === item.id);
    let photo = item.photo;

    if (photo.startsWith("data:")) {
      // เพิ่งเลือกรูปใหม่รอบนี้ (ยังเป็น base64 จาก compressImage) — อัปโหลดขึ้น Supabase Storage
      // แทนที่จะเก็บ base64 ตรงๆ ใน Firestore ตั้งชื่อไฟล์ตาม id เมนู เพื่อให้แก้รูปซ้ำ = เขียนทับไฟล์เดิมอัตโนมัติ
      // (upsert: true จำเป็น — Supabase ปฏิเสธถ้าไม่ใส่และมีไฟล์ชื่อนี้อยู่แล้ว ต่างจาก Firebase ที่ทับให้เลย)
      const blob = await dataUrlToBlob(photo);
      const supabase = getSupabaseClient();
      const path = `menuPhotos/${item.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(MENU_PHOTOS_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(MENU_PHOTOS_BUCKET).getPublicUrl(path);
      // path เดิมซ้ำทุกครั้ง (ตั้งตาม item id) แต่ Supabase CDN cache public URL ไว้แล้วไม่ invalidate
      // ตอน overwrite — ต่อ ?v=timestamp กันรูปใหม่โดน cache เก่าบังจนกว่า cache จะหมดอายุเอง
      photo = `${data.publicUrl}?v=${Date.now()}`;
    } else if (photo === "" && prev?.photo?.startsWith("http")) {
      // ลบรูปออก และของเดิมเป็นไฟล์ใน Storage — ลบไฟล์เก่าทิ้งด้วย กันไฟล์กำพร้าค้าง
      try {
        const { error } = await getSupabaseClient().storage
          .from(MENU_PHOTOS_BUCKET)
          .remove([`menuPhotos/${item.id}.jpg`]);
        if (error) console.error("remove (menu photo) failed", error); // ไฟล์อาจไม่มีอยู่แล้ว ไม่บล็อกการบันทึก
      } catch (err) {
        console.error("remove (menu photo) failed", err);
      }
    }
    // กรณีอื่น (photo ไม่เปลี่ยน / ยังเป็น Unsplash ID เดิม) ไม่ต้องแตะ Storage เลย

    await setDoc(doc(db, "menuItems", item.id), { ...item, photo, active: (item as any).active ?? true });
    if (!prev) {
      await logActivity({ action: "menu_item_added", itemName: item.name.th, details: { price: item.price } });
    } else if (prev.price !== item.price) {
      await logActivity({
        action: "menu_item_edited",
        itemName: item.name.th,
        details: { oldPrice: prev.price, newPrice: item.price },
      });
    }
    setEditingItem(null);
    setView("staff-menu");
  };

  const handleToggleActive = async (item: MenuItem, active: boolean) => {
    await updateDoc(doc(db, "menuItems", item.id), { active });
  };

  // รับ id ที่เรียงลำดับใหม่แล้ว (จากการลาก) แล้วเขียนค่า order ทับทั้งหมวด
  const handleReorderMenuItems = async (categoryId: string, orderedIds: string[]) => {
    await Promise.all(
      orderedIds.map((id, i) => updateDoc(doc(db, "menuItems", id), { order: i }))
    );
  };

  const handleDeleteItem = async (itemId: string) => {
    const item = allMenuItems.find((m) => m.id === itemId);
    await logActivity({
      action: "menu_item_deleted",
      itemName: item?.name.th,
      details: item ? { price: item.price } : undefined,
    });
    if (item?.photo?.startsWith("http")) {
      // ลบเมนูทั้งตัว — เก็บกวาดไฟล์รูปใน Storage ไปด้วย กันไฟล์กำพร้าค้าง
      try {
        const { error } = await getSupabaseClient().storage
          .from(MENU_PHOTOS_BUCKET)
          .remove([`menuPhotos/${itemId}.jpg`]);
        if (error) console.error("remove (menu photo) failed", error);
      } catch (err) {
        console.error("remove (menu photo) failed", err);
      }
    }
    await deleteDoc(doc(db, "menuItems", itemId));
  };

  const handleLogout = async () => {
    await signOut(getAuthInstance());
    setEverAuthed(false); // logout จริง — ปลด latch เพื่อให้ listener ฝั่งพนักงานหยุดทำงาน
    writeSession("staffTab", null);
    setView("staff-login");
  };

  let content: React.ReactNode = null;

  const handleAddCategory = async (nameEn: string, nameTh: string) => {
    const newOrder = allCategories.length > 0 ? Math.max(...allCategories.map((c) => c.order)) + 1 : 0;
    await addDoc(collection(db, "categories"), { nameEn, nameTh, order: newOrder, active: true, signature: false });
  };

  const handleReorderCategories = async (orderedIds: string[]) => {
    await Promise.all(
      orderedIds.map((id, i) => updateDoc(doc(db, "categories", id), { order: i }))
    );
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const cat = allCategories.find((c) => c.id === categoryId);
    await logActivity({
      action: "category_deleted",
      itemName: cat?.nameTh,
      details: cat ? { nameEn: cat.nameEn } : undefined,
    });
    await deleteDoc(doc(db, "categories", categoryId));
  };

  const handleToggleCategorySignature = async (categoryId: string, signature: boolean) => {
    await updateDoc(doc(db, "categories", categoryId), { signature });
  };

  // เพิ่มรายการซื้อของ 1 บรรทัดเข้าไปในวันที่ระบุ (สร้าง doc ของวันนั้นถ้ายังไม่มี)
  // แล้วอัปเดต "รายชื่อของที่เคยกรอก" (expenseItems) ไว้ใช้ทำ autocomplete ต่อ
  const handleAddExpenseItem = async (date: string, item: ExpenseLineItem) => {
    const existing = expenseDays.find((e) => e.id === date);
    const newItems = [...(existing?.items || []), item];
    const totalAmount = newItems.reduce((s, i) => s + i.amount, 0);
    await setDoc(doc(db, "expenses", date), {
      date,
      items: newItems,
      totalAmount,
      updatedAt: serverTimestamp(),
    });

    const catalogId = expenseCatalogId(item.name);
    const existingCatalog = expenseCatalog.find((c) => c.id === catalogId);
    await setDoc(doc(db, "expenseItems", catalogId), {
      name: item.name,
      unit: item.unit || "",
      lastQuantity: item.quantity,
      lastAmount: item.amount,
      usageCount: (existingCatalog?.usageCount || 0) + 1,
      updatedAt: serverTimestamp(),
    });
  };

  // แก้ไขรายการที่บันทึกไปแล้ว 1 บรรทัด — แทนที่เฉพาะ item ที่ index นั้น แล้ว setDoc ทับทั้ง document ของวันนั้น
  const handleEditExpenseItem = async (date: string, index: number, updatedItem: ExpenseLineItem) => {
    const existing = expenseDays.find((e) => e.id === date);
    if (!existing || !existing.items[index]) return;
    const before = existing.items[index];
    const newItems = existing.items.map((it, i) => (i === index ? updatedItem : it));
    const totalAmount = newItems.reduce((s, i) => s + i.amount, 0);
    await setDoc(doc(db, "expenses", date), {
      date,
      items: newItems,
      totalAmount,
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      action: "expense_edited",
      itemName: updatedItem.name,
      amount: updatedItem.amount,
      details: {
        date,
        before: {
          name: before.name,
          quantity: before.quantity,
          unit: before.unit ?? null,
          amount: before.amount,
        },
        after: {
          name: updatedItem.name,
          quantity: updatedItem.quantity,
          unit: updatedItem.unit ?? null,
          amount: updatedItem.amount,
        },
      },
    });
  };

  const handleDeleteExpenseItem = async (date: string, index: number) => {
    const existing = expenseDays.find((e) => e.id === date);
    if (!existing) return;
    const removed = existing.items[index];
    const newItems = existing.items.filter((_, i) => i !== index);
    const totalAmount = newItems.reduce((s, i) => s + i.amount, 0);
    if (removed) {
      await logActivity({
        action: "expense_deleted",
        itemName: removed.name,
        amount: removed.amount,
        details: { quantity: removed.quantity, unit: removed.unit ?? null, date },
      });
    }
    if (newItems.length === 0) {
      await deleteDoc(doc(db, "expenses", date));
    } else {
      await setDoc(doc(db, "expenses", date), {
        date,
        items: newItems,
        totalAmount,
        updatedAt: serverTimestamp(),
      });
    }
  };

  switch (view) {
    case "menu":
      content = (
        <MenuScreen
          lang={lang}
          tableNumber={tableNumber!}
          cart={cart}
          menuItems={menuItems}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onItemClick={handleSelectItem}
          onViewCart={() => setView("cart")}
          onLangToggle={toggleLang}
          categories={categories}
          isBusy={isBusy}
        />
      );
      break;

    case "link-expired":
      content = <LinkExpiredScreen lang={lang} />;
      break;

    case "item-detail": {
      const isManualFlow = !!manualSelectedItem;
      const activeItem = isManualFlow ? manualSelectedItem : selectedItem;
      content = activeItem ? (
        <ItemDetailScreen
          lang={lang}
          tableNumber={isManualFlow ? (manualIsTakeaway ? "0" : manualTable!) : tableNumber!}
          item={activeItem}
          cart={isManualFlow ? manualCart : cart}
          onBack={() => {
            if (isManualFlow) { setManualSelectedItem(null); setView("staff-manual-menu"); }
            else setView("menu");
          }}
          onAddToCart={(ci) => {
            if (isManualFlow) { handleManualAddToCart(ci); setManualSelectedItem(null); }
            else handleAddToCart(ci);
          }}
          onViewCart={() => setView(isManualFlow ? "staff-manual-cart" : "cart")}
          onLangToggle={toggleLang}
          isTakeaway={isManualFlow && manualIsTakeaway}
        />
      ) : null;
      break;
    }

    case "cart":
      content = (
        <CartScreen
          lang={lang}
          tableNumber={tableNumber!}
          cart={cart}
          onBack={() => setView("menu")}
          onUpdateQty={handleUpdateQty}
          onRemove={handleRemoveItem}
          onConfirm={handleConfirmOrder}
          onLangToggle={toggleLang}
          submitting={isSubmittingOrder}
        />
      );
      break;

    case "order-sent":
      content = (
        <OrderSentScreen
          lang={lang}
          tableNumber={tableNumber!}
          onOrderMore={() => setView("menu")}
        />
      );
      break;

    case "staff-login":
      content = (
        <StaffLoginScreen
          lang={lang}
          onLogin={handleStaffLogin}
          onBack={() => setView("staff-login")}
          error={loginError}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-orders":
      content = (
        <StaffOrdersScreen
          lang={lang}
          orders={orders}
          onMarkServed={handleMarkServed}
          onRemoveItem={(orderId, cartId) =>
            askReason(T[lang].voidItemReasonTitle, (reason) => handleRemoveOrderItem(orderId, cartId, reason))
          }
          onCancelOrder={(orderId) =>
            askReason(T[lang].cancelOrderReasonTitle, (reason) => handleCancelOrder(orderId, reason))
          }
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
          onAskConfirm={askConfirm}
          onStartManualOrder={handleStartManualOrder}
        />
      );
      break;

    case "staff-payment":
      content = (
        <StaffPaymentScreen
          lang={lang}
          orders={orders}
          onCloseTable={handleCloseTable}
          onCloseTakeaway={handleCloseTakeawayOrder}
          onAdjustItem={handleAdjustPaymentItem}
          onAdjustTakeawayItem={handleAdjustTakeawayItem}
          onCancelOrder={(orderId) =>
            askReason(T[lang].cancelOrderReasonTitle, (reason) => handleCancelOrder(orderId, reason))
          }
          onCancelOrders={(orderIds) =>
            askReason(T[lang].cancelOrderReasonTitle, (reason) =>
              orderIds.forEach((id) => handleCancelOrder(id, reason))
            )
          }
          onAskConfirm={askConfirm}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-menu":
      content = (
        <StaffMenuScreen
          lang={lang}
          items={allMenuItems}
          categories={allCategories}
          onAdd={handleAddNewItem}
          onEdit={handleEditItem}
          onToggleActive={handleToggleActive}
          onDelete={handleDeleteItem}
          onAddCategory={handleAddCategory}
          onDeleteCategory={handleDeleteCategory}
          onToggleCategorySignature={handleToggleCategorySignature}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
          onAskConfirm={askConfirm}
          onReorderCategories={handleReorderCategories}
          onReorderMenuItems={handleReorderMenuItems}
          scrollTopRef={menuScrollTopRef}
        />
      );
      break;

    case "staff-menu-edit":
      content = editingItem ? (
        <StaffMenuEditScreen
          lang={lang}
          item={editingItem}
          onSave={handleSaveItem}
          onCancel={() => setView("staff-menu")}
          onLangToggle={toggleLang}
          categories={categories}
        />
      ) : null;
      break;

    case "staff-history":
      content = (
        <StaffHistoryScreen
          lang={lang}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-stats":
      content = (
        <StaffStatsScreen
          lang={lang}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-expenses":
      content = (
        <StaffExpensesScreen
          lang={lang}
          expenseDays={expenseDays}
          catalog={expenseCatalog}
          rangeStart={expenseRangeStart}
          rangeEnd={expenseRangeEnd}
          onRangeChange={(start, end) => { setExpenseRangeStart(start); setExpenseRangeEnd(end); }}
          onAddItem={handleAddExpenseItem}
          onEditItem={handleEditExpenseItem}
          onDeleteItem={handleDeleteExpenseItem}
          onAskConfirm={askConfirm}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-activity":
      content = (
        <StaffActivityScreen
          lang={lang}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-manual-table":
      content = (
        <StaffManualTableScreen
          lang={lang}
          onSelect={handlePickManualTable}
          onSelectTakeaway={handlePickManualTakeaway}
          onCancel={() => setView("staff-orders")}
          onLangToggle={toggleLang}
        />
      );
      break;

    case "staff-manual-menu":
      content = (
        <MenuScreen
          lang={lang}
          tableNumber={manualIsTakeaway ? "0" : (manualTable || "")}
          cart={manualCart}
          menuItems={menuItems}
          categories={categories}
          activeCategory={manualCategory}
          onCategoryChange={setManualCategory}
          onItemClick={(item) => { setManualSelectedItem(item); setView("item-detail"); }}
          onViewCart={() => setView("staff-manual-cart")}
          onLangToggle={toggleLang}
          isTakeaway={manualIsTakeaway}
          onExit={handleExitManualOrder}
        />
      );
      break;

    case "staff-manual-cart":
      content = (
        <CartScreen
          lang={lang}
          tableNumber={manualTable || ""}
          cart={manualCart}
          onBack={() => setView("staff-manual-menu")}
          onUpdateQty={handleManualUpdateQty}
          onRemove={handleManualRemove}
          onConfirm={handleConfirmManualOrder}
          onLangToggle={toggleLang}
          isTakeaway={manualIsTakeaway}
          submitting={isSubmittingManualOrder}
        />
      );
      break;

    default:
      content = null;
  }

  return (
    <>
      {content}
      {confirmDialog && (
        <ConfirmModal
          message={confirmDialog.message}
          lang={lang}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {reasonPrompt && (
        <ReasonPickerModal
          title={reasonPrompt.title}
          reasons={voidReasons}
          lang={lang}
          onConfirm={(reason) => {
            reasonPrompt.onConfirm(reason);
            setReasonPrompt(null);
          }}
          onCancel={() => setReasonPrompt(null)}
        />
      )}
    </>
  );
}
