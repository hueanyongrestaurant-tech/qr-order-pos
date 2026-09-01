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
} from "lucide-react";

import { db, auth } from "../lib/firebase";
import { collection, addDoc, setDoc, onSnapshot, query, orderBy, where, doc, updateDoc, deleteDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

// ─── Types ───────────────────────────────────────────────────────────────────

type Language = "en" | "th";
type View =
  | "menu"
  | "link-expired"
  | "item-detail"
  | "cart"
  | "order-sent"
  | "staff-login"
  | "staff-orders"
  | "staff-payment"
  | "staff-menu"
  | "staff-menu-edit"
  | "staff-history"
  | "staff-stats"
  | "staff-expenses"
  | "staff-manual-table"
  | "staff-manual-menu"
  | "staff-manual-cart";;
type MeatChoice = "pork" | "chicken" | "beef";
type SpiceLevel = 0 | 1 | 2 | 3;
type Portion = "regular" | "special";
interface CustomChoice {
  id: string;
  labelTh: string;
  labelEn: string;
  priceDelta: number;
  active?: boolean;
}
interface CustomGroup {
  id: string;
  nameTh: string;
  nameEn: string;
  type: "single" | "multi"; // single = เลือกได้ 1, multi = เลือกได้หลายอย่าง
  choices: CustomChoice[];
  required?: boolean;
}
type OrderStatus = "in-progress" | "awaiting-payment" | "paid";
type PaymentMethod = "cash" | "transfer";

interface MenuItem {
  id: string;
  categoryId: string;
  name: { en: string; th: string };
  description: { en: string; th: string };
  price: number;
  photo: string;
  hasMeatChoice?: boolean;
  meatPriceDeltas?: Partial<Record<MeatChoice, number>>;
  hasSpice?: boolean;
  hasPortion?: boolean;
  portionPriceDelta?: number;
  hasEggAddon?: boolean;   // ปิดตัวเลือกไข่ดาวสำหรับเมนูนี้ได้
  hasPlainAddOns?: boolean; // ปิดตัวเลือกจาน/ช้อนส้อม/แก้วน้ำสำหรับเมนูนี้ได้
  customGroups?: CustomGroup[];
  popular?: boolean;
  disabledMeats?: MeatChoice[];
  order?: number;
}

interface CartItem {
  cartId: string;
  item: MenuItem;
  meat?: MeatChoice;
  portion?: Portion;
  customSelections?: Record<string, string[]>;
  note?: string;
  spiceLevel: SpiceLevel;
  addEgg: boolean;
  addOns: string[];
  quantity: number;
}

interface Order {
  id: string;
  tableNumber: string;
  timestamp: Date;
  items: CartItem[];
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
  isTakeaway?: boolean;
  takeawayLabel?: string;
  paymentBatchId?: string;
}

// ─── บัญชีรายจ่าย (Expenses) ───────────────────────────────────────────────────
// 1 document ต่อ 1 วัน (doc id = "YYYY-MM-DD") เก็บรายการของที่ซื้อไว้เป็น array
// ข้างใน แทนที่จะแยก 1 document ต่อ 1 รายการ เพื่อไม่ให้จำนวน document บวมเร็วเกินไป

interface ExpenseLineItem {
  name: string;
  quantity: number;
  unit?: string;
  amount: number; // ราคารวมของรายการนี้ (บาท)
}

interface ExpenseDay {
  id: string; // = date ("YYYY-MM-DD")
  date: string;
  items: ExpenseLineItem[];
  totalAmount: number;
  updatedAt: Date;
}

// รายชื่อของที่เคยกรอกไว้ ใช้เพื่อ autocomplete ตอนพิมพ์ชื่อของ (เหมือน Excel)
interface ExpenseCatalogEntry {
  id: string; // sanitized name ใช้เป็น doc id
  name: string;
  unit?: string;
  lastQuantity?: number;
  lastAmount?: number;
  usageCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ADD_ONS = [
  { id: "extra-plate", label: { en: "Extra Plate", th: "จานเปล่าเพิ่ม" }, price: 10 },
  { id: "cutlery", label: { en: "Cutlery Set", th: "ช้อนส้อมชุด" }, price: 0 },
  { id: "water-glass", label: { en: "Water Glass", th: "แก้วน้ำ" }, price: 0 },
];

interface Category {
  id: string;
  nameEn: string;
  nameTh: string;
  order: number;
  active?: boolean;
  signature?: boolean;
}

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  en: {
    appName: "Hueanyong Kitchen",
    tagline: "Northern Thai Kitchen",
    tableLabel: "Table",
    selectTable: "Select Your Table",
    selectTableSub: "Scan a QR code or choose your table number below",
    startOrder: "Start Ordering",
    langSwitch: "ภาษาไทย",
    viewCart: "View Order",
    addToCart: "Add to Order",
    cart: "Your Order",
    emptyCart: "Your cart is empty",
    emptyCartSub: "Browse our menu and add something delicious",
    goToMenu: "Browse Menu",
    total: "Total",
    confirmOrder: "Confirm Order",
    meatChoice: "Choose Protein",
    pork: "Pork",
    chicken: "Chicken",
    beef: "Beef",
    spiceLevel: "Spice Level",
    addEgg: "Add Fried Egg",
    eggPrice: "+฿15",
    addOns: "Add-ons",
    quantity: "Quantity",
    orderSent: "Order Sent!",
    orderSentMsg: "Your order is on its way to the kitchen. Sit back, relax, and enjoy the atmosphere.",
    orderMore: "Order More",
    staffLogin: "Staff Login",
    password: "Password",
    loginBtn: "Log In",
    wrongPass: "Incorrect password. Please try again.",
    staffOrders: "Orders",
    staffPayment: "Payment",
    logout: "Log Out",
    inProgress: "In Progress",
    awaitingPayment: "Awaiting Payment",
    markServed: "Mark as Served",
    noActiveOrders: "No active orders right now",
    noTablesWaiting: "No tables awaiting payment",
    paymentTitle: "Payment",
    selectTablePay: "Select a table to process payment",
    tableTotal: "Table Total",
    closeTable: "Close Table — Payment Received",
    cancelOrder: "Cancel Order",
    confirmCancelOrder: "Cancel this whole order?",
    confirmRemoveItem: "Remove this item?",
    portion: "Portion Size",
    regular: "Regular",
    special: "Special",
    busyBanner: "We're currently busy — your order may take a little longer than usual.",
    linkExpired: "This link has expired",
    linkExpiredMsg: "Please scan the QR code at your table again to continue ordering.",
    staffAccess: "Staff Login",
    thb: "฿",
    popular: "Signature",
    back: "Back",
    eggAdded: "+ Fried Egg",
    freeLabel: "Free",
    rounds: "round",
    roundsPlural: "rounds",
    items: "items",
    spiceLevels: ["No Spice", "Mild", "Medium", "Very Spicy"],
    meats: { pork: "Pork", chicken: "Chicken", beef: "Beef" },
    meatEmoji: { pork: "🐷", chicken: "🐓", beef: "🥩" },
  },
  th: {
    appName: "ครัวเฮือนยอง",
    tagline: "อาหารเหนือ",
    tableLabel: "โต๊ะ",
    selectTable: "เลือกโต๊ะของท่าน",
    selectTableSub: "สแกน QR หรือเลือกหมายเลขโต๊ะด้านล่าง",
    startOrder: "เริ่มสั่งอาหาร",
    langSwitch: "English",
    viewCart: "ดูรายการ",
    addToCart: "เพิ่มในรายการ",
    cart: "รายการสั่งอาหาร",
    emptyCart: "ตะกร้าว่างเปล่า",
    emptyCartSub: "เลือกอาหารจากเมนูได้เลย",
    goToMenu: "ดูเมนู",
    total: "ยอดรวม",
    confirmOrder: "ยืนยันการสั่งอาหาร",
    meatChoice: "เลือกโปรตีน",
    pork: "หมู",
    chicken: "ไก่",
    beef: "เนื้อ",
    spiceLevel: "ระดับความเผ็ด",
    addEgg: "เพิ่มไข่ดาว",
    eggPrice: "+฿15",
    addOns: "เพิ่มเติม",
    quantity: "จำนวน",
    orderSent: "ส่งออเดอร์แล้ว!",
    orderSentMsg: "ครัวได้รับออเดอร์ของท่านแล้ว โปรดนั่งรอสักครู่ เพลิดเพลินกับบรรยากาศ",
    orderMore: "สั่งเพิ่ม",
    staffLogin: "เข้าสู่ระบบพนักงาน",
    password: "รหัสผ่าน",
    loginBtn: "เข้าสู่ระบบ",
    wrongPass: "รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่",
    staffOrders: "ออเดอร์",
    staffPayment: "ชำระเงิน",
    logout: "ออกจากระบบ",
    inProgress: "กำลังเตรียม",
    awaitingPayment: "รอชำระเงิน",
    markServed: "เสิร์ฟแล้ว",
    noActiveOrders: "ไม่มีออเดอร์ที่กำลังดำเนินการ",
    noTablesWaiting: "ไม่มีโต๊ะที่รอชำระเงิน",
    paymentTitle: "ชำระเงิน",
    selectTablePay: "เลือกโต๊ะเพื่อดำเนินการชำระเงิน",
    tableTotal: "ยอดรวมโต๊ะ",
    closeTable: "ปิดโต๊ะ — รับเงินแล้ว",
    cancelOrder: "ยกเลิกออเดอร์",
    confirmCancelOrder: "ยกเลิกออเดอร์นี้ทั้งหมด?",
    confirmRemoveItem: "ลบรายการนี้?",
    portion: "ขนาด",
    regular: "ธรรมดา",
    special: "พิเศษ",
    busyBanner: "ขณะนี้ร้านมีออเดอร์เยอะ อาหารอาจใช้เวลานานกว่าปกตินิดหน่อย",
    linkExpired: "ลิงก์หมดอายุแล้ว",
    linkExpiredMsg: "กรุณาสแกน QR code ที่โต๊ะของท่านอีกครั้งเพื่อสั่งอาหารต่อ",
    staffAccess: "พนักงาน",
    thb: "฿",
    popular: "เมนูเด่น",
    back: "ย้อนกลับ",
    eggAdded: "+ ไข่ดาว",
    freeLabel: "ฟรี",
    rounds: "รอบ",
    roundsPlural: "รอบ",
    items: "รายการ",
    spiceLevels: ["ไม่เผ็ด", "เผ็ดน้อย", "เผ็ดกลาง", "เผ็ดมาก"],
    meats: { pork: "หมู", chicken: "ไก่", beef: "เนื้อ" },
    meatEmoji: { pork: "🐷", chicken: "🐓", beef: "🥩" },
  },
};

// ─── Utility functions ────────────────────────────────────────────────────────

function resolvePhoto(photo: string, w = 400, h = 300): string {
  if (!photo) return "";
  if (photo.startsWith("data:")) return photo; // อัปโหลดเอง (Base64)
  return `https://images.unsplash.com/photo-${photo}?w=${w}&h=${h}&fit=crop&auto=format`;
}

function itemPrice(
  item: MenuItem,
  meat: MeatChoice | undefined,
  portion: Portion | undefined,
  addEgg: boolean,
  addOns: string[],
  customSelections: Record<string, string[]> = {}
): number {
  let price = item.price;
  if (meat && item.meatPriceDeltas?.[meat]) price += item.meatPriceDeltas[meat]!;
  if (portion === "special" && item.portionPriceDelta) price += item.portionPriceDelta;
  if (addEgg) price += 15;
  addOns.forEach((id) => {
    const found = ADD_ONS.find((a) => a.id === id);
    if (found) price += found.price;
  });
  item.customGroups?.forEach((group) => {
    const selected = customSelections[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) price += choice.priceDelta;
    });
  });
  return price;
}

function cartItemTotal(ci: CartItem): number {
  return itemPrice(ci.item, ci.meat, ci.portion, ci.addEgg, ci.addOns, ci.customSelections) * ci.quantity;
}

function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

function orderTotal(order: Order): number {
  return order.items.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

function cartItemKey(ci: CartItem): string {
  return JSON.stringify({
    id: ci.item.id,
    meat: ci.meat,
    portion: ci.portion,
    spiceLevel: ci.spiceLevel,
    addEgg: ci.addEgg,
    addOns: [...ci.addOns].sort(),
    customSelections: ci.customSelections,
    note: ci.note || "",
  });
}

function mergeIntoCart(cart: CartItem[], newItem: CartItem): CartItem[] {
  const key = cartItemKey(newItem);
  const idx = cart.findIndex((ci) => cartItemKey(ci) === key);
  if (idx === -1) return [...cart, newItem];
  const updated = [...cart];
  updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + newItem.quantity };
  return updated;
}

function formatOptionDetails(ci: CartItem, lang: Language): string {
  const t = T[lang];
  const parts: string[] = [];
  if (ci.meat) parts.push(t.meats[ci.meat]);
  if (ci.portion === "special") parts.push(t.special);
  if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(t.spiceLevels[ci.spiceLevel]);
  if (ci.addEgg) parts.push(t.eggAdded);
  ci.addOns.forEach((id) => {
    const addon = ADD_ONS.find((a) => a.id === id);
    if (addon) parts.push(lang === "en" ? addon.label.en : addon.label.th);
  });
  ci.item.customGroups?.forEach((group) => {
    const selected = ci.customSelections?.[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
    });
  });
  return parts.join(", ");
}

function parseTableKey(tn: string): [number, number] {
  const [floor, table] = tn.split("-").map(Number);
  return [floor || 0, table || 0];
}

function compareTables(a: string, b: string): number {
  const [af, at] = parseTableKey(a);
  const [bf, bt] = parseTableKey(b);
  return af !== bf ? af - bf : at - bt;
}

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  return `${mins} min ago`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// แปลงชื่อของเป็น id ที่ใช้เป็น Firestore doc id ได้ (ตัดอักขระที่ Firestore ไม่รับ)
// รายชื่อของที่ซื้อเข้าร้านมีจำกัด (ไม่กี่สิบ-ร้อยรายการ) จึงใช้ชื่อเป็น id ตรงๆ
// เพื่อกันไม่ให้มี doc ซ้ำสำหรับของชิ้นเดียวกัน
function expenseCatalogId(name: string): string {
  const cleaned = name.trim().replace(/[\/\\.#$\[\]\s]+/g, "-").slice(0, 120);
  return cleaned || uid();
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getTodayKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function compressImage(file: File, maxWidth = 600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function LannaBorder() {
  return (
    <div
      className="h-[3px] w-full flex-shrink-0"
      style={{
        background:
          "linear-gradient(90deg, #C05A25 0%, #D07E35 30%, #4A6741 50%, #D07E35 70%, #C05A25 100%)",
      }}
    />
  );
}

function RestaurantLogo({ dark = true, lang = "th" }: { dark?: boolean; lang?: Language }) {
  const textColor = dark ? "text-[#FFF8F0]" : "text-foreground";
  return (
    <div className="flex items-center gap-2">
      <img src={logo} alt="Hueanyong Kitchen" className="w-12 h-12 object-contain flex-shrink-0" />
      <div>
        <div className={`font-display font-semibold text-base leading-tight ${textColor}`}>
          {T[lang].appName}
        </div>
        <div className={`text-[10px] leading-tight opacity-70 ${textColor}`}>
          {T[lang].tagline}
        </div>
      </div>
    </div>
  );
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
    ci.addOns.forEach((id) => {
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

// ─── Staff Login Screen ───────────────────────────────────────────────────────

interface StaffLoginProps {
  lang: Language;
  onLogin: (pw: string) => void;
  onBack: () => void;
  error: boolean;
  onLangToggle: () => void;
}

function StaffLoginScreen({ lang, onLogin, onBack, error, onLangToggle }: StaffLoginProps) {
  const t = T[lang];
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414]">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">{t.staffLogin}</div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">
            {t.langSwitch}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-[#3C2414] rounded-full flex items-center justify-center mx-auto mb-5 p-4">
              <img src={logo} alt="Hueanyong Kitchen" className="w-full h-full object-contain" />
            </div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{t.staffLogin}</h1>
            <p className="text-muted-foreground text-sm mt-1">{T[lang].appName} — Staff Portal</p></div>

          <div className="relative mb-3">
            <input
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLogin(pw)}
              placeholder={t.password}
              className={`w-full bg-card border-2 rounded-xl px-4 py-3.5 text-foreground pr-12 outline-none transition-all ${error ? "border-destructive" : "border-border focus:border-primary"
                }`}
            />
            <button
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <p className="text-destructive text-sm mb-3 flex items-center gap-1.5">
              <span>⚠️</span> {t.wrongPass}
            </p>
          )}

          <button
            onClick={() => onLogin(pw)}
            className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-md"
          >
            {t.loginBtn}
          </button>

        </div>
      </div>
    </div>
  );
}

// ─── Staff Header (shared) ────────────────────────────────────────────────────

interface StaffHeaderProps {
  lang: Language;
  activeTab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses";
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

function StaffHeader({ lang, activeTab, onTabChange, onLogout, onLangToggle, }: StaffHeaderProps) {
  const t = T[lang];
  return (
    <div className="bg-[#3C2414] sticky top-0 z-50">
      <LannaBorder />
      <div className="px-4 py-2.5 flex items-center justify-between">
        <RestaurantLogo dark lang={lang} />
        <div className="flex items-center gap-1">
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs px-2 py-1 hover:text-[#FFF8F0] transition-colors">
            {t.langSwitch}
          </button>
          <button onClick={onLogout} className="text-[#E6D5BA]/50 hover:text-[#E6D5BA] transition-colors p-1.5">
            <LogOut size={17} />
          </button>
        </div>
      </div>
      <div className="flex px-4 pb-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {(["orders", "payment", "menu", "history", "expenses", "stats"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${activeTab === tab
              ? "border-[#D07E35] text-[#FFF8F0]"
              : "border-transparent text-[#E6D5BA]/60 hover:text-[#E6D5BA]"
              }`}
          >
            {tab === "orders" ? <Clock size={14} /> : tab === "payment" ? <CreditCard size={14} /> : tab === "menu" ? <Utensils size={14} /> : tab === "history" ? <CheckCircle size={14} /> : tab === "expenses" ? <Receipt size={14} /> : <Star size={14} />}
            {tab === "orders" ? t.staffOrders : tab === "payment" ? t.staffPayment : tab === "menu" ? (lang === "en" ? "Menu" : "จัดการเมนู") : tab === "history" ? (lang === "en" ? "History" : "ประวัติ") : tab === "expenses" ? (lang === "en" ? "Expenses" : "รายจ่าย") : (lang === "en" ? "Stats" : "สถิติ")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Staff Orders Screen ──────────────────────────────────────────────────────

interface StaffOrdersProps {
  lang: Language;
  orders: Order[];
  onMarkServed: (orderId: string) => void;
  onRemoveItem: (orderId: string, cartId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onStartManualOrder: () => void;
}

// ─── Kitchen Ticket (Print) ──────────────────────────────────────────────────

function kitchenOptionSummary(ci: CartItem, lang: Language): string {
  const parts: string[] = [];
  if (ci.meat) parts.push(T[lang].meats[ci.meat]);
  if (ci.portion === "special") parts.push(T[lang].special);
  if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
  if (ci.addEgg) parts.push(T[lang].eggAdded);
  ci.item.customGroups?.forEach((group) => {
    const selected = ci.customSelections?.[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
    });
  });
  return parts.join(", ");
}

/* ─── Bluetooth Thermal Printer (ESC/POS via BLE) — พักไว้ก่อน (ยังไม่เสถียร จับคู่ช้า) ───

const PRINTER_SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
const PRINTER_WIDTH_PX = 384; // 58mm ที่ 203dpi

let cachedPrinterDevice: any = null;

async function getPrinterCharacteristic() {
  if (!("bluetooth" in navigator)) {
    throw new Error("เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth (ต้องใช้ Chrome บน Android)");
  }
  let device = cachedPrinterDevice;
  if (!device || !device.gatt.connected) {
    device = await (navigator as any).bluetooth.requestDevice({
      filters: [{ services: [PRINTER_SERVICE_UUID] }],
    });
    cachedPrinterDevice = device;
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  return await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);
}

function renderTicketToCanvas(order: Order, lang: Language): HTMLCanvasElement {
  type Line = { text: string; size: number; bold?: boolean; align?: "left" | "center" };
  const lines: Line[] = [];

  lines.push({ text: T[lang].appName, size: 22, bold: true, align: "center" });
  const label = order.isTakeaway
    ? order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน")
    : `${T[lang].tableLabel} ${order.tableNumber}`;
  lines.push({ text: label, size: 28, bold: true, align: "center" });
  lines.push({ text: order.timestamp.toLocaleString(lang === "th" ? "th-TH" : "en-US"), size: 16, align: "center" });
  lines.push({ text: "-".repeat(30), size: 16, align: "left" });

  order.items.forEach((ci) => {
    lines.push({ text: `${ci.quantity}x ${lang === "en" ? ci.item.name.en : ci.item.name.th}`, size: 22, bold: true, align: "left" });
    const opt = kitchenOptionSummary(ci, lang);
    if (opt) lines.push({ text: "   " + opt, size: 16, align: "left" });
    if (ci.note) lines.push({ text: `   "${ci.note}"`, size: 16, align: "left" });
  });
  lines.push({ text: "-".repeat(30), size: 16, align: "left" });

  const lineGap = 6;
  let totalHeight = 20;
  lines.forEach((l) => { totalHeight += l.size + lineGap; });

  const canvas = document.createElement("canvas");
  canvas.width = PRINTER_WIDTH_PX;
  canvas.height = totalHeight + 20;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";

  let y = 14;
  lines.forEach((l) => {
    ctx.font = `${l.bold ? "bold " : ""}${l.size}px 'Tahoma', sans-serif`;
    ctx.textBaseline = "top";
    let x = 8;
    if (l.align === "center") {
      const w = ctx.measureText(l.text).width;
      x = Math.max(8, (canvas.width - w) / 2);
    }
    ctx.fillText(l.text, x, y);
    y += l.size + lineGap;
  });

  return canvas;
}

function canvasToEscPosRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const bitmap = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const brightness = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
      if (brightness < 128) {
        bitmap[y * widthBytes + (x >> 3)] |= 0x80 >> (x % 8);
      }
    }
  }

  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  const feed = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]); // เลื่อนกระดาษออกมาให้ฉีกง่าย

  const result = new Uint8Array(header.length + bitmap.length + feed.length);
  result.set(header, 0);
  result.set(bitmap, header.length);
  result.set(feed, header.length + bitmap.length);
  return result;
}

async function writeInChunks(characteristic: any, data: Uint8Array, chunkSize = 180) {
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await characteristic.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function printKitchenTicketBLE(order: Order, lang: Language) {
  try {
    const characteristic = await getPrinterCharacteristic();
    const canvas = renderTicketToCanvas(order, lang);
    const escposData = canvasToEscPosRaster(canvas);
    await writeInChunks(characteristic, escposData);
  } catch (err: any) {
    alert("พิมพ์ไม่สำเร็จ: " + err.message);
  }
}

*/

// ─── Receipt (Print) ─────────────────────────────────────────────────────────

interface ReceiptData {
  label: string;
  items: CartItem[];
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number;
}

function ReceiptTicket({ data, lang }: { data: ReceiptData; lang: Language }) {
  const t = T[lang];
  const now = new Date();
  const change = data.paymentMethod === "cash" && data.cashReceived != null ? data.cashReceived - data.total : undefined;

  return (
    <div id="receipt-print">
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <img src={logoImg} alt="" style={{ width: "15mm", display: "block", margin: "0 auto" }} />
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "16px", marginBottom: "2px" }}>
        {t.appName}
      </div>
      <div style={{ textAlign: "center", fontSize: "12px", marginBottom: "2px" }}>
        {data.label}
      </div>
      <div style={{ textAlign: "center", fontSize: "11px", marginBottom: "6px" }}>
        {now.toLocaleString(lang === "th" ? "th-TH" : "en-US")}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      {data.items.map((ci, idx) => (
        <div key={idx} style={{ marginBottom: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span>{ci.quantity}x {lang === "en" ? ci.item.name.en : ci.item.name.th}</span>
            <span>{t.thb}{cartItemTotal(ci)}</span>
          </div>
          {formatOptionDetails(ci, lang) && (
            <div style={{ fontSize: "12px", marginLeft: "14px" }}>
              {formatOptionDetails(ci, lang)}
            </div>
          )}
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "16px", marginBottom: "6px" }}>
        <span>{lang === "en" ? "Total" : "รวมทั้งหมด"}</span>
        <span>{t.thb}{data.total}</span>
      </div>
      <div style={{ fontSize: "12px", marginBottom: "2px" }}>
        {lang === "en" ? "Payment" : "ชำระโดย"}: {data.paymentMethod === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน")}
      </div>
      {data.paymentMethod === "cash" && data.cashReceived != null && (
        <>
          <div style={{ fontSize: "12px", marginBottom: "2px" }}>
            {lang === "en" ? "Received" : "รับเงิน"}: {t.thb}{data.cashReceived}
          </div>
          <div style={{ fontSize: "12px", marginBottom: "6px" }}>
            {lang === "en" ? "Change" : "เงินทอน"}: {t.thb}{change}
          </div>
        </>
      )}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <div style={{ textAlign: "center", fontSize: "12px" }}>
        {lang === "en" ? "Thank you for your visit" : "ขอบคุณที่ใช้บริการค่ะ"}
      </div>
    </div>
  );
}

function KitchenTicket({ order, lang }: { order: Order; lang: Language }) {
  const label = order.isTakeaway
    ? order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน")
    : `${T[lang].tableLabel} ${order.tableNumber}`;

  return (
    <div id="kitchen-ticket-print">
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>
        {T[lang].appName}
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "20px", marginBottom: "2px" }}>
        {label}
      </div>
      <div style={{ textAlign: "center", fontSize: "11px", marginBottom: "6px" }}>
        {order.timestamp.toLocaleString(lang === "th" ? "th-TH" : "en-US")}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      {order.items.map((ci) => (
        <div key={ci.cartId} style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", fontSize: "20px", fontWeight: 700 }}>
            <span style={{ marginRight: "6px" }}>{ci.quantity}x</span>
            <span>{lang === "en" ? ci.item.name.en : ci.item.name.th}</span>
          </div>
          {kitchenOptionSummary(ci, lang) && (
            <div style={{ fontSize: "18px", marginLeft: "20px" }}>
              {kitchenOptionSummary(ci, lang)}
            </div>
          )}
          {ci.note && (
            <div style={{ fontSize: "18px", marginLeft: "20px", fontStyle: "italic" }}>
              "{ci.note}"
            </div>
          )}
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
    </div>
  );
}

function StaffOrdersScreen({ lang, orders, onMarkServed, onRemoveItem, onCancelOrder, onTabChange, onLogout, onLangToggle, onAskConfirm, onStartManualOrder }: StaffOrdersProps) {
  const t = T[lang];
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const handlePrintKitchen = (order: Order) => {
    setPrintOrder(order);
    // รอให้ React render เนื้อหาก่อนค่อยสั่งพิมพ์
    setTimeout(() => window.print(), 50);
  };
  const takeawayOrders = orders.filter((o) => o.isTakeaway && o.status === "in-progress");
  const inProgress = orders.filter((o) => o.status === "in-progress" && !o.isTakeaway);
  const awaitingPayment = orders.filter((o) => o.status === "awaiting-payment" && !o.isTakeaway);

  // Group awaiting orders by table
  const awaitingByTable: Record<string, { orders: Order[]; total: number }> = {};
  awaitingPayment.forEach((o) => {
    if (!awaitingByTable[o.tableNumber]) {
      awaitingByTable[o.tableNumber] = { orders: [], total: 0 };
    }
    awaitingByTable[o.tableNumber].orders.push(o);
    awaitingByTable[o.tableNumber].total += orderTotal(o);
  });
  const awaitingTables = Object.entries(awaitingByTable)
    .sort(([a], [b]) => compareTables(a, b));

  function optionSummary(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(T[lang].meats[ci.meat]);
    if (ci.portion === "special") parts.push(t.special);
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(t.eggAdded);
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(", ");
  }

  return (
    <>
      <div className="min-h-screen bg-background flex flex-col">
        <StaffHeader
          lang={lang}
          activeTab="orders"
          onTabChange={onTabChange}
          onLogout={onLogout}
          onLangToggle={onLangToggle}
        />

        <div
          className="flex-1 px-4 py-5 overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >

          <button
            onClick={onStartManualOrder}
            className="w-full mb-5 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {lang === "en" ? "Create Order for Table" : "สร้างออเดอร์ให้โต๊ะ"}
          </button>

          {/* ปุ่มทดสอบพิมพ์จริงผ่าน Bluetooth (BLE) — พักไว้ก่อน ยังจับคู่ช้าอยู่ ค่อยกลับมาแก้ต่อ
          <button
            onClick={() => {
              const testOrder = [...takeawayOrders, ...inProgress][0];
              if (!testOrder) { alert("ยังไม่มีออเดอร์ให้ทดสอบพิมพ์ ลองสร้างออเดอร์ก่อน"); return; }
              printKitchenTicketBLE(testOrder, lang);
            }}
            className="w-full mb-5 bg-muted text-foreground py-2.5 rounded-xl font-semibold text-xs hover:bg-muted/80 transition-all active:scale-95"
          >
            🖨️ ทดสอบพิมพ์จริง (BLE)
          </button>
          */}

          {/* Takeaway orders */}
          {takeawayOrders.length > 0 && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-accent" />
                <h2 className="font-semibold text-foreground">{lang === "en" ? "Takeaway" : "กลับบ้าน"}</h2>
                <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                  {takeawayOrders.length}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {takeawayOrders.map((order) => (
                  <div key={order.id} className="bg-card rounded-2xl border-2 overflow-hidden" style={{ borderColor: "rgba(208, 126, 53, 0.4)" }}>
                    <div className="px-4 py-3 flex items-center justify-between border-b" style={{ background: "rgba(208, 126, 53, 0.08)", borderColor: "rgba(208, 126, 53, 0.15)" }}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-accent text-accent-foreground font-display font-bold text-sm rounded-full flex items-center justify-center flex-shrink-0">
                          {order.takeawayLabel}
                        </div>
                        <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                      </div>
                      <button
                        onClick={() => { if (window.confirm(t.confirmCancelOrder)) onCancelOrder(order.id); }}
                        className="text-destructive/60 hover:text-destructive transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      {order.items.map((ci) => (
                        <div key={ci.cartId} className="flex items-start gap-2.5">
                          <div className="bg-primary/15 text-primary font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                            {ci.quantity}
                          </div>
                          <div className="text-foreground text-sm font-medium leading-tight">
                            {lang === "en" ? ci.item.name.en : ci.item.name.th}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => onMarkServed(order.id)}
                        className="w-full bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Check size={15} />
                        {lang === "en" ? "Ready for pickup" : "พร้อมรับแล้ว"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* In Progress */}
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <h2 className="font-semibold text-foreground">{t.inProgress}</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                {inProgress.length}
              </span>
            </div>

            {inProgress.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
                {t.noActiveOrders}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {inProgress.map((order) => (
                  <div
                    key={order.id}
                    className="bg-card rounded-2xl border-2 overflow-hidden"
                    style={{ borderColor: "rgba(217, 119, 6, 0.3)" }}
                  >
                    {/* Order header */}
                    <div
                      className="px-4 py-3 flex items-center justify-between border-b"
                      style={{ background: "rgba(251, 191, 36, 0.08)", borderColor: "rgba(217, 119, 6, 0.15)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#3C2414] text-[#FFF8F0] font-display font-bold text-lg rounded-full flex items-center justify-center flex-shrink-0">
                          {order.tableNumber}
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t.tableLabel}</div>
                          <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <Clock size={12} />
                          <span>{formatClock(order.timestamp)}</span>
                        </div>
                        <button
                          onClick={() => onAskConfirm(t.confirmCancelOrder, () => onCancelOrder(order.id))}
                          className="text-destructive/60 hover:text-destructive transition-colors"
                          title={t.cancelOrder}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Items */}
                    <div className="px-4 py-3 space-y-2.5">
                      {order.items.map((ci) => (
                        <div key={ci.cartId} className="flex items-start gap-2.5">
                          <div className="bg-primary/15 text-primary font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                            {ci.quantity}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground text-sm font-medium leading-tight">
                              {lang === "en" ? ci.item.name.en : ci.item.name.th}
                            </div>
                            {optionSummary(ci) && (
                              <div className="text-muted-foreground text-xs mt-0.5">{optionSummary(ci)}</div>
                            )}
                            {ci.note && (
                              <div className="text-amber-700 text-xs mt-0.5 italic">"{ci.note}"</div>
                            )}
                          </div>
                          <button
                            onClick={() => onAskConfirm(t.confirmRemoveItem, () => onRemoveItem(order.id, ci.cartId))}
                            className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 mt-0.5"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Action */}
                    <div className="px-4 pb-4 flex gap-2">
                      <button
                        onClick={() => handlePrintKitchen(order)}
                        className="flex-shrink-0 bg-muted text-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-muted/80 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Printer size={15} />
                      </button>
                      <button
                        onClick={() => onMarkServed(order.id)}
                        className="flex-1 bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Check size={15} />
                        {t.markServed}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Awaiting Payment */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
              <h2 className="font-semibold text-foreground">{t.awaitingPayment}</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                {awaitingTables.length}
              </span>
            </div>

            {awaitingTables.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
                {t.noTablesWaiting}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {awaitingTables.map(([tableNum, data]) => (
                  <div
                    key={tableNum}
                    className="bg-card rounded-2xl border-2 overflow-hidden opacity-80"
                    style={{ borderColor: "rgba(74, 103, 65, 0.3)" }}
                  >
                    <div
                      className="px-4 py-3 flex items-center justify-between border-b"
                      style={{ background: "rgba(74, 103, 65, 0.06)", borderColor: "rgba(74, 103, 65, 0.15)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary text-secondary-foreground font-display font-bold text-lg rounded-full flex items-center justify-center flex-shrink-0">
                          {tableNum}
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t.tableLabel}</div>
                          <div className="text-muted-foreground text-sm">
                            {data.orders.length} {data.orders.length === 1 ? t.rounds : t.roundsPlural}
                          </div>
                        </div>
                      </div>
                      <div className="font-display font-bold text-xl text-foreground">
                        {t.thb}{data.total}
                      </div>
                    </div>
                    <div className="px-4 py-2.5">
                      <div className="text-xs text-muted-foreground">
                        {data.orders.reduce((s, o) => s + o.items.length, 0)} {t.items} · {t.awaitingPayment}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {printOrder && <KitchenTicket order={printOrder} lang={lang} />}
    </>
  );
}

// ─── Staff Payment Screen ─────────────────────────────────────────────────────

interface StaffPaymentProps {
  lang: Language;
  orders: Order[];
  onCloseTable: (n: string, paymentMethod: PaymentMethod, cashReceived?: number) => void;
  onCloseTakeaway: (orderId: string, paymentMethod: PaymentMethod, cashReceived?: number) => void;
  onAdjustItem: (contributingOrders: Order[], key: string, delta: number) => void;
  onAdjustTakeawayItem: (orderId: string, key: string, delta: number) => void;
  onCancelOrder: (orderId: string) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

interface PaymentCardProps {
  keyId: string;
  label: string;
  subtitle: string;
  total: number;
  items: CartItem[];
  onAdjust: (key: string, delta: number) => void;
  total2: number;
  closeAction: () => void;
  cancelAction?: () => void;
  printReceiptAction?: () => void;
  expandedKey: string | null;
  select: (key: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  cashInput: string;
  setCashInput: (v: string) => void;
  lang: Language;
  t: typeof T["en"];
}

function PaymentCard({
  keyId, label, subtitle, total, items, onAdjust, total2, closeAction, cancelAction, printReceiptAction,
  expandedKey, select, paymentMethod, setPaymentMethod, cashInput, setCashInput, lang, t,
}: PaymentCardProps) {
  const isSelected = expandedKey === keyId;
  return (
    <div className="bg-card rounded-2xl border-2 overflow-hidden" style={{ borderColor: isSelected ? "rgba(192,90,37,0.6)" : "rgba(60,36,20,0.15)" }}>
      <button onClick={() => select(keyId)} className="w-full px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#3C2414] text-[#FFF8F0] font-display font-bold text-sm rounded-full flex items-center justify-center flex-shrink-0">
            {label}
          </div>
          <div className="text-left">
            <div className="text-foreground text-sm font-medium">{subtitle}</div>
          </div>
        </div>
        <div className="font-display font-bold text-lg text-primary">{t.thb}{total}</div>
      </button>

      {isSelected && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          <div className="space-y-2 mb-3">
            {items.map((ci, ciIdx) => {
              const key = cartItemKey(ci);
              return (
                <div key={ciIdx} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => onAdjust(key, -1)} className="w-6 h-6 rounded-full bg-muted flex items-center justify-center hover:bg-destructive/10 transition-all">
                        <Minus size={12} />
                      </button>
                      <span className="text-muted-foreground text-sm font-medium w-6 text-center">{ci.quantity}</span>
                      <button onClick={() => onAdjust(key, 1)} className="w-6 h-6 rounded-full bg-muted flex items-center justify-center hover:bg-primary/10 transition-all">
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="min-w-0">
                      <div className="text-foreground text-sm font-medium truncate">
                        {lang === "en" ? ci.item.name.en : ci.item.name.th}
                      </div>
                      {formatOptionDetails(ci, lang) && (
                        <div className="text-muted-foreground text-xs">{formatOptionDetails(ci, lang)}</div>
                      )}
                    </div>
                  </div>
                  <span className="text-foreground font-semibold text-sm flex-shrink-0 ml-2">{t.thb}{cartItemTotal(ci)}</span>
                </div>
              );
            })}
          </div>

          {cancelAction && (
            <button onClick={cancelAction} className="text-destructive/70 hover:text-destructive text-xs font-medium mb-3">
              {t.cancelOrder}
            </button>
          )}

          <div className="flex gap-2 mb-3">
            {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => { setPaymentMethod(m); setCashInput(""); }}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all ${paymentMethod === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-foreground"
                  }`}
              >
                {m === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน")}
              </button>
            ))}
          </div>

          {paymentMethod === "cash" && (
            <div className="mb-3">
              <input
                type="text"
                inputMode="numeric"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={lang === "en" ? "Cash received" : "รับเงินมา"}
                className="w-full bg-background border-2 border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {cashInput !== "" && (
                <div className={`text-sm font-semibold mt-1.5 ${Number(cashInput) >= total2 ? "text-secondary" : "text-destructive"}`}>
                  {Number(cashInput) >= total2
                    ? `${lang === "en" ? "Change" : "เงินทอน"}: ${t.thb}${Number(cashInput) - total2}`
                    : (lang === "en" ? "Amount not enough" : "จำนวนเงินไม่พอ")}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {printReceiptAction && (
              <button
                onClick={printReceiptAction}
                disabled={paymentMethod === "cash" && (cashInput === "" || Number(cashInput) < total2)}
                className="flex-shrink-0 bg-muted text-foreground px-4 py-3 rounded-xl text-sm font-semibold hover:bg-muted/80 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer size={16} />
              </button>
            )}
            <button
              onClick={closeAction}
              disabled={paymentMethod === "cash" && (cashInput === "" || Number(cashInput) < total2)}
              className="flex-1 bg-secondary text-secondary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={16} />
              {t.closeTable}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffPaymentScreen({
  lang, orders, onCloseTable, onCloseTakeaway, onAdjustItem, onAdjustTakeawayItem,
  onCancelOrder, onAskConfirm, onTabChange, onLogout, onLangToggle,
}: StaffPaymentProps) {
  const t = T[lang];
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [printReceiptData, setPrintReceiptData] = useState<ReceiptData | null>(null);

  const handlePrintReceipt = (data: ReceiptData) => {
    setPrintReceiptData(data);
    const img = new Image();
    img.src = logoImg;
    const doPrint = () => setTimeout(() => window.print(), 50);
    if (img.complete) {
      doPrint();
    } else {
      img.onload = doPrint;
      img.onerror = doPrint; // ถ้าโหลดรูปไม่สำเร็จ ก็ยังปริ้นต่อได้ (แค่ไม่มีโลโก้)
    }
  };

  const select = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
    setPaymentMethod("cash");
    setCashInput("");
  };

  const awaitingPayment = orders.filter((o) => o.status === "awaiting-payment" && !o.isTakeaway);
  const takeawayAwaiting = orders.filter((o) => o.status === "awaiting-payment" && o.isTakeaway);

  const tableNumbers = [...new Set(awaitingPayment.map((o) => o.tableNumber))].sort(compareTables);
  const tableGroups = tableNumbers.map((tn) => {
    const tableOrders = awaitingPayment.filter((o) => o.tableNumber === tn);
    const allItems = tableOrders.flatMap((o) => o.items);
    const groupedItems = (() => {
      const map = new Map<string, CartItem>();
      allItems.forEach((ci) => {
        const key = cartItemKey(ci);
        const existing = map.get(key);
        map.set(key, existing ? { ...existing, quantity: existing.quantity + ci.quantity } : { ...ci });
      });
      return Array.from(map.values());
    })();
    return {
      tableNumber: tn,
      orders: tableOrders,
      items: groupedItems,
      total: tableOrders.reduce((s, o) => s + orderTotal(o), 0),
      itemCount: allItems.reduce((s, ci) => s + ci.quantity, 0),
      rounds: tableOrders.length,
    };
  });

  return (
    <>
      <div className="min-h-screen bg-background flex flex-col">
        <StaffHeader lang={lang} activeTab="payment" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />
        <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {tableGroups.length === 0 && takeawayAwaiting.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
                <CreditCard className="text-muted-foreground/50" size={34} />
              </div>
              <p className="text-muted-foreground text-sm">{t.noTablesWaiting}</p>
            </div>
          ) : (
            <>
              {tableGroups.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-foreground text-sm mb-3">
                    {lang === "en" ? "Dine-in — Awaiting Payment" : "ในร้าน — รอชำระเงิน"}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {tableGroups.map((g) => (
                      <PaymentCard
                        key={g.tableNumber}
                        keyId={`table:${g.tableNumber}`}
                        label={g.tableNumber}
                        subtitle={`${g.rounds} ${g.rounds === 1 ? t.rounds : t.roundsPlural} · ${g.itemCount} ${t.items}`}
                        total={g.total}
                        total2={g.total}
                        items={g.items}
                        onAdjust={(key, delta) => onAdjustItem(g.orders, key, delta)}
                        closeAction={() => onCloseTable(g.tableNumber, paymentMethod, paymentMethod === "cash" ? Number(cashInput || 0) : undefined)}
                        printReceiptAction={() =>
                          handlePrintReceipt({
                            label: `${t.tableLabel} ${g.tableNumber}`,
                            items: g.items,
                            total: g.total,
                            paymentMethod,
                            cashReceived: paymentMethod === "cash" ? Number(cashInput || 0) : undefined,
                          })
                        }
                        cancelAction={() =>
                          onAskConfirm(t.confirmCancelOrder, () => {
                            g.orders.forEach((o) => onCancelOrder(o.id));
                            setExpandedKey(null);
                          })
                        }
                        expandedKey={expandedKey}
                        select={select}
                        paymentMethod={paymentMethod}
                        setPaymentMethod={setPaymentMethod}
                        cashInput={cashInput}
                        setCashInput={setCashInput}
                        lang={lang}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              )}

              {takeawayAwaiting.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-foreground text-sm mb-3">
                    {lang === "en" ? "Takeaway — Awaiting Payment" : "กลับบ้าน — รอชำระเงิน"}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {takeawayAwaiting.map((order) => (
                      <PaymentCard
                        key={order.id}
                        keyId={`takeaway:${order.id}`}
                        label={order.takeawayLabel || "T"}
                        subtitle={`${order.items.reduce((s, ci) => s + ci.quantity, 0)} ${t.items}`}
                        total={orderTotal(order)}
                        total2={orderTotal(order)}
                        items={order.items}
                        onAdjust={(key, delta) => onAdjustTakeawayItem(order.id, key, delta)}
                        closeAction={() => onCloseTakeaway(order.id, paymentMethod, paymentMethod === "cash" ? Number(cashInput || 0) : undefined)}
                        printReceiptAction={() =>
                          handlePrintReceipt({
                            label: order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน"),
                            items: order.items,
                            total: orderTotal(order),
                            paymentMethod,
                            cashReceived: paymentMethod === "cash" ? Number(cashInput || 0) : undefined,
                          })
                        }
                        cancelAction={() => onAskConfirm(t.confirmCancelOrder, () => { onCancelOrder(order.id); setExpandedKey(null); })}
                        expandedKey={expandedKey}
                        select={select}
                        paymentMethod={paymentMethod}
                        setPaymentMethod={setPaymentMethod}
                        cashInput={cashInput}
                        setCashInput={setCashInput}
                        lang={lang}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {printReceiptData && <ReceiptTicket data={printReceiptData} lang={lang} />}
    </>
  );
}

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
  onToggleActive: (item: MenuItem, active: boolean) => void;
  onDelete: (itemId: string) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  categories: Category[];
  onAddCategory: (nameEn: string, nameTh: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onToggleCategorySignature: (categoryId: string, signature: boolean) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onReorderMenuItems: (categoryId: string, orderedIds: string[]) => void;
  scrollTopRef: React.MutableRefObject<number>;   // ⭐ เพิ่มบรรทัดนี้
}

function StaffMenuScreen({
  lang, items, onAdd, onEdit, onToggleActive, onDelete, onTabChange, onLogout, onLangToggle, onAskConfirm, categories, onAddCategory, onDeleteCategory, onToggleCategorySignature, onReorderCategories, onReorderMenuItems,
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
              onToggleActive={onToggleActive}
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

// รายการเมนูภายในหมวดหมู่เดียว แยกเป็นคอมโพเนนต์ต่างหาก
// เพื่อให้เรียก useDragReorder ได้อย่างถูกต้องตาม Rules of Hooks (1 instance ต่อ 1 หมวดหมู่)
function CategoryMenuItemsList({
  lang, t, cat, catItems, onReorderMenuItems, onToggleActive, onEdit, onDelete, onAskConfirm,
}: {
  lang: Language;
  t: (typeof T)["en"];
  cat: Category;
  catItems: (MenuItem & { active?: boolean })[];
  onReorderMenuItems: (categoryId: string, orderedIds: string[]) => void;
  onToggleActive: (item: MenuItem, active: boolean) => void;
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
        {itemDrag.orderedList.map((item) => (
          <div
            key={item.id}
            ref={itemDrag.setItemRef(item.id)}
            className={`bg-card rounded-xl border border-border p-3 flex items-center gap-3 transition-shadow ${item.active === false ? "opacity-50" : ""
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
            <button
              onClick={() => onToggleActive(item, item.active === false)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${item.active === false
                ? "bg-muted text-muted-foreground"
                : "bg-secondary/15 text-secondary"
                }`}
            >
              {item.active === false ? (lang === "en" ? "Off" : "ปิด") : (lang === "en" ? "On" : "เปิด")}
            </button>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffManualTableScreen({
  lang, onSelect, onSelectTakeaway, onCancel, onLangToggle,
}: { lang: Language; onSelect: (tn: string) => void; onSelectTakeaway: () => void; onCancel: () => void; onLangToggle: () => void }) {
  const t = T[lang];
  const floors: { floor: number; tables: number }[] = [
    { floor: 1, tables: 5 },
    { floor: 2, tables: 9 },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {lang === "en" ? "Select Table" : "เลือกโต๊ะ"}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full">
        <button
          onClick={onSelectTakeaway}
          className="w-full mb-6 py-4 rounded-2xl bg-accent/15 border-2 border-accent text-accent font-semibold text-base hover:bg-accent/25 transition-all active:scale-95"
        >
          {lang === "en" ? "Takeaway (no table)" : "กลับบ้าน (ไม่มีโต๊ะ)"}
        </button>

        {floors.map((f) => (
          <div key={f.floor} className="mb-6">
            <h3 className="font-semibold text-foreground text-sm mb-3">
              {lang === "en" ? `Floor ${f.floor}` : `ชั้น ${f.floor}`}
            </h3>
            <div className="grid grid-cols-4 gap-2.5">
              {Array.from({ length: f.tables }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => onSelect(`${f.floor}-${n}`)}
                  className="aspect-square rounded-2xl text-lg font-semibold bg-card text-foreground border border-border hover:border-primary/40 hover:bg-primary/5 active:scale-95 transition-all"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface StaffMenuEditProps {
  lang: Language;
  item: MenuItem;
  onSave: (item: MenuItem) => void;
  onCancel: () => void;
  onLangToggle: () => void;
  categories: Category[];
}

function StaffMenuEditScreen({ lang, item, onSave, onCancel, onLangToggle, categories, }: StaffMenuEditProps) {
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

interface StaffHistoryProps {
  lang: Language;
  orders: Order[];
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

interface HistoryEntry {
  tableNumber: string;
  isTakeaway?: boolean;
  takeawayLabel?: string;
  timestamp: Date;
  orders: Order[];
  total: number;
  itemCount: number;
}

function StaffHistoryScreen({ lang, orders, onTabChange, onLogout, onLangToggle }: StaffHistoryProps) {
  const t = T[lang];
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const toggleDay = (key: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const paidOrders = orders
    .filter((o) => o.status === "paid")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  function dateLabel(date: Date): string {
    return date.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  // รวมออเดอร์ที่ปิดพร้อมกัน (มี paymentBatchId เดียวกัน) เป็นรายการเดียว
  // ออเดอร์เก่าที่ไม่มี paymentBatchId จะแสดงแยกแบบเดิม ไม่กระทบข้อมูลเก่า
  const entryMap = new Map<string, HistoryEntry>();
  paidOrders.forEach((o) => {
    const key = o.paymentBatchId || o.id;
    const existing = entryMap.get(key);
    if (existing) {
      existing.orders.push(o);
      existing.total += orderTotal(o);
      existing.itemCount += o.items.reduce((s, ci) => s + ci.quantity, 0);
      if (o.timestamp < existing.timestamp) existing.timestamp = o.timestamp;
    } else {
      entryMap.set(key, {
        tableNumber: o.tableNumber,
        isTakeaway: o.isTakeaway,
        takeawayLabel: o.takeawayLabel,
        timestamp: o.timestamp,
        orders: [o],
        total: orderTotal(o),
        itemCount: o.items.reduce((s, ci) => s + ci.quantity, 0),
      });
    }
  });
  const entries = Array.from(entryMap.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const grouped: Record<string, HistoryEntry[]> = {};
  entries.forEach((e) => {
    const key = dateLabel(e.timestamp);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="history" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {paidOrders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {lang === "en" ? "No completed orders yet" : "ยังไม่มีออเดอร์ที่เสร็จสิ้น"}
          </div>
        ) : (
          Object.entries(grouped).map(([dateStr, dayEntries]) => {
            const dayTotal = dayEntries.reduce((s, e) => s + e.total, 0);
            const isDayCollapsed = !expandedDays.has(dateStr);
            return (
              <div key={dateStr} className="mb-6">
                <button
                  onClick={() => toggleDay(dateStr)}
                  className="w-full flex items-center justify-between mb-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    {isDayCollapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    <h3 className="font-semibold text-foreground text-sm">{dateStr}</h3>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {dayEntries.length} {t.rounds} · {t.thb}{dayTotal}
                  </span>
                </button>
                {!isDayCollapsed && (
                  <div className="space-y-2">
                    {dayEntries.map((e, idx) => {
                      const entryKey = `${dateStr}-${idx}`;
                      const isExpanded = expandedEntry === entryKey;
                      return (
                        <div key={idx} className="bg-card rounded-xl border border-border overflow-hidden">
                          <button
                            onClick={() => setExpandedEntry(isExpanded ? null : entryKey)}
                            className="w-full p-3 flex items-center justify-between"
                          >
                            <div className="text-left">
                              <div className="text-sm font-medium text-foreground">
                                {e.isTakeaway ? e.takeawayLabel : `${t.tableLabel} ${e.tableNumber}`}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {formatClock(e.timestamp)} · {e.itemCount} {t.items}
                                {e.orders.length > 1 ? ` · ${e.orders.length} ${e.orders.length === 1 ? t.rounds : t.roundsPlural}` : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="font-semibold text-primary text-sm">{t.thb}{e.total}</div>
                              {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-border space-y-1.5">
                              {e.orders.flatMap((o) => o.items).map((ci, ciIdx) => (
                                <div key={ciIdx} className="flex items-start justify-between text-sm">
                                  <div>
                                    <div className="text-foreground">
                                      {ci.quantity}× {lang === "en" ? ci.item.name.en : ci.item.name.th}
                                    </div>
                                    {formatOptionDetails(ci, lang) && (
                                      <div className="text-muted-foreground text-xs">{formatOptionDetails(ci, lang)}</div>
                                    )}
                                  </div>
                                  <span className="text-muted-foreground flex-shrink-0">{t.thb}{cartItemTotal(ci)}</span>
                                </div>
                              ))}
                              {e.orders[0]?.paymentMethod && (
                                <div className="text-muted-foreground text-xs pt-1">
                                  {e.orders[0].paymentMethod === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน")}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Staff Expenses Screen (บัญชีรายจ่าย) ──────────────────────────────────────

interface StaffExpensesProps {
  lang: Language;
  expenseDays: ExpenseDay[];
  catalog: ExpenseCatalogEntry[];
  onAddItem: (date: string, item: ExpenseLineItem) => void;
  onDeleteItem: (date: string, index: number) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

function StaffExpensesScreen({
  lang, expenseDays, catalog, onAddItem, onDeleteItem, onAskConfirm, onTabChange, onLogout, onLangToggle,
}: StaffExpensesProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");

  const sortedCatalog = [...catalog].sort((a, b) => b.usageCount - a.usageCount);
  const currentDay = expenseDays.find((e) => e.id === selectedDate);
  const dayItems = currentDay?.items || [];
  const dayTotal = currentDay?.totalAmount || 0;

  // ถ้าพิมพ์ชื่อตรงกับของที่เคยกรอกไว้เป๊ะ (เลือกจาก autocomplete) เติมหน่วย/จำนวน/ราคาล่าสุดให้อัตโนมัติ แก้ไขได้
  const handleNameChange = (value: string) => {
    setName(value);
    const match = catalog.find((c) => c.name === value);
    if (match) {
      setUnit(match.unit || "");
      if (!quantity) setQuantity(match.lastQuantity ? String(match.lastQuantity) : "");
      if (!amount) setAmount(match.lastAmount ? String(match.lastAmount) : "");
    }
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    const qty = parseFloat(quantity);
    const amt = parseFloat(amount);
    if (!trimmedName || !qty || qty <= 0 || isNaN(amt) || amt < 0) return;
    onAddItem(selectedDate, {
      name: trimmedName,
      quantity: qty,
      unit: unit.trim() || undefined,
      amount: amt,
    });
    setName("");
    setQuantity("");
    setUnit("");
    setAmount("");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="expenses" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-stretch gap-2 mb-5">
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={() => setSelectedDate(today)}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex items-center justify-center flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
        </div>

        {/* ฟอร์มกรอกของที่ซื้อ */}
        <div className="bg-card border border-border rounded-xl p-3 mb-6">
          <h3 className="font-semibold text-foreground text-sm mb-2.5">
            {lang === "en" ? "Add Purchase" : "บันทึกของที่ซื้อ"}
          </h3>
          <input
            list="expense-catalog-list"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={lang === "en" ? "Item name (e.g. eggs, veggies)" : "ชื่อของ (เช่น ไข่ไก่, ผัก)"}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary mb-2"
          />
          <datalist id="expense-catalog-list">
            {sortedCatalog.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={lang === "en" ? "Qty" : "จำนวน"}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={lang === "en" ? "Unit" : "หน่วย"}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t.thb + (lang === "en" ? " Price" : " ราคา")}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleAdd}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {lang === "en" ? "Add Item" : "เพิ่มรายการ"}
          </button>
        </div>

        {/* สรุปรายการที่ซื้อของวันที่เลือก — โชว์ในหน้าเดียวแบบใบเสร็จ ไม่ต้องเลื่อนอ่านทีละรายการ */}
        <div className="bg-card border border-border rounded-xl p-4 font-mono">
          <div className="text-center mb-2">
            <div className="font-semibold text-foreground text-sm">
              {lang === "en" ? "Purchase List" : "รายการที่ซื้อ"}
            </div>
            <div className="text-muted-foreground text-xs">{selectedDate}</div>
          </div>

          <div className="border-t border-dashed border-border my-2" />

          {dayItems.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-xs">
              {lang === "en" ? "No purchases logged for this date" : "ยังไม่มีรายการซื้อของวันนี้"}
            </div>
          ) : (
            <div className="space-y-2">
              {dayItems.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate">{it.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {it.quantity}{it.unit ? ` ${it.unit}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-foreground">{t.thb}{it.amount}</div>
                    <button
                      onClick={() =>
                        onAskConfirm(
                          lang === "en" ? "Delete this item?" : "ลบรายการนี้?",
                          () => onDeleteItem(selectedDate, idx)
                        )
                      }
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-dashed border-border my-2" />

          <div className="flex items-center justify-between font-semibold text-sm">
            <div className="text-foreground">{lang === "en" ? "Total" : "รวม"}</div>
            <div className="text-destructive">{t.thb}{dayTotal}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StaffStatsProps {
  lang: Language;
  orders: Order[];
  onTabChange: (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

function formatDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function StaffStatsScreen({ lang, orders, onTabChange, onLogout, onLangToggle }: StaffStatsProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const paidOrders = orders.filter((o) => o.status === "paid");

  const rangeStart = new Date(`${startDate}T00:00:00`);
  const rangeEnd = new Date(`${endDate}T23:59:59`);
  const filtered = paidOrders.filter((o) => o.timestamp >= rangeStart && o.timestamp <= rangeEnd);

  const totalRevenue = filtered.reduce((s, o) => s + orderTotal(o), 0);
  const cashRevenue = filtered.filter((o) => o.paymentMethod === "cash").reduce((s, o) => s + orderTotal(o), 0);
  const transferRevenue = filtered.filter((o) => o.paymentMethod === "transfer").reduce((s, o) => s + orderTotal(o), 0);
  const orderCount = filtered.length;
  const uniqueGroups = new Set(
    filtered.filter((o) => !o.isTakeaway).map((o) => o.paymentBatchId || o.id)
  ).size;

  function optionKey(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(ci.meat);
    if (ci.portion === "special") parts.push("special");
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(`spice${ci.spiceLevel}`);
    if (ci.addEgg) parts.push("egg");
    ci.addOns.forEach((id) => parts.push(id));
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      selected.forEach((cid) => parts.push(cid));
    });
    return parts.join(",");
  }

  function optionLabel(ci: CartItem, lang: Language): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(T[lang].meats[ci.meat]);
    if (ci.portion === "special") parts.push(T[lang].special);
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(T[lang].eggAdded);
    ci.addOns.forEach((id) => {
      const addon = ADD_ONS.find((a) => a.id === id);
      if (addon) parts.push(lang === "en" ? addon.label.en : addon.label.th);
    });
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(", ");
  }

  const menuCounts: Record<string, { nameEn: string; nameTh: string; optionLabel: string; qty: number; revenue: number }> = {};
  filtered.forEach((o) => {
    o.items.forEach((ci) => {
      const key = `${ci.item.id}|${optionKey(ci)}`;
      if (!menuCounts[key]) {
        menuCounts[key] = {
          nameEn: ci.item.name.en,
          nameTh: ci.item.name.th,
          optionLabel: optionLabel(ci, lang),
          qty: 0,
          revenue: 0,
        };
      }
      menuCounts[key].qty += ci.quantity;
      menuCounts[key].revenue += cartItemTotal(ci);
    });
  });
  const topMenus = Object.values(menuCounts).sort((a, b) => b.qty - a.qty);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="stats" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-stretch gap-2 mb-5">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="text-muted-foreground text-sm self-center">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Total Revenue" : "รายได้รวม"}</div>
            <div className="font-display font-bold text-2xl text-primary">{t.thb}{totalRevenue}</div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Customer Groups" : "จำนวนกลุ่มลูกค้า"}</div>
            <div className="font-display font-bold text-2xl text-foreground">{uniqueGroups}</div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Cash" : "เงินสด"}</div>
            <div className="font-display font-bold text-xl text-secondary">{t.thb}{cashRevenue}</div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Transfer" : "เงินโอน"}</div>
            <div className="font-display font-bold text-xl text-accent">{t.thb}{transferRevenue}</div>
          </div>
        </div>

        <h3 className="font-semibold text-foreground text-sm mb-3">
          {lang === "en" ? "Items Ordered" : "รายการที่ขายทั้งหมด"}
        </h3>
        {topMenus.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
            {lang === "en" ? "No data for this period" : "ไม่มีข้อมูลในช่วงนี้"}
          </div>
        ) : (
          <div className="space-y-2">
            {topMenus.map((m, idx) => (
              <div key={idx} className="bg-card rounded-xl border border-border p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {lang === "en" ? m.nameEn : m.nameTh}
                      {m.optionLabel && <span className="text-muted-foreground font-normal"> · {m.optionLabel}</span>}
                    </div>
                    <div className="text-muted-foreground text-xs">{m.qty} {t.items}</div>
                  </div>
                </div>
                <div className="font-semibold text-primary text-sm">{t.thb}{m.revenue}</div>
              </div>
            ))}
          </div>
        )}
      </div>
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

type StaffTab = "orders" | "payment" | "menu" | "history" | "stats" | "expenses";
const STAFF_TAB_VIEW: Record<StaffTab, View> = {
  orders: "staff-orders",
  payment: "staff-payment",
  menu: "staff-menu",
  history: "staff-history",
  stats: "staff-stats",
  expenses: "staff-expenses",
};
function isStaffTab(v: unknown): v is StaffTab {
  return v === "orders" || v === "payment" || v === "menu" || v === "history" || v === "stats" || v === "expenses";
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
  const [authChecked, setAuthChecked] = useState(false);
  const [expenseDays, setExpenseDays] = useState<ExpenseDay[]>([]);
  const [expenseCatalog, setExpenseCatalog] = useState<ExpenseCatalogEntry[]>([]);

  const [allMenuItems, setAllMenuItems] = useState<(MenuItem & { active?: boolean })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [staffLoggedIn, setStaffLoggedIn] = useState(false);
  const allMenuItemsRef = useRef(allMenuItems);
  useEffect(() => {
    allMenuItemsRef.current = allMenuItems;
  }, [allMenuItems]);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, "categories"), orderBy("order", "asc")), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Category));
      setAllCategories(data);
      setCategories(data.filter((c) => c.active !== false));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const tn = getTableFromUrl();
    if (!tn) return;
    const q = query(collection(db, "orders"), where("tableNumber", "==", tn), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            tableNumber: raw.tableNumber,
            timestamp: raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(),
            items: raw.items,
            status: raw.status,
            isTakeaway: raw.isTakeaway,
          } as Order;
        })
        .filter((o) => o.status !== "paid");
      setCustomerOrders(data);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "menuItems"), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem & { active?: boolean }));
      setAllMenuItems(data);
      setMenuItems(data.filter((m) => m.active !== false));
    });
    return () => unsubscribe();
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
  useEffect(() => {
    if (!authChecked) return;
    const isStaff = getTableFromUrl() === null; // ถ้าไม่มี ?table= = ฝั่งพนักงาน
    if (!isStaff) return; // ลูกค้าไม่ต้องฟัง orders เลย เลี่ยง permission error

    const q = query(collection(db, "orders"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          tableNumber: raw.tableNumber,
          timestamp: raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(),
          items: raw.items,
          status: raw.status,
          paymentMethod: raw.paymentMethod,
          cashReceived: raw.cashReceived,
          isTakeaway: raw.isTakeaway,
          takeawayLabel: raw.takeawayLabel,
          paymentBatchId: raw.paymentBatchId,
        } as Order;
      });
      setOrders(data);
    });
    return () => unsubscribe();
  }, [authChecked]);

  // บัญชีรายจ่าย — เฉพาะฝั่งพนักงานเท่านั้น (เหมือน orders ด้านบน)
  useEffect(() => {
    if (!authChecked) return;
    const isStaff = getTableFromUrl() === null;
    if (!isStaff) return;

    const unsubscribeExpenses = onSnapshot(collection(db, "expenses"), (snapshot) => {
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
    });

    const unsubscribeCatalog = onSnapshot(collection(db, "expenseItems"), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseCatalogEntry));
      setExpenseCatalog(data);
    });

    return () => {
      unsubscribeExpenses();
      unsubscribeCatalog();
    };
  }, [authChecked]);

  const [selectedPayTable, setSelectedPayTable] = useState<string | null>(null);
  const [loginError, setLoginError] = useState(false);
  const [staffTab, setStaffTab] = useState<"orders" | "payment" | "menu" | "history" | "stats" | "expenses">("orders");
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const menuScrollTopRef = useRef(0);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const askConfirm = (message: string, onConfirm: () => void) => setConfirmDialog({ message, onConfirm });
  const [busyTables, setBusyTables] = useState(0);
  const [busyItems, setBusyItems] = useState(0);

  // ฟัง status สรุปที่ฝั่งพนักงาน (client ใครก็ตามที่ login อยู่) คำนวณและอัปเดตไว้ให้
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "status", "live"), (snap) => {
      const data = snap.data();
      setBusyTables(data?.busyTables || 0);
      setBusyItems(data?.busyItems || 0);
    });
    return () => unsubscribe();
  }, []);

  // คำนวณสถานะยุ่งจากออเดอร์ที่เห็น (มีผลจริงเฉพาะฝั่งพนักงานที่ login แล้วเท่านั้น เพราะลูกค้าอ่าน orders ไม่ได้)
  useEffect(() => {
    const dineInProgress = orders.filter((o) => o.status === "in-progress" && !o.isTakeaway);
    const allInProgress = orders.filter((o) => o.status === "in-progress");
    const tables = new Set(dineInProgress.map((o) => o.tableNumber)).size;
    const items = allInProgress.reduce((s, o) => s + o.items.reduce((s2, ci) => s2 + ci.quantity, 0), 0);
    setDoc(doc(db, "status", "live"), { busyTables: tables, busyItems: items }).catch(() => { });
  }, [orders]);

  const isBusy = busyTables >= 4 || busyItems > 10;
  const [manualTable, setManualTable] = useState<string | null>(null);
  const [manualCart, setManualCart] = useState<CartItem[]>([]);
  const [manualCategory, setManualCategory] = useState<string>("");
  const [manualSelectedItem, setManualSelectedItem] = useState<MenuItem | null>(null);
  const [manualIsTakeaway, setManualIsTakeaway] = useState(false);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
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
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  // รีเซ็ตเมนูที่ถูกปิดไว้ให้กลับมาเปิดทั้งหมดเมื่อขึ้นวันใหม่
  // ทำงานเฉพาะฝั่งพนักงานที่ login อยู่ (เพราะ security rules อนุญาตให้เขียน menuItems ได้เฉพาะ auth != null)
  // เช็คทันทีตอน login/เปิดแอป และเช็คซ้ำทุก 1 นาที เผื่อเปิดแท็บค้างข้ามเที่ยงคืนโดยไม่รีเฟรช
  useEffect(() => {
    if (!staffLoggedIn) return;

    const checkAndResetDailyMenu = async () => {
      const todayKey = getTodayKey();
      const lockRef = doc(db, "counters", `menu-reset-${todayKey}`);
      try {
        const claimed = await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(lockRef);
          if (snap.exists()) return false; // มีเครื่องอื่นรีเซ็ตของวันนี้ไปแล้ว
          transaction.set(lockRef, { resetAt: serverTimestamp() });
          return true;
        });
        if (!claimed) return;

        const toReset = allMenuItemsRef.current.filter((m) => m.active === false);
        if (toReset.length === 0) return;
        await Promise.all(
          toReset.map((m) => updateDoc(doc(db, "menuItems", m.id), { active: true }))
        );
      } catch {
        // เงียบไว้ก่อน เดี๋ยวรอบถัดไป (นาทีถัดไป) จะลองใหม่เอง
      }
    };

    checkAndResetDailyMenu();
    const interval = setInterval(checkAndResetDailyMenu, 60_000);
    return () => clearInterval(interval);
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
      const cleanItems = JSON.parse(JSON.stringify(cart)); // ตัดฟิลด์ที่เป็น undefined ทิ้งอัตโนมัติ
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
      const cleanItems = JSON.parse(JSON.stringify(manualCart));
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
      await signInWithEmailAndPassword(auth, STAFF_EMAIL, pw);
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

  const handleRemoveOrderItem = async (orderId: string, cartId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const newItems = order.items.filter((ci) => ci.cartId !== cartId);
    if (newItems.length === 0) {
      await deleteDoc(doc(db, "orders", orderId));
    } else {
      await updateDoc(doc(db, "orders", orderId), { items: newItems });
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    await deleteDoc(doc(db, "orders", orderId));
  };

  const handleCloseTable = async (tableNum: string, paymentMethod: PaymentMethod, cashReceived?: number) => {
    const toClose = orders.filter(
      (o) => o.tableNumber === tableNum && o.status === "awaiting-payment"
    );
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

  const handleAdjustPaymentItem = async (contributingOrders: Order[], key: string, delta: number) => {
    for (const order of contributingOrders) {
      const idx = order.items.findIndex((ci) => cartItemKey(ci) === key);
      if (idx === -1) continue;
      const newItems = [...order.items];
      const newQty = newItems[idx].quantity + delta;
      if (newQty <= 0) {
        newItems.splice(idx, 1);
      } else {
        newItems[idx] = { ...newItems[idx], quantity: newQty };
      }
      if (newItems.length === 0) {
        await deleteDoc(doc(db, "orders", order.id));
      } else {
        await updateDoc(doc(db, "orders", order.id), { items: newItems });
      }
      return;
    }
  };

  const handleAdjustTakeawayItem = async (orderId: string, key: string, delta: number) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const idx = order.items.findIndex((ci) => cartItemKey(ci) === key);
    if (idx === -1) return;
    const newItems = [...order.items];
    const newQty = newItems[idx].quantity + delta;
    if (newQty <= 0) newItems.splice(idx, 1);
    else newItems[idx] = { ...newItems[idx], quantity: newQty };
    if (newItems.length === 0) {
      await deleteDoc(doc(db, "orders", orderId));
    } else {
      await updateDoc(doc(db, "orders", orderId), { items: newItems });
    }
  };

  const handleStaffTabChange = (tab: "orders" | "payment" | "menu" | "history" | "stats" | "expenses") => {
    setStaffTab(tab);
    writeSession("staffTab", tab);
    setView(
      tab === "orders" ? "staff-orders" :
        tab === "payment" ? "staff-payment" :
          tab === "menu" ? "staff-menu" :
            tab === "history" ? "staff-history" :
              tab === "expenses" ? "staff-expenses" : "staff-stats"
    );
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
    await setDoc(doc(db, "menuItems", item.id), { ...item, active: (item as any).active ?? true });
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
    await deleteDoc(doc(db, "menuItems", itemId));
  };

  const handleLogout = async () => {
    await signOut(auth);
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

  const handleDeleteExpenseItem = async (date: string, index: number) => {
    const existing = expenseDays.find((e) => e.id === date);
    if (!existing) return;
    const newItems = existing.items.filter((_, i) => i !== index);
    const totalAmount = newItems.reduce((s, i) => s + i.amount, 0);
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
          onRemoveItem={handleRemoveOrderItem}
          onCancelOrder={handleCancelOrder}
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
          onCancelOrder={handleCancelOrder}
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
          orders={orders}
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
          orders={orders}
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
          onAddItem={handleAddExpenseItem}
          onDeleteItem={handleDeleteExpenseItem}
          onAskConfirm={askConfirm}
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
    </>
  );
}