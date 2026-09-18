import { useState, useEffect, useRef, lazy, Suspense } from "react";
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
import { MenuScreen } from "./customer/MenuScreen";
import { ItemDetailScreen } from "./customer/ItemDetailScreen";
import { CartScreen } from "./customer/CartScreen";
import { LinkExpiredScreen } from "./customer/LinkExpiredScreen";
import { OrderSentScreen } from "./customer/OrderSentScreen";

// ─── Staff screens (lazy, per-file) ────────────────────────────────────────────
// แต่ละ Staff*Screen import ตรงจากไฟล์ตัวเอง แยกเป็นคนละ JS chunk ต่อหน้าจอ
// ลูกค้าที่สแกน QR ไม่โหลด chunk เหล่านี้เลย ส่วนฝั่งพนักงานโหลดเฉพาะแท็บที่กดจริง
const StaffLoginScreen = lazy(() => import("./staff/StaffLoginScreen").then((m) => ({ default: m.StaffLoginScreen })));
const StaffOrdersScreen = lazy(() => import("./staff/StaffOrdersScreen").then((m) => ({ default: m.StaffOrdersScreen })));
const StaffPaymentScreen = lazy(() => import("./staff/StaffPaymentScreen").then((m) => ({ default: m.StaffPaymentScreen })));
const StaffMenuScreen = lazy(() => import("./staff/StaffMenuScreen").then((m) => ({ default: m.StaffMenuScreen })));
const StaffManualTableScreen = lazy(() => import("./staff/StaffManualTableScreen").then((m) => ({ default: m.StaffManualTableScreen })));
const StaffMenuEditScreen = lazy(() => import("./staff/StaffMenuEditScreen").then((m) => ({ default: m.StaffMenuEditScreen })));
const StaffHistoryScreen = lazy(() => import("./staff/StaffHistoryScreen").then((m) => ({ default: m.StaffHistoryScreen })));
const StaffExpensesScreen = lazy(() => import("./staff/StaffExpensesScreen").then((m) => ({ default: m.StaffExpensesScreen })));
const StaffStatsScreen = lazy(() => import("./staff/StaffStatsScreen").then((m) => ({ default: m.StaffStatsScreen })));
const StaffActivityScreen = lazy(() => import("./staff/StaffActivityScreen").then((m) => ({ default: m.StaffActivityScreen })));

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
  // ปรับ +1/-1 แบบไม่ถึง void ก็ต้องกรอกเหตุผลก่อนเช่นกัน แล้วบันทึก log adjust_item_qty
  const handleAdjustPaymentItem = async (contributingOrders: Order[], key: string, delta: number) => {
    for (const order of contributingOrders) {
      const target = order.items.find((ci) => !ci.voided && cartItemKey(ci) === key);
      if (!target) continue;
      const newQty = target.quantity + delta;
      if (newQty > 0) {
        const oldQty = target.quantity;
        askReason(T[lang].adjustItemReasonTitle, (reason) => {
          void (async () => {
            const newItems = order.items.map((ci) =>
              ci.cartId === target.cartId ? { ...ci, quantity: newQty } : ci
            );
            await updateDoc(doc(db, "orders", order.id), { items: newItems });
            await logActivity({
              action: "adjust_item_qty",
              orderId: order.id,
              tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
              itemName: target.item.name.th,
              amount: delta * cartItemUnitPrice(target),
              reason,
              details: { oldQty, newQty },
            });
          })();
        });
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
      const oldQty = target.quantity;
      askReason(T[lang].adjustItemReasonTitle, (reason) => {
        void (async () => {
          const newItems = order.items.map((ci) =>
            ci.cartId === target.cartId ? { ...ci, quantity: newQty } : ci
          );
          await updateDoc(doc(db, "orders", orderId), { items: newItems });
          await logActivity({
            action: "adjust_item_qty",
            orderId,
            tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
            itemName: target.item.name.th,
            amount: delta * cartItemUnitPrice(target),
            reason,
            details: { oldQty, newQty },
          });
        })();
      });
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

  const staffLoadingFallback = (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 size={18} className="animate-spin" />
        {lang === "en" ? "Loading..." : "กำลังโหลด..."}
      </div>
    </div>
  );

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
        <Suspense fallback={staffLoadingFallback}>
          <StaffLoginScreen
            lang={lang}
            onLogin={handleStaffLogin}
            onBack={() => setView("staff-login")}
            error={loginError}
            onLangToggle={toggleLang}
          />
        </Suspense>
      );
      break;

    case "staff-orders":
      content = (
        <Suspense fallback={staffLoadingFallback}>
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
        </Suspense>
      );
      break;

    case "staff-payment":
      content = (
        <Suspense fallback={staffLoadingFallback}>
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
        </Suspense>
      );
      break;

    case "staff-menu":
      content = (
        <Suspense fallback={staffLoadingFallback}>
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
        </Suspense>
      );
      break;

    case "staff-menu-edit":
      content = editingItem ? (
        <Suspense fallback={staffLoadingFallback}>
          <StaffMenuEditScreen
            lang={lang}
            item={editingItem}
            onSave={handleSaveItem}
            onCancel={() => setView("staff-menu")}
            onLangToggle={toggleLang}
            categories={categories}
          />
        </Suspense>
      ) : null;
      break;

    case "staff-history":
      content = (
        <Suspense fallback={staffLoadingFallback}>
          <StaffHistoryScreen
            lang={lang}
            onTabChange={handleStaffTabChange}
            onLogout={handleLogout}
            onLangToggle={toggleLang}
          />
        </Suspense>
      );
      break;

    case "staff-stats":
      content = (
        <Suspense fallback={staffLoadingFallback}>
          <StaffStatsScreen
            lang={lang}
            onTabChange={handleStaffTabChange}
            onLogout={handleLogout}
            onLangToggle={toggleLang}
          />
        </Suspense>
      );
      break;

    case "staff-expenses":
      content = (
        <Suspense fallback={staffLoadingFallback}>
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
        </Suspense>
      );
      break;

    case "staff-activity":
      content = (
        <Suspense fallback={staffLoadingFallback}>
          <StaffActivityScreen
            lang={lang}
            onTabChange={handleStaffTabChange}
            onLogout={handleLogout}
            onLangToggle={toggleLang}
          />
        </Suspense>
      );
      break;

    case "staff-manual-table":
      content = (
        <Suspense fallback={staffLoadingFallback}>
          <StaffManualTableScreen
            lang={lang}
            onSelect={handlePickManualTable}
            onSelectTakeaway={handlePickManualTakeaway}
            onCancel={() => setView("staff-orders")}
            onLangToggle={toggleLang}
          />
        </Suspense>
      );
      break;

    case "staff-manual-menu":
      content = (
        <Suspense fallback={staffLoadingFallback}>
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
        </Suspense>
      );
      break;

    case "staff-manual-cart":
      content = (
        <Suspense fallback={staffLoadingFallback}>
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
        </Suspense>
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
