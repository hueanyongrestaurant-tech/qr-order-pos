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
import { collection, addDoc, setDoc, onSnapshot, query, orderBy, where, limit, getDocs, getDoc, doc, updateDoc, deleteDoc, serverTimestamp, Timestamp, runTransaction, arrayUnion, arrayRemove, deleteField, FieldPath } from "firebase/firestore";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { buildMenuSnapshot, readMenuSnapshot, readMenuSnapshotHash, writeMenuSnapshot } from "./menuSnapshot";

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
  PaymentInput,
  ActivityAction,
  ActivityLog,
  MenuItem,
  MenuAvailability,
  CartItem,
  Order,
  ExpenseLineItem,
  ExpenseDay,
  ExpenseCatalogEntry,
  Category,
  ConfirmOptions,
} from "./types";
import { ADD_ONS, ADDON_CATEGORY_ID, AUDIT_UI_ENABLED } from "./constants";
import { T } from "./translations";
import {
  resolvePhoto,
  itemPrice,
  cartItemUnitPrice,
  cartItemTotal,
  stripItemPhoto,
  invalidatePaidOrdersDay,
  liveItems,
  liveItemCount,
  unservedItems,
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
  getYesterdayKey,
  ignoreSoldOut,
  formatDateInput,
  compressImage,
  fetchFreshMenuItems,
  isCartItemUnavailable,
  withLiveAvailability,
  type MeatOption,
  allocateTransfer,
} from "./utils";
import { LannaBorder, RestaurantLogo } from "./shared";
// เฉพาะ printerStore เพราะเป็น localStorage ล้วน ไม่มี Capacitor — ส่วน nativePrinter.ts
// (import capacitor-thermal-printer) โหลดแบบ dynamic import เฉพาะตอนจะใช้จริงเท่านั้น ไม่งั้น
// ลูกค้าที่สแกน QR จะโดนดึง plugin ของฝั่งพนักงานไปรวมกับ chunk หลักด้วย
import { getPrintRole, getSelectedPrinterAddress } from "./staff/printerStore";
import { isSoundMuted } from "./staff/soundStore";
import { activeDineInOrders, buildMoveTicketOrder, moveBanner, occupiedTables, takeNewMoves } from "./staff/tableMove";
import { MenuScreen } from "./customer/MenuScreen";
import { ItemDetailScreen } from "./customer/ItemDetailScreen";
import { CartScreen } from "./customer/CartScreen";
import { LinkExpiredScreen } from "./customer/LinkExpiredScreen";
import { OrderSentScreen } from "./customer/OrderSentScreen";
import {
  CLOSURE_CHECK_TIMEOUT_MS,
  checkClosure,
  decideSessionOnLoad,
  isSessionTimedOut,
  planTableClose,
  type ExpiredReason,
  type SessionStart,
  type TableSession,
} from "./tableSession";

// ─── Staff screens (lazy, per-file) ────────────────────────────────────────────
// แต่ละ Staff*Screen import ตรงจากไฟล์ตัวเอง แยกเป็นคนละ JS chunk ต่อหน้าจอ
// ลูกค้าที่สแกน QR ไม่โหลด chunk เหล่านี้เลย ส่วนฝั่งพนักงานโหลดเฉพาะแท็บที่กดจริง
const StaffLoginScreen = lazy(() => import("./staff/StaffLoginScreen").then((m) => ({ default: m.StaffLoginScreen })));
const StaffOrdersScreen = lazy(() => import("./staff/StaffOrdersScreen").then((m) => ({ default: m.StaffOrdersScreen })));
const StaffPaymentScreen = lazy(() => import("./staff/StaffPaymentScreen").then((m) => ({ default: m.StaffPaymentScreen })));
const StaffMenuScreen = lazy(() => import("./staff/StaffMenuScreen").then((m) => ({ default: m.StaffMenuScreen })));
const StaffManualTableScreen = lazy(() => import("./staff/StaffManualTableScreen").then((m) => ({ default: m.StaffManualTableScreen })));
const StaffAddOnScreen = lazy(() => import("./staff/StaffAddOnScreen").then((m) => ({ default: m.StaffAddOnScreen })));
const StaffMenuEditScreen = lazy(() => import("./staff/StaffMenuEditScreen").then((m) => ({ default: m.StaffMenuEditScreen })));
const StaffHistoryScreen = lazy(() => import("./staff/StaffHistoryScreen").then((m) => ({ default: m.StaffHistoryScreen })));
const StaffExpensesScreen = lazy(() => import("./staff/StaffExpensesScreen").then((m) => ({ default: m.StaffExpensesScreen })));
const StaffStatsScreen = lazy(() => import("./staff/StaffStatsScreen").then((m) => ({ default: m.StaffStatsScreen })));
const StaffBackfillSetupScreen = lazy(() => import("./staff/StaffBackfillSetupScreen").then((m) => ({ default: m.StaffBackfillSetupScreen })));
const StaffBackfillPaymentScreen = lazy(() => import("./staff/StaffBackfillPaymentScreen").then((m) => ({ default: m.StaffBackfillPaymentScreen })));
const StaffActivityScreen = lazy(() => import("./staff/StaffActivityScreen").then((m) => ({ default: m.StaffActivityScreen })));
const MoveTableModal = lazy(() => import("./staff/MoveTableModal").then((m) => ({ default: m.MoveTableModal })));

// เหตุที่ย้ายโต๊ะไม่ได้ — โยนจากใน transaction (Firestore ไม่ retry error ของเรา) แล้วแจ้งพนักงานตาม code
class MoveTableError extends Error {
  code: "occupied" | "nothing";
  constructor(code: "occupied" | "nothing") {
    super(code);
    this.code = code;
  }
}
// guard doc ของการย้ายโต๊ะ — ทุกการย้ายอ่าน+เขียน doc นี้ใน transaction การย้ายพร้อมกันจึงชนกันแล้ว retry
// (query เช็คโต๊ะปลายทางอยู่นอก read set ของ transaction ถ้าไม่มี guard สองเครื่องจะเห็นว่าว่างทั้งคู่)
// อยู่ใน counters/ เพราะ rules เดิมให้พนักงานอ่าน/เขียนได้อยู่แล้ว ไม่ต้องแก้ rules
const TABLE_MOVE_GUARD = "table-moves";

// ปิดบิลโต๊ะไม่ได้ — โยนจากใน transaction แล้วแจ้งพนักงานตาม code (ดู planTableClose)
class CloseTableError extends Error {
  code: "pending" | "changed" | "nothing";
  constructor(code: "pending" | "changed" | "nothing") {
    super(code);
    this.code = code;
  }
}
// เวลาปิดบิลล่าสุดของแต่ละโต๊ะ { closedAt: { "1-3": Timestamp } } — หน้าเว็บลูกค้าเช็คก่อนส่งออเดอร์ (ดู tableSession.ts)
// อยู่ใน status/ เพราะ rules เดิมให้ลูกค้าอ่าน + พนักงานเขียนได้อยู่แล้ว ไม่ต้องแก้ rules
// (ห้ามใส่ใน status/live — doc นั้นถูก setDoc ทับทั้งก้อนโดยตัวนับร้านยุ่ง)
const TABLE_CLOSURES_DOC = "tableClosures";

function readTableSession(): TableSession | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}:tableSession`);
    return raw === null ? null : (JSON.parse(raw) as TableSession);
  } catch {
    return null;
  }
}
function writeTableSession(session: TableSession) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}:tableSession`, JSON.stringify(session));
  } catch {
    // sessionStorage ใช้ไม่ได้ — รอบนั่งจะเริ่มใหม่ทุกครั้งที่โหลดหน้า (รีเฟรช = เจอ s ที่ไม่ตรง → ให้สแกนใหม่)
  }
}

// ตัดสินรอบนั่งครั้งเดียวต่อการโหลดหน้า (memo ไว้ — StrictMode เรียก initializer ซ้ำได้)
// รอบใหม่: จด session ลง sessionStorage แล้วเขียน s ลง URL ให้รีเฟรช/กู้แท็บกลับมาเจอรอบเดิม
let memoSessionStart: SessionStart | null | undefined;
function getInitialSessionStart(): SessionStart | null {
  if (memoSessionStart !== undefined) return memoSessionStart;
  const table = getTableFromUrl();
  if (!table) return (memoSessionStart = null);
  let urlSessionId: string | null = null;
  try {
    urlSessionId = new URLSearchParams(window.location.search).get("s");
  } catch { /* ignore */ }
  const start = decideSessionOnLoad({ table, urlSessionId, stored: readTableSession(), now: Date.now(), newId: uid });
  if (start.action === "new") {
    writeTableSession(start.session);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("s", start.session.id);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* ignore */ }
  } else if (start.action === "expired" && start.session && !start.session.expired) {
    writeTableSession({ ...start.session, expired: start.reason });
  }
  return (memoSessionStart = start);
}

// closedAt (ms) ล่าสุดของโต๊ะ — 0 = ไม่เคยปิดบิล, "error" = อ่านไม่ได้/ไม่ทันเวลา (ผู้เรียกต้องปล่อยผ่าน)
async function fetchTableClosedAt(table: string): Promise<number | "error"> {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "status", TABLE_CLOSURES_DOC)),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), CLOSURE_CHECK_TIMEOUT_MS)),
    ]);
    const ts = snap.data()?.closedAt?.[table];
    return ts?.toMillis ? ts.toMillis() : 0;
  } catch {
    return "error";
  }
}

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
  // reason ว่าง (ตอน AUDIT_UI_ENABLED = false ไม่ถามเหตุผล) → ไม่ใส่ field reason เลย
  if (clean.reason === "") delete clean.reason;
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

const CONFIRM_TONE_CLASS: Record<NonNullable<ConfirmOptions["tone"]>, string> = {
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  success: "bg-secondary text-secondary-foreground hover:bg-secondary/90",
  neutral: "bg-primary text-primary-foreground hover:bg-primary/90",
};

function ConfirmModal({ message, onConfirm, onCancel, lang, confirmLabel, cancelLabel, tone = "danger" }: { message: string; onConfirm: () => void; onCancel: () => void; lang: Language } & ConfirmOptions) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm mb-5 leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all"
          >
            {cancelLabel ?? (lang === "en" ? "Cancel" : "ยกเลิก")}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-all ${CONFIRM_TONE_CLASS[tone]}`}
          >
            {confirmLabel ?? (lang === "en" ? "Confirm" : "ยืนยัน")}
          </button>
        </div>
      </div>
    </div>
  );
}

// หน้าต่างแจ้งเตือนปุ่มเดียว — หน้าตาเดียวกับ ConfirmModal
function NoticeModal({ message, onClose, lang }: { message: string; onClose: () => void; lang: Language }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onClose}>
      <div
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5 mb-5">
          <AlertTriangle size={18} className="text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-foreground text-sm leading-relaxed">{message}</p>
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
        >
          {lang === "en" ? "OK" : "ตกลง"}
        </button>
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
          {lang === "en" ? "A reason is required. Pick one or type your own." : "ต้องใส่เหตุผล เลือกจากรายการหรือพิมพ์เองก็ได้"}
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

// cache เมนูฝั่งลูกค้าเก็บใน localStorage (ไม่ใช่ sessionStorage) — สแกน QR ใหม่มักเปิดแท็บใหม่
// ถ้าเก็บใน sessionStorage จะต้องอ่านเมนูทั้งหมดจาก Firestore ใหม่ทุกครั้งที่สแกน
const MENU_CACHE_KEY = `${STORAGE_PREFIX}:customerMenuCache`;
function readMenuCache<T>(): T | null {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}
function writeMenuCache(value: unknown) {
  try {
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(value));
  } catch {
    // เต็ม/ถูกบล็อก — ไม่มี cache ก็แค่อ่าน Firestore ตามปกติ
  }
}

// เฉพาะวิวเหล่านี้ที่ฝั่งลูกค้าจะถูกจำไว้ตอนรีเฟรช (ตัดพวกที่ sub-state เสี่ยงเกินไปออก)
const CUSTOMER_RESUMABLE_VIEWS: View[] = ["menu", "item-detail", "cart", "order-sent"];

// อายุ cache เมนู (categories+menuItems) ฝั่งลูกค้าใน localStorage — ดู effect ที่ใช้ค่านี้
const MENU_CACHE_TTL_MS = 15 * 60 * 1000;
// เวลารอ Firebase Auth กู้ session ก่อนยอมแสดงฟอร์มรหัสพนักงาน (ปกติเสร็จในไม่กี่ร้อย ms)
const AUTH_CHECK_TIMEOUT_MS = 8000;
// เวลารอเช็คสถานะ "หมด" ล่าสุดของเมนูในตะกร้าก่อนส่งออเดอร์ — เกินนี้ข้ามการเช็คแล้วส่งเลย (ร้านเน็ตช้า)
const SOLD_OUT_CHECK_TIMEOUT_MS = 3000;
// รอให้การแก้เมนูหลายจุดติดกัน (เช่นลากเรียงลำดับ = เขียนหลาย doc) นิ่งก่อนค่อยเขียน menu snapshot ครั้งเดียว
const MENU_SNAPSHOT_DEBOUNCE_MS = 2000;

const STAFF_TAB_VIEW: Record<StaffTab, View> = {
  orders: "staff-orders",
  payment: "staff-payment",
  menu: "staff-menu",
  history: "staff-history",
  stats: "staff-stats",
  expenses: "staff-expenses",
  activity: "staff-activity",
};
// AUDIT_UI_ENABLED = false (ดู constants.ts) → ไม่ให้ session เก่าที่ค้างแท็บ activity กู้กลับไปหน้าที่ซ่อนอยู่
const STAFF_TABS: StaffTab[] = ["orders", "payment", "menu", "history", "expenses", "stats", ...(AUDIT_UI_ENABLED ? ["activity" as const] : [])];
function isStaffTab(v: unknown): v is StaffTab {
  return typeof v === "string" && (STAFF_TABS as string[]).includes(v);
}

export default function App() {
  const initialTableFromUrl = getTableFromUrl();
  // เชื่อ session ที่บันทึกไว้ได้ก็ต่อเมื่อเป็นโต๊ะเดียวกับที่บันทึกไว้เท่านั้น (กันเคสสแกนโต๊ะอื่นในแท็บเดิม)
  const savedCustomerTable = initialTableFromUrl ? readSession<string>("customerTable") : null;
  const isResumingCustomerSession = !!initialTableFromUrl && savedCustomerTable === initialTableFromUrl;
  // รอบนั่งโต๊ะของลูกค้า (ดู tableSession.ts) — null = ฝั่งพนักงาน
  const initialSessionStart = getInitialSessionStart();

  const [lang, setLang] = useState<Language>("th");
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const isFirstOrdersSnapshotRef = useRef(true);
  const [view, setView] = useState<View>(() => {
    if (!initialTableFromUrl) return "staff-login"; // ฝั่งพนักงาน: effect ของ onAuthStateChanged จะจัดหน้าที่ถูกต้องให้เอง
    if (initialSessionStart?.action === "expired") return "link-expired";
    if (isResumingCustomerSession) {
      const savedView = readSession<View>("customerView");
      if (savedView && CUSTOMER_RESUMABLE_VIEWS.includes(savedView)) return savedView;
    }
    return "menu";
  });
  const [tableNumber, setTableNumber] = useState<string | null>(() => initialTableFromUrl);
  const tableSessionRef = useRef<TableSession | null>(initialSessionStart?.session ?? null);
  const [expiredReason, setExpiredReason] = useState<ExpiredReason | null>(() =>
    initialSessionStart?.action === "expired" ? initialSessionStart.reason : null,
  );
  // ตะกร้าไม่ล้าง — ลูกค้าที่ยังนั่งอยู่จริงสแกนใหม่ในแท็บเดิมแล้วได้ตะกร้าเดิมคืน (ลูกค้าเก่าที่ไม่อยู่ร้านสแกนใหม่ไม่ได้อยู่แล้ว)
  const expireTableSession = (reason: ExpiredReason) => {
    if (tableSessionRef.current) {
      tableSessionRef.current = { ...tableSessionRef.current, expired: reason };
      writeTableSession(tableSessionRef.current);
    }
    setExpiredReason(reason);
    setView("link-expired");
  };

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
  // auto-print ใน orders listener (subscribe ครั้งเดียว) ต้องเห็นหมวดล่าสุดเสมอ — ใช้ ref แทน state
  const allCategoriesRef = useRef<Category[]>([]);
  allCategoriesRef.current = allCategories;
  const [staffLoggedIn, setStaffLoggedIn] = useState(false);
  // ต่างจาก staffLoggedIn: latch เป็น true เมื่อ login สำเร็จครั้งแรก แล้วค้าง true จนกว่าจะ
  // กดปุ่ม logout จริงๆ — ไม่กลับเป็น false เวลา onAuthStateChanged fire null ชั่วคราว
  // (เช่นตอน Auth IndexedDB สะดุดเพราะเปิดหลายแท็บ) ใช้เป็น gate ของ Firestore listener ฝั่งพนักงาน
  // เพื่อไม่ให้ listener ถูก unsubscribe ทิ้งกลางคันแล้วข้อมูลหายทั้งที่ยัง login อยู่
  const [everAuthed, setEverAuthed] = useState(false);
  // false = Firebase Auth ยังกู้ session ที่ค้างไว้ไม่เสร็จ (onAuthStateChanged ยังไม่ fire ครั้งแรก)
  // ระหว่างนี้หน้า "staff-login" แสดงหน้าโหลด (โลโก้) แทนฟอร์มรหัส — ไม่ให้พนักงานเห็นฟอร์มแล้วพิมพ์รหัสซ้ำ
  // ทั้งที่ session ยังอยู่ ฝั่งลูกค้าไม่ใช้ค่านี้
  const [authChecked, setAuthChecked] = useState(false);

  // true = listener ได้ข้อมูลจาก server แล้ว (ไม่ใช่ค่าว่างตอนเริ่ม) — gate การเขียน menu snapshot
  // กันเขียน snapshot ว่าง/ครึ่งๆ กลางๆ ทับของดีบน server
  const [staffMenuSynced, setStaffMenuSynced] = useState(false);
  const [staffCategoriesSynced, setStaffCategoriesSynced] = useState(false);

  // ฝั่งพนักงาน (ไม่มี ?table=): realtime listener เดิม — เห็นการแก้ไขเมนูทันทีเสมอ
  useEffect(() => {
    if (getTableFromUrl() !== null) return; // ลูกค้า: ใช้ effect แยกด้านล่างที่มี cache แทน
    const unsubscribe = onSnapshot(query(collection(db, "categories"), orderBy("order", "asc")), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Category));
      setAllCategories(data);
      setCategories(data.filter((c) => c.active !== false));
      if (!snapshot.metadata.fromCache) setStaffCategoriesSynced(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (getTableFromUrl() !== null) return;
    const unsubscribe = onSnapshot(collection(db, "menuItems"), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem & { active?: boolean }));
      setAllMenuItems(data);
      setMenuItems(data.filter((m) => m.active !== false));
      if (!snapshot.metadata.fromCache) setStaffMenuSynced(true);
    });
    return unsubscribe;
  }, []);

  // ฝั่งลูกค้า (มี ?table=): cache categories+menuItems ใน localStorage แทน realtime listener
  // ลด Firestore reads ต่อการเปิด/รีเฟรชหน้าเมนู 1 ครั้ง (ก่อนหน้านี้ทุกครั้งที่เปิดหน้า = subscribe
  // ใหม่ = อ่านทุก document ใหม่หมด) — cache หมดอายุใน 15 นาที ถึงจะยิง Firestore ใหม่ 1 ครั้ง (ไม่ realtime)
  // แล้วอัปเดต cache ใหม่ ลูกค้าจึงเห็นการแก้ไขเมนูของ staff ช้าสุด 15 นาที (ของหมดมีเช็คซ้ำตอนกดส่งอยู่แล้ว
  // — fetchFreshMenuItems) ไม่ใช่ค้างตลอดไป
  useEffect(() => {
    if (getTableFromUrl() === null) return; // ฝั่งพนักงานไม่เกี่ยว ใช้ realtime listener ข้างบนแทน
    let cancelled = false;

    const cached = readMenuCache<{
      categories: Category[];
      menuItems: (MenuItem & { active?: boolean })[];
      timestamp: number;
    }>();
    if (cached && Date.now() - cached.timestamp < MENU_CACHE_TTL_MS) {
      setAllCategories(cached.categories);
      setCategories(cached.categories.filter((c) => c.active !== false));
      setAllMenuItems(cached.menuItems);
      setMenuItems(cached.menuItems.filter((m) => m.active !== false));
      return;
    }

    (async () => {
      // อ่าน menu snapshot doc เดียวก่อน (1 read) — ไม่มี/ปิดอยู่/อ่านไม่ได้ ค่อย fallback อ่านทั้ง collection แบบเดิม
      const fromSnapshot = await readMenuSnapshot().catch((err) => {
        console.error("read menuSnapshot failed — falling back to menuItems", err);
        return null;
      });
      if (cancelled) return;
      let categoryData: Category[];
      let menuData: (MenuItem & { active?: boolean })[];
      if (fromSnapshot) {
        categoryData = fromSnapshot.categories;
        menuData = fromSnapshot.menuItems;
      } else {
        const [categorySnap, menuSnap] = await Promise.all([
          getDocs(query(collection(db, "categories"), orderBy("order", "asc"))),
          getDocs(collection(db, "menuItems")),
        ]);
        if (cancelled) return;
        categoryData = categorySnap.docs.map((d) => ({ id: d.id, ...d.data() } as Category));
        menuData = menuSnap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem & { active?: boolean }));
      }
      setAllCategories(categoryData);
      setCategories(categoryData.filter((c) => c.active !== false));
      setAllMenuItems(menuData);
      setMenuItems(menuData.filter((m) => m.active !== false));
      writeMenuCache({ categories: categoryData, menuItems: menuData, timestamp: Date.now() });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── เขียน menu snapshot (ฝั่งพนักงานที่ล็อกอินแล้ว) — ดู menuSnapshot.ts ───
  // ทุกเครื่องพนักงานคำนวณ snapshot จากข้อมูล realtime ในหน่วยความจำ แล้วเขียนเมื่อ hash ต่างจากที่รู้ล่าสุด
  // ครอบคลุมทุกทางที่เมนูเปลี่ยน (แก้/เพิ่ม/ลบเมนู, หมด/ซ่อน, เนื้อหมด, หมวด, ลากเรียง) และการแก้จากเครื่อง
  // ที่ยังเป็นโค้ดเก่า (เครื่องโค้ดใหม่ที่เปิดอยู่จะเห็นการเปลี่ยนแล้วเขียนแทนให้) — ไม่มี read เพิ่มนอกจาก
  // อ่าน hash บน server 1 ครั้งต่อการเปิดแอป (สร้าง snapshot ครั้งแรก/ซ่อมของเก่าให้อัตโนมัติ)
  // undefined = ยังไม่ได้อ่าน hash บน server | null = ไม่มี snapshot บน server
  const [serverMenuSnapshotHash, setServerMenuSnapshotHash] = useState<string | null | undefined>(undefined);
  const lastWrittenMenuSnapshotHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (getTableFromUrl() !== null || !staffLoggedIn) return;
    if (serverMenuSnapshotHash !== undefined) return; // อ่านครั้งเดียวพอ
    let cancelled = false;
    readMenuSnapshotHash()
      .then((h) => { if (!cancelled) setServerMenuSnapshotHash(h); })
      .catch((err) => {
        console.error("read menuSnapshot hash failed", err);
        if (!cancelled) setServerMenuSnapshotHash(null); // ไม่รู้ = ถือว่าไม่มี → เขียนทับให้ถูกต้อง
      });
    return () => { cancelled = true; };
  }, [staffLoggedIn, serverMenuSnapshotHash]);

  useEffect(() => {
    if (getTableFromUrl() !== null || !staffLoggedIn) return;
    if (!staffMenuSynced || !staffCategoriesSynced || serverMenuSnapshotHash === undefined) return;
    if (allMenuItems.length === 0 || allCategories.length === 0) return; // กันเขียนเมนูว่างทับ
    const timer = window.setTimeout(() => {
      const built = buildMenuSnapshot(allCategories, allMenuItems);
      const known = lastWrittenMenuSnapshotHashRef.current ?? serverMenuSnapshotHash;
      if (built.hash === known) return;
      writeMenuSnapshot(built)
        .then(() => { lastWrittenMenuSnapshotHashRef.current = built.hash; })
        .catch((err) => console.error("write menuSnapshot failed", err));
    }, MENU_SNAPSHOT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [staffLoggedIn, staffMenuSynced, staffCategoriesSynced, serverMenuSnapshotHash, allMenuItems, allCategories]);

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

  // รอบนั่งใหม่: อ่านเวลาปิดบิลล่าสุดของโต๊ะเก็บเป็น baseline (1 read ต่อการสแกน) — ปิดบิลหลังจากนี้ = รอบนี้หมดอายุ
  // เฉพาะรอบที่เพิ่งเริ่มในการโหลดนี้ — รอบที่กู้กลับมา (รีเฟรช/แท็บค้าง) ห้ามอ่าน baseline ใหม่ ไม่งั้นเวลาปิดบิล
  // ที่เกิดระหว่างนั้นจะกลายเป็น baseline แล้วแท็บค้างสั่งได้
  useEffect(() => {
    if (initialSessionStart?.action !== "new") return;
    let cancelled = false;
    fetchTableClosedAt(initialSessionStart.session.table).then((closedAt) => {
      const cur = tableSessionRef.current;
      if (cancelled || closedAt === "error" || !cur || cur.baselineClosedAt !== undefined) return;
      tableSessionRef.current = { ...cur, baselineClosedAt: closedAt };
      writeTableSession(tableSessionRef.current);
    });
    return () => { cancelled = true; };
  }, []);

  // เปิดหน้าค้างไว้เกิน 4 ชม. แล้วกลับมาดู → หน้าให้สแกนใหม่ทันที (ไม่ต้องรอกดสั่ง)
  useEffect(() => {
    if (!initialSessionStart) return;
    const onVisible = () => {
      const cur = tableSessionRef.current;
      if (document.visibilityState === "visible" && cur && !cur.expired && isSessionTimedOut(cur, Date.now())) {
        expireTableSession("timeout");
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // iOS Safari (โดยเฉพาะเปิดผ่านแอปกล้อง/แอปแชทที่ใช้ in-app browser) มักดึงหน้าที่ถูก
  // "แช่แข็ง" ไว้ใน back-forward cache กลับมาแสดงโดยไม่รันโค้ดใหม่เลย ทำให้ Firestore
  // listener ค้าง/ไม่อัปเดต ดูเหมือนสแกนแล้วไม่ขึ้นอะไร ต้องรีเฟรชเองถึงจะเห็น —
  // ตรวจจับเคสนี้แล้วรีโหลดหน้าให้อัตโนมัติ
  // เฉพาะฝั่งลูกค้า — ฝั่งพนักงาน reload = subscribe ทุกอย่างใหม่หมด (เปลือง Firestore reads มาก)
  useEffect(() => {
    if (getTableFromUrl() === null) return;
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
  // แอป Android: เตรียม AudioContext ตั้งแต่แตะจอครั้งแรก (ปกติคือตอนกด login) — WebView ไม่ยอมให้
  // เล่นเสียงจนกว่าผู้ใช้จะแตะจอสักครั้ง เสียงแจ้งออเดอร์ใหม่หลังจากนั้นจึงดังได้เองโดยไม่ต้องแตะอีก
  useEffect(() => {
    if (import.meta.env.MODE !== "capacitor") return;
    import("./staff/notificationSound").then(({ primeNotificationSound }) => primeNotificationSound());
  }, []);

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
    // true จนกว่าจะผ่าน snapshot แรกของการ subscribe รอบนี้ — กัน auto-print ยิงซ้ำใส่
    // ออเดอร์เก่าทุกใบตอน mount/reconnect (Firestore ส่ง docChanges "added" ทุก doc ที่มีอยู่
    // แล้วในสแนปช็อตแรกเสมอ ไม่ใช่แค่ของใหม่จริง ๆ)
    isFirstOrdersSnapshotRef.current = true;
    // moveId ที่เห็นแล้วใน subscription นี้ — snapshot แรกจดทุกตัวโดยไม่พิมพ์ (ดู tableMove.ts)
    const seenMoveIds = new Set<string>();
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map((d) => mapOrderDoc(d.id, d.data()))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      setOrders(data);
      const newMoves = takeNewMoves(seenMoveIds, data);

      if (isFirstOrdersSnapshotRef.current) {
        isFirstOrdersSnapshotRef.current = false;
        return;
      }

      // Auto-print ตั๋วครัวตอนออเดอร์ใหม่ "เข้าครั้งแรก" เท่านั้น — docChanges "added" หมายถึง
      // doc เพิ่งเข้ามาอยู่ใน query นี้เป็นครั้งแรก แก้ไขรายการ (updateDoc items) ทำให้ได้ "modified"
      // ไม่ใช่ "added" จึงไม่พิมพ์ซ้ำเองอัตโนมัติ — ตรงกับ requirement พอดีโดยไม่ต้องเช็คเพิ่ม
      // ทำงานเฉพาะเครื่องที่ตั้งค่าเลือกเครื่องพิมพ์ไว้แล้วเท่านั้น (printerStore) เครื่องอื่นที่แค่
      // เปิดดู/กดเสิร์ฟจะไม่ auto-print ซ้ำกัน
      const addedDocs = snapshot.docChanges().filter((c) => c.type === "added");

      // เสียง "ติง-ต่อง" แจ้งออเดอร์ใหม่ — เฉพาะแอป Android (build mode capacitor) ใช้ trigger เดียวกับ
      // auto-print ด้านล่าง แต่แยก path กันสิ้นเชิง: ดังเสมอแม้ไม่ได้เลือกเครื่องพิมพ์หรือพิมพ์ล้มเหลว
      // ดังครั้งเดียวต่อ snapshot ต่อให้มีหลายออเดอร์เข้ามาพร้อมกัน
      // guard เป็นค่าคงที่ตอน build — build เว็บตัด import นี้ทิ้งทั้งก้อน ไม่มีโค้ดเสียงหลุดไป gh-pages
      // ปิดเสียงได้ในหน้าตั้งค่าเครื่องพิมพ์ (soundStore) — ข้ามแค่เสียง auto-print ด้านล่างยังทำงานตามปกติ
      if (import.meta.env.MODE === "capacitor" && addedDocs.length > 0 && !isSoundMuted()) {
        import("./staff/notificationSound")
          .then(({ playNewOrderChime }) => playNewOrderChime())
          .catch((err) => console.error("New-order chime failed:", err));
      }

      if (addedDocs.length > 0 && getSelectedPrinterAddress()) {
        import("./staff/nativePrinter").then(({ isNativePrintAvailable, printStationTicketsNative }) => {
          if (!isNativePrintAvailable()) return;
          addedDocs.forEach((change) => {
            const order = mapOrderDoc(change.doc.id, change.doc.data());
            // พิมพ์เฉพาะส่วนของจุดที่เครื่องนี้รับผิดชอบ (หน้าที่ตั้งใน PrinterSettingsModal) — ออเดอร์ที่
            // ไม่มีอะไรของจุดนี้ไม่พิมพ์ ยังโหลดหมวดไม่เสร็จ (ref ว่าง) พิมพ์ใบ "ทุกรายการ" แทน
            printStationTicketsNative(order, getPrintRole(), allCategoriesRef.current, langRef.current).catch((err) => {
              console.error("Auto-print kitchen ticket failed:", err);
            });
          });
        });
      }

      // ใบย้ายโต๊ะ — การย้ายเป็นการแก้ออเดอร์ ("modified") ไม่ใช่ "added" auto-print ด้านบนจึงไม่จับ
      // ทุกเครื่องที่ตั้งเครื่องพิมพ์ไว้พิมพ์ส่วนของจุดตัวเอง (เครื่องที่กดย้ายก็พิมพ์ผ่านทางนี้ ไม่มีทางพิมพ์แยก)
      // 1 การย้าย = 1 ใบต่อจุด รวมทุกรอบ เฉพาะรายการที่ยังไม่เสิร์ฟ ไม่มีอะไรค้าง = ไม่พิมพ์
      if (newMoves.length > 0 && getSelectedPrinterAddress()) {
        import("./staff/nativePrinter").then(({ isNativePrintAvailable, printStationTicketsNative }) => {
          if (!isNativePrintAvailable()) return;
          newMoves.forEach((group) => {
            const ticketOrder = buildMoveTicketOrder(group);
            if (!ticketOrder) return;
            const lang = langRef.current;
            printStationTicketsNative(ticketOrder, getPrintRole(), allCategoriesRef.current, lang, moveBanner(group.from, group.to, lang)).catch((err) => {
              console.error("Auto-print table-move ticket failed:", err);
            });
          });
        });
      }
    });
    return unsubscribe;
  }, [everAuthed]);

  // บัญชีรายจ่าย — ดึงเฉพาะช่วงวันที่ที่หน้า Expenses กำลังดู (1 doc ต่อวัน, id = "YYYY-MM-DD")
  // re-subscribe เมื่อช่วงวันที่เปลี่ยน — handler เพิ่ม/แก้/ลบ ทำงานกับวันที่ในช่วงนี้เสมอ
  // subscribe เฉพาะตอนอยู่หน้ารายจ่าย ออกจากหน้าแล้ว unsubscribe (ประหยัด reads — เครื่องอื่นไม่ต้องฟังทั้งวัน)
  // handler เพิ่ม/แก้/ลบ ถูกเรียกจากหน้ารายจ่ายเท่านั้น จึงเห็นข้อมูลล่าสุดเสมอ
  const onExpensesView = view === "staff-expenses";
  // true = expenseDays ตรงกับ server แล้ว (ได้ snapshot แรกของการ subscribe รอบนี้)
  const expensesSyncedRef = useRef(false);
  useEffect(() => {
    const isStaff = getTableFromUrl() === null;
    if (!isStaff) return;
    if (!everAuthed) return;
    if (!onExpensesView) return;

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
        expensesSyncedRef.current = true;
      },
    );
    return () => {
      unsubscribeExpenses();
      // ไม่โชว์/ไม่ใช้ข้อมูลเก่าตอนกลับเข้ามาใหม่ — รอ snapshot รอบใหม่ก่อน
      expensesSyncedRef.current = false;
      setExpenseDays([]);
    };
  }, [everAuthed, onExpensesView, expenseRangeStart, expenseRangeEnd]);

  // รายชื่อของที่เคยกรอก (autocomplete) — เป็น catalog ที่มีจำนวนจำกัด ดึงทั้งหมดได้ แต่ใส่ limit กันหลุด
  // เหมือนข้างบน: ฟังเฉพาะตอนอยู่หน้ารายจ่าย
  useEffect(() => {
    const isStaff = getTableFromUrl() === null;
    if (!isStaff) return;
    if (!everAuthed) return;
    if (!onExpensesView) return;

    const unsubscribeCatalog = onSnapshot(
      query(collection(db, "expenseItems"), limit(1000)),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseCatalogEntry));
        setExpenseCatalog(data);
      },
    );
    return unsubscribeCatalog;
  }, [everAuthed, onExpensesView]);

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
    return unsubscribeReasons;
  }, [everAuthed]);

  // เวลาปิดบิลล่าสุดของแต่ละโต๊ะ — ป้าย "ลูกค้าใหม่?" บนหน้าออเดอร์ (doc เปลี่ยนเฉพาะตอนปิดบิล อ่านน้อย)
  const [tableClosedAt, setTableClosedAt] = useState<Record<string, number>>({});
  useEffect(() => {
    if (getTableFromUrl() !== null || !everAuthed) return;
    return onSnapshot(doc(db, "status", TABLE_CLOSURES_DOC), (snap) => {
      const raw: Record<string, any> = snap.data()?.closedAt ?? {};
      // serverTimestamp ที่ยังเขียนไม่เสร็จอ่านได้ null — ใช้เวลาเครื่องแทนไปก่อน
      setTableClosedAt(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v?.toMillis ? v.toMillis() : Date.now()])));
    });
  }, [everAuthed]);

  const [selectedPayTable, setSelectedPayTable] = useState<string | null>(null);
  const [loginError, setLoginError] = useState(false);
  const [staffTab, setStaffTab] = useState<StaffTab>("orders");
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const menuScrollTopRef = useRef(0);
  const [confirmDialog, setConfirmDialog] = useState<({ message: string; onConfirm: () => void } & ConfirmOptions) | null>(null);
  const askConfirm = (message: string, onConfirm: () => void, labels?: ConfirmOptions) =>
    setConfirmDialog({ message, onConfirm, ...labels });
  // ข้อความแจ้งเตือนในแอป (ปุ่มเดียว) — ใช้แทน alert() ของเบราว์เซอร์ที่ขึ้นชื่อโดเมน ("localhost says")
  const [notice, setNotice] = useState<string | null>(null);
  const [reasonPrompt, setReasonPrompt] = useState<{ title: string; onConfirm: (reason: string) => void } | null>(null);
  // AUDIT_UI_ENABLED = false (ปิดชั่วคราว ดู constants.ts) → ข้ามหน้าต่างถามเหตุผล ทำงานทันทีด้วย reason ว่าง
  // (log ยังถูกเขียนตามเดิม เพียงไม่มี field reason) — เปิด flag กลับแล้วหน้าต่างเดิมจะกลับมาเอง
  const askReason = (title: string, onConfirm: (reason: string) => void) => {
    if (!AUDIT_UI_ENABLED) { onConfirm(""); return; }
    setReasonPrompt({ title, onConfirm });
  };
  // ยกเลิกทั้งออเดอร์ — ตอน flag ปิดใช้หน้าต่างยืนยันธรรมดาแทน (กันกดพลาด เพราะลบทั้งใบ)
  const askCancelOrder = (onConfirm: (reason: string) => void) => {
    if (!AUDIT_UI_ENABLED) { askConfirm(T[lang].cancelOrderConfirm, () => onConfirm("")); return; }
    askReason(T[lang].cancelOrderReasonTitle, onConfirm);
  };
  // ยกเลิกรายการเดียว (ปุ่ม ✕ หรือกด – จนเหลือ 0) — ตอน flag ปิดถามยืนยันกันกดพลาด
  // ตอน flag เปิด หน้าต่างถามเหตุผลมีปุ่มยืนยันอยู่แล้ว จึงไม่ถามซ้ำอีกชั้น
  const askVoidItem = (item: CartItem, onConfirm: (reason: string) => void) => {
    if (AUDIT_UI_ENABLED) { askReason(T[lang].voidItemReasonTitle, onConfirm); return; }
    const name = lang === "en" ? item.item.name.en || item.item.name.th : item.item.name.th;
    askConfirm(T[lang].voidItemConfirm(name), () => onConfirm(""), {
      cancelLabel: T[lang].voidItemConfirmNo,
      confirmLabel: T[lang].voidItemConfirmYes,
    });
  };
  const [busyTables, setBusyTables] = useState(0);
  const [busyItems, setBusyItems] = useState(0);

  // ค่าล่าสุดของ doc status/live ที่ได้จาก listener — ใช้เทียบก่อนเขียน เพื่อกัน write ซ้ำ
  const liveStatusRef = useRef<{ busyTables: number; busyItems: number }>({ busyTables: 0, busyItems: 0 });
  const statusWriteTimerRef = useRef<number | null>(null);
  const pendingStatusRef = useRef<{ busyTables: number; busyItems: number } | null>(null);

  // ฟัง status สรุปที่ฝั่งพนักงาน (client ใครก็ตามที่ login อยู่) คำนวณและอัปเดตไว้ให้
  useEffect(() => {
    const apply = (data: { busyTables?: number; busyItems?: number } | undefined) => {
      const busyTables = data?.busyTables || 0;
      const busyItems = data?.busyItems || 0;
      liveStatusRef.current = { busyTables, busyItems };
      setBusyTables(busyTables);
      setBusyItems(busyItems);
    };
    // ลูกค้า: อ่านครั้งเดียวตอนเปิดหน้า (1 read) แทนการฟังตลอด — ไม่งั้นทุกครั้งที่พนักงานอัปเดตสถานะ
    // ลูกค้าทุกคนที่เปิดหน้าค้างไว้จะโดนนับ read คนละ 1 ครั้ง ป้ายร้านยุ่งไม่จำเป็นต้อง realtime
    if (getTableFromUrl() !== null) {
      let cancelled = false;
      getDoc(doc(db, "status", "live"))
        .then((snap) => { if (!cancelled) apply(snap.data()); })
        .catch((err) => console.error("read status/live failed", err));
      return () => { cancelled = true; };
    }
    const unsubscribe = onSnapshot(doc(db, "status", "live"), (snap) => apply(snap.data()));
    return unsubscribe;
  }, []);

  // คำนวณสถานะยุ่งจากออเดอร์ที่เห็น (มีผลจริงเฉพาะฝั่งพนักงานที่ login แล้วเท่านั้น เพราะลูกค้าอ่าน orders ไม่ได้)
  // กัน write storm 2 ชั้น:
  //  1) guard — เขียนเฉพาะตอนค่าที่คำนวณได้ต่างจาก doc ปัจจุบัน (พนักงานหลายเครื่องคำนวณค่าเดียวกัน)
  //  2) throttle 4 วิ — เขียนได้มากสุด 1 ครั้ง/4 วิ ต่อเครื่อง โดย flush "ค่าล่าสุด" เสมอ (ไม่ตกหล่นตอนรัชชั่วโมง)
  useEffect(() => {
    if (!staffLoggedIn) return; // rules อนุญาตเขียนเฉพาะ auth อยู่แล้ว — เลี่ยงยิง setDoc ที่จะโดนปฏิเสธ
    // นับเฉพาะรายการที่ยังไม่เสิร์ฟ — จานที่เสิร์ฟไปแล้วไม่ใช่งานค้างของครัว
    // (unservedItems คืน [] ให้ออเดอร์ที่พ้น in-progress แล้วเสมอ)
    const tables = new Set(
      orders.filter((o) => !o.isTakeaway && unservedItems(o).length > 0).map((o) => o.tableNumber),
    ).size;
    const items = orders.reduce((s, o) => s + liveItemCount(unservedItems(o)), 0);

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
  // ไม่ใช่ null = กำลังลง "บิลขายย้อนหลัง" ผ่าน flow สั่งแทนเดิม (manualCart/manualTable ฯลฯ ใช้ร่วมกัน)
  // date ล็อกเป็นเมื่อวาน ณ ตอนกดเข้า flow, time = เวลาที่ขายจริงที่พนักงานกรอก ("HH:MM")
  const [backfill, setBackfill] = useState<{ date: string; time: string } | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  // วันที่ให้หน้าประวัติเปิดมา (หลังบันทึกบิลย้อนหลัง) — undefined = วันนี้ตามปกติ
  const [historyInitialDate, setHistoryInitialDate] = useState<string | undefined>(undefined);

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
      setAuthChecked(true);
    });
    // กันค้างหน้าโหลดตลอดไปถ้า Auth init ไม่ตอบเลย (เช่น IndexedDB สะดุด) — ครบเวลาแล้วโชว์ฟอร์มรหัสไปเลย
    // ถ้า session กลับมาทีหลัง onAuthStateChanged ข้างบนก็ยังพาเข้าหน้าพนักงานเองตามปกติ
    const fallback = window.setTimeout(() => setAuthChecked(true), AUTH_CHECK_TIMEOUT_MS);
    return () => { unsubscribe(); window.clearTimeout(fallback); };
  }, []);

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
  // cartId ของรายการในตะกร้าที่เช็คตอนกดยืนยันแล้วพบว่าสั่งไม่ได้ (เมนูหมด/ซ่อน หรือเลือกเนื้อสัตว์ที่หมด/ถูกซ่อน)
  // CartScreen ใช้ขึ้นป้าย "หมด" + ข้อความเตือน — ใช้ร่วมกันทั้งตะกร้าลูกค้าและตะกร้าพนักงานสั่งแทน
  // (คนละเครื่องกันอยู่แล้ว) เขียนทับทุกครั้งที่กดยืนยัน
  const [cartUnavailableCartIds, setCartUnavailableCartIds] = useState<string[]>([]);

  // true = มีรายการที่สั่งไม่ได้ในตะกร้า ห้ามส่ง | false = ส่งได้ (รวมกรณีเช็คไม่สำเร็จ/ช้าเกิน — ไม่ให้ลูกค้าติดส่งไม่ได้)
  // เจอแล้วเอาข้อมูลเมนูล่าสุดทับในเครื่อง + cache ฝั่งลูกค้าด้วย ไม่ต้องรอ cache 15 นาทีหมดอายุ
  const cartHasUnavailableItems = async (items: CartItem[]): Promise<boolean> => {
    const fresh = await fetchFreshMenuItems(items.map((ci) => ci.item.id), SOLD_OUT_CHECK_TIMEOUT_MS);
    const unavailable = items.filter((ci) => {
      const f = fresh.get(ci.item.id);
      return f ? isCartItemUnavailable(ci, f) : false;
    });
    setCartUnavailableCartIds(unavailable.map((ci) => ci.cartId));
    if (unavailable.length === 0) return false;
    const patch = <M extends MenuItem>(m: M): M => {
      const f = fresh.get(m.id);
      return f ? { ...m, ...f } : m;
    };
    setAllMenuItems((prev) => prev.map(patch));
    setMenuItems((prev) => prev.map(patch).filter((m) => m.active !== false));
    const cached = readMenuCache<{ categories: Category[]; menuItems: MenuItem[]; timestamp: number }>();
    if (cached) writeMenuCache({ ...cached, menuItems: cached.menuItems.map(patch) });
    return true;
  };

  // เช็ครอบนั่งก่อนส่งออเดอร์: หมดอายุ 4 ชม. / โต๊ะถูกปิดบิลไปหลังลูกค้าเปิดหน้า → หน้าให้สแกน QR ใหม่
  // อ่านเวลาปิดบิลไม่ได้/ไม่ทัน → ปล่อยสั่งได้ตามปกติ (ไม่ให้ปัญหาเน็ตทำให้ลูกค้าจริงสั่งไม่ได้)
  const tableSessionExpiredBeforeOrder = async (): Promise<boolean> => {
    const session = tableSessionRef.current;
    if (!session) return false;
    if (session.expired) { expireTableSession(session.expired); return true; }
    if (isSessionTimedOut(session, Date.now())) { expireTableSession("timeout"); return true; }
    const result = checkClosure(session, await fetchTableClosedAt(session.table));
    if (result.session !== session) {
      tableSessionRef.current = result.session;
      writeTableSession(result.session);
    }
    if (result.expired) { expireTableSession("closed"); return true; }
    return false;
  };

  const handleConfirmOrder = async () => {
    // กันกดปุ่ม/แตะจอซ้ำเร็ว ๆ (พบบ่อยทั้ง iOS และ Android) ที่ทำให้ยิง addDoc สองครั้ง
    // กลายเป็นออเดอร์เบิ้ล — เช็คด้วย ref เพราะ state อาจอัปเดตไม่ทันถ้าแตะรัวมาก
    if (isSubmittingOrderRef.current) return;
    if (!(tableNumber && cart.length > 0)) return;
    isSubmittingOrderRef.current = true;
    setIsSubmittingOrder(true);
    try {
      if (await cartHasUnavailableItems(cart)) return;
      if (await tableSessionExpiredBeforeOrder()) return;
      // JSON round-trip: ตัดฟิลด์ undefined ให้ Firestore | .map(stripItemPhoto): ตัดรูป base64 ที่ทำ doc บวม
      const cleanItems = (JSON.parse(JSON.stringify(cart)) as CartItem[]).map(stripItemPhoto);
      await addDoc(collection(db, "orders"), {
        tableNumber,
        items: cleanItems,
        status: "in-progress",
        createdAt: serverTimestamp(),
      });
      setCart([]);
      setCartUnavailableCartIds([]);
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

  // เพิ่มรายการ "Add-on" ที่ไม่ผูกกับเมนูไหนเลย (ค่าถุง, ค่าห่อพิเศษ ฯลฯ) — staff-only, เข้าถึงได้จาก
  // staff-manual-menu เท่านั้น ไม่มีการสร้าง document ใน categories/menuItems เลย สร้างแค่ MenuItem
  // สังเคราะห์ (synthetic) ที่มี id ใหม่ทุกครั้งไว้ในหน่วยความจำ เพื่อให้เข้ากับ CartItem/itemPrice/
  // cartItemKey เดิมได้โดยไม่ต้องแก้โครงสร้าง — categoryId ตั้งเป็นค่าที่ไม่มีหมวดหมู่จริงตรงกัน
  // จึงไม่มีทางไปโผล่ในกริดเมนูของใครเลย
  const handleManualAddOn = (name: string, price: number) => {
    const syntheticItem: MenuItem = {
      id: `addon-${uid()}`,
      categoryId: ADDON_CATEGORY_ID,
      name: { en: name, th: name },
      description: { en: "", th: "" },
      price,
      photo: "",
    };
    handleManualAddToCart({
      cartId: uid(),
      item: syntheticItem,
      spiceLevel: 0,
      addEgg: false,
      addOns: [],
      quantity: 1,
    });
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
      // บิลย้อนหลังเข้ามาจากหน้าประวัติ — ออกแล้วกลับไปที่เดิม
      setView(backfill ? "staff-history" : "staff-orders");
      setBackfill(null);
    };
    if (manualCart.length > 0) {
      askConfirm(lang === "en" ? "Discard the selected items?" : "ทิ้งรายการที่เลือกไว้?", reset);
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
      if (await cartHasUnavailableItems(manualCart)) return;
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
      setCartUnavailableCartIds([]);
      setManualTable(null);
      setManualIsTakeaway(false);
      setView("staff-orders");
    } finally {
      isSubmittingManualOrderRef.current = false;
      setIsSubmittingManualOrder(false);
    }
  };

  // ─── บิลขายย้อนหลัง ─────────────────────────────────────────────────────────
  // เข้าจากหน้าประวัติ: ตั้งค่า (เวลา + โต๊ะ) → เลือกเมนูด้วยหน้าจอสั่งแทนเดิม → สรุป+วิธีจ่าย → บันทึก
  const handleStartBackfill = () => {
    setManualTable(null);
    setManualIsTakeaway(false);
    setManualCart([]);
    setManualCategory(categories[0]?.id || "");
    setBackfill({ date: getYesterdayKey(), time: "" });
    setBackfillError(null);
    setView("staff-backfill-setup");
  };

  const handlePickBackfillTable = (time: string, tn: string) => {
    setBackfill((b) => (b ? { ...b, time } : b));
    setManualTable(tn);
    setManualIsTakeaway(false);
    setView("staff-manual-menu");
  };

  const handlePickBackfillTakeaway = (time: string) => {
    setBackfill((b) => (b ? { ...b, time } : b));
    setManualTable(null);
    setManualIsTakeaway(true);
    setView("staff-manual-menu");
  };

  const isSubmittingBackfillRef = useRef(false);
  const [isSubmittingBackfill, setIsSubmittingBackfill] = useState(false);

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

  // เสิร์ฟทีละรายการ — เขียนแค่ key เดียวใน servedAt (ไม่แตะ items[] ที่ใช้คิดเงิน) และถ้ารายการที่ไม่ถูก void
  // เสิร์ฟครบทุกตัวแล้ว เปลี่ยน status เป็น awaiting-payment ในจังหวะเดียวกัน ทำใน transaction เพื่อเช็คจากข้อมูล
  // ล่าสุดบน server — กันเคสแท็บเล็ต 2 เครื่องกดเสิร์ฟคนละรายการพร้อมกันแล้วไม่มีใครเปลี่ยน status ให้
  const handleServeItem = async (orderId: string, cartId: string) => {
    const ref = doc(db, "orders", orderId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const raw = snap.data();
      if (raw.status !== "in-progress") return;
      const items: CartItem[] = raw.items || [];
      const served: Record<string, unknown> = raw.servedAt || {};
      const target = items.find((ci) => ci.cartId === cartId);
      if (!target || target.voided || served[cartId]) return;
      const allServed = liveItems(items).every((ci) => ci.cartId === cartId || !!served[ci.cartId]);
      if (allServed) {
        tx.update(ref, new FieldPath("servedAt", cartId), serverTimestamp(), "status", "awaiting-payment");
      } else {
        tx.update(ref, new FieldPath("servedAt", cartId), serverTimestamp());
      }
    });
  };

  // ─── ย้อนกลับ (เฉพาะออเดอร์ที่ยังไม่ปิดบิล) ───────────────────────────────────
  // ทุกตัวเป็น transaction อ่านสถานะล่าสุดจาก server ก่อน — บิลที่จ่าย/ยกเลิกไปแล้ว (อาจจากอีกเครื่อง) ย้อนไม่ได้
  // สถานะสลับแค่ระหว่าง in-progress ↔ awaiting-payment ซึ่งอยู่ใน query ของ listener ทั้งคู่ → docChanges เป็น
  // "modified" ไม่ใช่ "added" จึงไม่ auto-print/ไม่มีเสียงซ้ำ ส่วนตัวนับร้านยุ่งคิดจาก orders ใหม่เองอัตโนมัติ
  const notUndoableError = (status: unknown) =>
    new Error(
      status === "cancelled"
        ? (lang === "en" ? "This order was cancelled — it can't be undone" : "ออเดอร์นี้ถูกยกเลิกทั้งใบแล้ว ย้อนกลับไม่ได้")
        : (lang === "en" ? "This bill is already closed — it can't be undone" : "บิลนี้ปิดไปแล้ว ย้อนกลับไม่ได้"),
    );
  const logTableOf = (raw: Record<string, any>): string =>
    raw.isTakeaway ? raw.takeawayLabel ?? raw.tableNumber : raw.tableNumber;
  // ออเดอร์ที่รอชำระ: รายการที่ไม่มี servedAt ถือว่าเสิร์ฟแล้วตาม status (มาจาก "เสิร์ฟทั้งหมด") — ก่อนดึง status
  // กลับเป็น in-progress ต้องจด servedAt ให้รายการเหล่านั้นก่อน ไม่งั้นจะกลายเป็น "ยังไม่เสิร์ฟ" ตามไปด้วย
  const keepServedArgs = (items: CartItem[], served: Record<string, unknown>, exceptCartId: string): unknown[] =>
    liveItems(items)
      .filter((ci) => ci.cartId !== exceptCartId && !served[ci.cartId])
      .flatMap((ci) => [new FieldPath("servedAt", ci.cartId), serverTimestamp()]);

  // ย้อนการเสิร์ฟ 1 รายการ → กลับเป็นยังไม่เสิร์ฟ (ออเดอร์ที่รอชำระอยู่กลับเป็นกำลังเตรียม)
  const handleUnserveItem = async (orderId: string, cartId: string) => {
    const ref = doc(db, "orders", orderId);
    const done = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const raw = snap.data();
      if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw notUndoableError(raw.status);
      const items: CartItem[] = raw.items || [];
      const served: Record<string, unknown> = raw.servedAt || {};
      const target = items.find((ci) => ci.cartId === cartId);
      if (!target || target.voided) return null;
      if (raw.status === "in-progress") {
        if (!served[cartId]) return null; // ยังไม่เสิร์ฟอยู่แล้ว
        tx.update(ref, new FieldPath("servedAt", cartId), deleteField());
      } else {
        tx.update(ref, new FieldPath("servedAt", cartId), deleteField(), "status", "in-progress", ...keepServedArgs(items, served, cartId));
      }
      return { raw, target };
    });
    if (done) {
      await logActivity({ action: "unserve_item", orderId, tableNumber: logTableOf(done.raw), itemName: done.target.item.name.th });
    }
  };

  // ย้อน "เสิร์ฟทั้งหมด" / "พร้อมรับ" → กลับเป็นกำลังเตรียม — รายการที่เสิร์ฟทีละรายการไว้ก่อน (มี servedAt) ยังนับว่าเสิร์ฟแล้ว
  const handleUnmarkServed = async (orderId: string) => {
    const ref = doc(db, "orders", orderId);
    const done = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const raw = snap.data();
      if (raw.status === "in-progress") return null; // ย้อนไปแล้ว (เช่นจากอีกเครื่อง)
      if (raw.status !== "awaiting-payment") throw notUndoableError(raw.status);
      const items: CartItem[] = raw.items || [];
      const served: Record<string, unknown> = raw.servedAt || {};
      const reverted = liveItems(items).filter((ci) => !served[ci.cartId]);
      // ทุกรายการเสิร์ฟทีละรายการครบแล้ว — ไม่มีอะไรให้ย้อน (ถ้าดึง status กลับจะได้การ์ดค้างที่ไม่มีรายการ)
      if (reverted.length === 0) return null;
      tx.update(ref, { status: "in-progress" });
      return { raw, reverted };
    });
    if (done) {
      await logActivity({
        action: done.raw.isTakeaway ? "unready_takeaway" : "unserve_all",
        orderId,
        tableNumber: logTableOf(done.raw),
        details: { items: done.reverted.map((ci) => ({ name: ci.item.name.th, quantity: ci.quantity })) },
      });
    }
  };

  // คืนรายการที่ยกเลิก (void) ไปแล้ว — ออเดอร์ที่ถูกยกเลิกทั้งใบ (void ครบทุกรายการ) คืนไม่ได้
  // รายการที่ถูกยกเลิกตอนยังไม่เสิร์ฟ กลับมาเป็น "ยังไม่เสิร์ฟ" (ถ้าออเดอร์ย้ายไปรอชำระแล้ว ดึงกลับเป็นกำลังเตรียม)
  const handleRestoreItem = async (orderId: string, cartId: string) => {
    const ref = doc(db, "orders", orderId);
    const done = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const raw = snap.data();
      if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw notUndoableError(raw.status);
      const items: CartItem[] = raw.items || [];
      const served: Record<string, unknown> = raw.servedAt || {};
      const target = items.find((ci) => ci.cartId === cartId);
      if (!target || !target.voided) return null;
      const newItems = items.map((ci) => {
        if (ci.cartId !== cartId) return ci;
        const { voided: _v, voidReason: _r, voidedAt: _a, voidedWhileUnserved: _u, ...rest } = ci;
        return rest;
      });
      if (raw.status === "awaiting-payment" && target.voidedWhileUnserved && !served[cartId]) {
        tx.update(ref, "items", newItems, "status", "in-progress", ...keepServedArgs(items, served, cartId));
      } else {
        tx.update(ref, { items: newItems });
      }
      return { raw, target };
    });
    if (done) {
      await logActivity({
        action: "restore_item",
        orderId,
        tableNumber: logTableOf(done.raw),
        itemName: done.target.item.name.th,
        amount: cartItemUnitPrice(done.target) * done.target.quantity,
      });
    }
  };

  // mark 1 รายการใน order เป็น voided — ยังคงอยู่ใน items[] เสมอ (ห้ามลบออกจาก array)
  // + ตัดรูปทิ้ง + เขียน log void_item ถ้าทุกรายการถูก void หมด เปลี่ยน status เป็น "cancelled" (ไม่ลบ doc)
  // billTotalBefore: ส่งมาเฉพาะตอน void จากหน้าชำระเงิน — ยอดบิลที่พนักงานเห็นบนการ์ดก่อนกด
  // (โต๊ะ = รวมทุกออเดอร์ของโต๊ะ) ใช้บันทึก "ยอดเดิม → ยอดใหม่" ลง log
  const voidOrderItem = async (order: Order, cartId: string, reason: string, billTotalBefore?: number) => {
    const target = order.items.find((ci) => ci.cartId === cartId);
    if (!target || target.voided) return;
    const amount = cartItemUnitPrice(target) * target.quantity;
    const newItems = order.items.map((ci) =>
      ci.cartId === cartId
        ? stripItemPhoto({
            ...ci,
            voided: true,
            ...(reason ? { voidReason: reason } : {}),
            voidedAt: new Date(),
            ...(order.status === "in-progress" && !order.servedAt?.[cartId] ? { voidedWhileUnserved: true } : {}),
          })
        : ci
    );
    const allVoided = newItems.every((ci) => ci.voided);
    // void รายการสุดท้ายที่ยังไม่เสิร์ฟ แล้วที่เหลือเสิร์ฟครบหมดแล้ว — ออเดอร์ต้องย้ายไปรอชำระ ไม่งั้นจะค้าง
    // อยู่ในโซนกำลังเตรียมแบบไม่มีรายการให้กด
    const allServedNow =
      !allVoided &&
      order.status === "in-progress" &&
      liveItems(newItems).every((ci) => !!order.servedAt?.[ci.cartId]);
    await logActivity({
      action: "void_item",
      orderId: order.id,
      tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
      itemName: target.item.name.th,
      amount,
      reason,
      ...(billTotalBefore !== undefined
        ? { details: { billTotalBefore, billTotalAfter: billTotalBefore - amount } }
        : {}),
    });
    await addVoidReason(reason);
    await updateDoc(doc(db, "orders", order.id), {
      items: newItems,
      ...(allVoided
        ? { status: "cancelled", ...(reason ? { cancelReason: reason } : {}), cancelledAt: new Date() }
        : allServedNow
          ? { status: "awaiting-payment" }
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
      ...(reason ? { cancelReason: reason } : {}),
      cancelledAt: new Date(),
      items: order.items.map(stripItemPhoto), // ออเดอร์ที่ถูกยกเลิก ไม่เก็บรูปไว้เลย
    });
  };

  // ฟิลด์การชำระเงินที่เขียนลงออเดอร์ 1 ใบ — transferAmount คือส่วนโอนของ "ใบนี้" (split เท่านั้น)
  const paymentFields = (payment: PaymentInput, orderTransferAmount?: number) => ({
    paymentMethod: payment.method,
    ...(payment.cashReceived !== undefined ? { cashReceived: payment.cashReceived } : {}),
    ...(payment.method === "split" && orderTransferAmount !== undefined ? { transferAmount: orderTransferAmount } : {}),
  });

  // สร้างบิลเป็น "paid" ในการเขียนครั้งเดียว (ต้องมี rules ทางที่ 2 ของ /orders) — ไม่เคยเป็น in-progress
  // จึงไม่เข้า listener ออเดอร์ active → ไม่ auto-print / ไม่มีเสียง / ไม่กระทบตัวนับร้านยุ่ง / ไม่ใช้ counter คิว T-n
  // createdAt = เวลาที่กรอก (ห้ามใช้ serverTimestamp ไม่งั้นบิลไปตกวันนี้) — History/Stats จัดวันจาก field นี้
  const handleSaveBackfill = async (payment: PaymentInput) => {
    if (isSubmittingBackfillRef.current) return;
    if (!backfill || manualCart.length === 0) return;
    if (!manualIsTakeaway && !manualTable) return;
    const soldAt = new Date(`${backfill.date}T${backfill.time}:00`);
    if (Number.isNaN(soldAt.getTime()) || soldAt > new Date()) {
      setBackfillError(lang === "en" ? "Invalid date/time" : "วันที่/เวลาไม่ถูกต้อง");
      return;
    }
    isSubmittingBackfillRef.current = true;
    setIsSubmittingBackfill(true);
    setBackfillError(null);
    try {
      const cleanItems = (JSON.parse(JSON.stringify(manualCart)) as CartItem[]).map(stripItemPhoto);
      const takeawayLabel = "กลับบ้าน";
      const ref = await addDoc(collection(db, "orders"), {
        tableNumber: manualIsTakeaway ? "0" : manualTable,
        ...(manualIsTakeaway ? { isTakeaway: true, takeawayLabel } : {}),
        items: cleanItems,
        status: "paid",
        ...paymentFields(payment, payment.transferAmount),
        paymentBatchId: uid(),
        createdAt: Timestamp.fromDate(soldAt),
        backfilled: true,
        backfilledAt: serverTimestamp(),
      });
      await logActivity({
        action: "backfill_order",
        orderId: ref.id,
        tableNumber: manualIsTakeaway ? takeawayLabel : manualTable!,
        amount: cartTotal(cleanItems),
        details: {
          billDate: backfill.date,
          billTime: backfill.time,
          paymentMethod: payment.method,
          ...(payment.method === "split" ? { transferAmount: payment.transferAmount } : {}),
          itemCount: liveItemCount(cleanItems),
        },
      });
      invalidatePaidOrdersDay(backfill.date); // ให้หน้าประวัติ/สถิติดึงวันนั้นใหม่ เห็นบิลที่เพิ่งลง
      setHistoryInitialDate(backfill.date);
      setManualCart([]);
      setManualTable(null);
      setManualIsTakeaway(false);
      setBackfill(null);
      setStaffTab("history");
      writeSession("staffTab", "history");
      setView("staff-history");
    } catch (err) {
      console.error("save backfill failed", err);
      setBackfillError(
        lang === "en"
          ? "Couldn't save. Check the internet and try again."
          : "บันทึกไม่สำเร็จ เช็คอินเทอร์เน็ตแล้วลองใหม่ (ถ้ายังไม่ได้ แจ้งเจ้าของร้านเช็คสิทธิ์ใน Firebase)",
      );
    } finally {
      isSubmittingBackfillRef.current = false;
      setIsSubmittingBackfill(false);
    }
  };

  // ยกเลิกบิลย้อนหลัง (จากหน้าประวัติ ถามยืนยันแล้ว) — ห้ามลบ doc ตาม rules จึงเปลี่ยนเป็น "cancelled" แทน
  // แตะเฉพาะบิลที่ backfilled เท่านั้น บิลปกติไม่มีทางถูกยกเลิกจากหน้านี้
  const handleCancelBackfill = async (toCancel: Order[]) => {
    for (const o of toCancel) {
      if (!o.backfilled || o.status !== "paid") continue;
      await logActivity({
        action: "cancel_order",
        orderId: o.id,
        tableNumber: o.isTakeaway ? o.takeawayLabel ?? o.tableNumber : o.tableNumber,
        amount: orderTotal(o),
        details: {
          backfilled: true,
          billDate: formatDateInput(o.timestamp),
          billTime: formatClock(o.timestamp),
          items: o.items.map((ci) => ({
            name: ci.item.name.th,
            quantity: ci.quantity,
            unitPrice: cartItemUnitPrice(ci),
            voided: !!ci.voided,
          })),
        },
      });
      await updateDoc(doc(db, "orders", o.id), { status: "cancelled", cancelledAt: new Date() });
      invalidatePaidOrdersDay(formatDateInput(o.timestamp));
    }
  };

  // ปิดบิลโต๊ะ — อ่านออเดอร์ค้างของโต๊ะใหม่จาก server ใน transaction แล้วปิดทุกรอบพร้อมกัน (สำเร็จหมดหรือไม่ปิดเลย)
  // ไม่ยอมปิดถ้า: ยังมีรอบที่ยังไม่เสิร์ฟ (ไม่งั้นรอบนั้นค้างไปรวมกับบิลลูกค้าคนถัดไป) หรือชุดออเดอร์/ยอดไม่ตรงกับ
  // ที่พนักงานเห็นบนการ์ด (expected) เช่นอีกเครื่องเพิ่งเสิร์ฟรอบใหม่เข้ามา — เงินที่รับมาคิดจากยอดบนจอ
  // พร้อมกันนั้นจดเวลาปิดบิลของโต๊ะลง status/tableClosures ให้หน้าเว็บลูกค้าคนเก่าที่เปิดค้างสั่งต่อไม่ได้
  const handleCloseTable = async (tableNum: string, payment: PaymentInput, expected: { orderIds: string[]; total: number }) => {
    const batchId = uid();
    await runTransaction(db, async (tx) => {
      // อ่าน+เขียน closures doc ทุกครั้ง = guard: สองเครื่องปิดโต๊ะเดียวกันพร้อมกันจะชนกันแล้ว retry
      // (retry รัน query ใหม่ เห็นว่าอีกเครื่องปิดไปแล้ว → "nothing")
      const closuresRef = doc(db, "status", TABLE_CLOSURES_DOC);
      await tx.get(closuresRef);
      const snap = await getDocs(query(
        collection(db, "orders"),
        where("tableNumber", "==", tableNum),
        where("status", "in", ["in-progress", "awaiting-payment"]),
      ));
      const fresh = (await Promise.all(snap.docs.map((d) => tx.get(doc(db, "orders", d.id))))).filter((s) => s.exists());
      const plan = planTableClose(
        tableNum,
        fresh.map((s) => {
          const o = mapOrderDoc(s.id, s.data());
          return { id: s.id, tableNumber: o.tableNumber, status: o.status, isTakeaway: o.isTakeaway, createdAtMs: o.timestamp.getTime(), total: orderTotal(o) };
        }),
        expected,
      );
      if (plan.kind !== "ok") throw new CloseTableError(plan.kind);
      const transferShares = payment.method === "split"
        ? allocateTransfer(plan.toClose.map((o) => o.total), payment.transferAmount ?? 0)
        : [];
      plan.toClose.forEach((o, i) =>
        tx.update(doc(db, "orders", o.id), {
          status: "paid",
          paymentBatchId: batchId,
          ...paymentFields(payment, transferShares[i]),
        }),
      );
      tx.set(closuresRef, { closedAt: { [tableNum]: serverTimestamp() } }, { merge: true });
    });
    setSelectedPayTable(null);
  };
  const closeTableWithNotice = (tableNum: string, payment: PaymentInput, expected: { orderIds: string[]; total: number }) => {
    const en = lang === "en";
    handleCloseTable(tableNum, payment, expected).catch((err) => {
      if (err instanceof CloseTableError) {
        setNotice(
          err.code === "pending"
            ? (en ? `Table ${tableNum} still has unserved items — serve or cancel them before closing the bill.` : `โต๊ะ ${tableNum} ยังมีรายการที่ยังไม่เสิร์ฟ — เสิร์ฟหรือยกเลิกก่อนปิดบิล`)
            : err.code === "changed"
              ? (en ? `Table ${tableNum}'s bill just changed (another device). Check the total and close again.` : `บิลโต๊ะ ${tableNum} เพิ่งเปลี่ยน (จากอีกเครื่อง) — ตรวจยอดอีกครั้งแล้วกดปิดบิลใหม่`)
              : (en ? `Table ${tableNum}'s bill is already closed.` : `บิลโต๊ะ ${tableNum} ถูกปิดไปแล้ว`),
        );
      } else {
        setNotice((en ? "Could not close the bill: " : "ปิดบิลไม่สำเร็จ: ") + (err?.message || String(err)));
      }
    });
  };

  // ย้ายโต๊ะ — ทุกออเดอร์ค้าง (in-progress + awaiting-payment) ของโต๊ะเดิมไปโต๊ะใหม่ใน transaction เดียว
  // สำเร็จทั้งหมดหรือไม่ย้ายเลย + เขียน activity log ในก้อนเดียวกัน ออเดอร์ที่จ่ายแล้ว/ยกเลิก/กลับบ้านไม่แตะ
  // การพิมพ์ใบย้ายไม่ได้ทำที่นี่ — orders listener ของทุกเครื่องเห็น moveId ใหม่แล้วพิมพ์เอง (ดู tableMove.ts)
  const handleMoveTable = async (from: string, to: string) => {
    if (from === to) return;
    const moveId = uid();
    // กรอง status ใน query เสมอ — ไม่งั้นอ่านประวัติทั้งหมดของโต๊ะนั้น
    const activeAt = (table: string) =>
      getDocs(query(
        collection(db, "orders"),
        where("tableNumber", "==", table),
        where("status", "in", ["in-progress", "awaiting-payment"]),
      ));
    const isMovable = (raw: any) =>
      raw.isTakeaway !== true && (raw.status === "in-progress" || raw.status === "awaiting-payment");

    await runTransaction(db, async (tx) => {
      const guardRef = doc(db, "counters", TABLE_MOVE_GUARD);
      await tx.get(guardRef);
      // query อยู่นอก read set แต่รันใหม่ทุกครั้งที่ transaction retry (guard ชน) จึงเห็นการย้ายที่ commit ก่อนหน้าเสมอ
      const [targetSnap, sourceSnap] = await Promise.all([activeAt(to), activeAt(from)]);
      if (targetSnap.docs.some((d) => isMovable(d.data()))) throw new MoveTableError("occupied");
      const sourceDocs = await Promise.all(sourceSnap.docs.map((d) => tx.get(doc(db, "orders", d.id))));
      const moving = sourceDocs.filter((s) => s.exists() && s.data().tableNumber === from && isMovable(s.data()));
      if (moving.length === 0) throw new MoveTableError("nothing");

      moving.forEach((s) =>
        tx.update(s.ref, { tableNumber: to, moveId, movedFrom: from, movedAt: serverTimestamp() }),
      );
      tx.set(guardRef, { lastMoveId: moveId, lastFrom: from, lastTo: to, lastMoveAt: serverTimestamp() }, { merge: true });
      const action: ActivityAction = "table_moved";
      tx.set(doc(collection(db, "activityLogs")), {
        action,
        tableNumber: from,
        amount: moving.reduce((sum, s) => sum + orderTotal(mapOrderDoc(s.id, s.data())), 0),
        details: { from, to, moveId, orderIds: moving.map((s) => s.id), orderCount: moving.length },
        createdAt: serverTimestamp(),
      });
    });
  };

  // ปุ่มย้ายโต๊ะ (หน้าออเดอร์/จ่ายเงิน) → เลือกโต๊ะปลายทาง → ยืนยัน → ย้าย
  const [moveFromTable, setMoveFromTable] = useState<string | null>(null);
  const confirmMoveTable = (from: string, to: string) => {
    setMoveFromTable(null);
    const t = T[lang];
    const n = activeDineInOrders(orders, from).length;
    askConfirm(t.moveTableConfirm(n, from, to), () => {
      handleMoveTable(from, to).catch((err) => {
        if (err instanceof MoveTableError) setNotice(err.code === "occupied" ? t.moveTableOccupied(to) : t.moveTableNothing(from));
        else setNotice(t.moveTableFailed + (err?.message || String(err)));
      });
    }, { confirmLabel: t.moveTableConfirmYes });
  };

  const handleCloseTakeawayOrder = async (orderId: string, payment: PaymentInput) => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "paid",
      ...paymentFields(payment, payment.transferAmount),
    });
  };

  // ปรับจำนวนรายการตอนชำระเงิน — ลดจนเหลือ 0 = void (ต้องกรอกเหตุผลก่อน) แทนการลบออกจาก array
  // ปรับ +1/-1 แบบไม่ถึง void ก็ต้องกรอกเหตุผลก่อนเช่นกัน แล้วบันทึก log adjust_item_qty
  // (ตอน AUDIT_UI_ENABLED = false askReason จะข้ามหน้าต่างแล้วทำงานทันที — ดู askReason)
  const handleAdjustPaymentItem = async (contributingOrders: Order[], key: string, delta: number) => {
    // ยอดบิลของทั้งโต๊ะ (ตรงกับตัวเลขบนการ์ดหน้าชำระเงิน) ณ ตอนกด
    const billTotalBefore = contributingOrders.reduce((s, o) => s + orderTotal(o), 0);
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
            const amount = delta * cartItemUnitPrice(target);
            await logActivity({
              action: "adjust_item_qty",
              orderId: order.id,
              tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
              itemName: target.item.name.th,
              amount,
              reason,
              details: { oldQty, newQty, billTotalBefore, billTotalAfter: billTotalBefore + amount },
            });
          })();
        });
      } else {
        askVoidItem(target, (reason) => {
          void voidOrderItem(order, target.cartId, reason, billTotalBefore);
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
    const billTotalBefore = orderTotal(order);
    if (newQty > 0) {
      const oldQty = target.quantity;
      askReason(T[lang].adjustItemReasonTitle, (reason) => {
        void (async () => {
          const newItems = order.items.map((ci) =>
            ci.cartId === target.cartId ? { ...ci, quantity: newQty } : ci
          );
          await updateDoc(doc(db, "orders", orderId), { items: newItems });
          const amount = delta * cartItemUnitPrice(target);
          await logActivity({
            action: "adjust_item_qty",
            orderId,
            tableNumber: order.isTakeaway ? order.takeawayLabel ?? order.tableNumber : order.tableNumber,
            itemName: target.item.name.th,
            amount,
            reason,
            details: { oldQty, newQty, billTotalBefore, billTotalAfter: billTotalBefore + amount },
          });
        })();
      });
    } else {
      askVoidItem(target, (reason) => {
        void voidOrderItem(order, target.cartId, reason, billTotalBefore);
      });
    }
  };

  const handleStaffTabChange = (tab: StaffTab) => {
    setHistoryInitialDate(undefined);
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

    // setDoc เขียนทับทั้ง doc — สถานะการขายทั้งหมด (เมนู + ตัวเลือกเนื้อสัตว์) เอาจากค่าล่าสุด ดู withLiveAvailability
    await setDoc(doc(db, "menuItems", item.id), { ...withLiveAvailability(item, prev), photo });
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

  // เขียนทั้งสองฟิลด์ทุกครั้ง สถานะจะได้ไม่ค้างข้ามกัน (เช่นซ่อนเมนูที่หมดอยู่ แล้วเปิดกลับมากลายเป็นหมดเอง)
  const handleSetAvailability = async (item: MenuItem, availability: MenuAvailability) => {
    await updateDoc(doc(db, "menuItems", item.id), {
      active: availability !== "hidden",
      soldOut: availability === "soldOut",
    });
  };

  // สลับ หมด/ขาย ของตัวเลือกเนื้อสัตว์ 1 ตัว (ชิปในหน้าจัดการเมนู) — บันทึกทันที ไม่ผ่านหน้าแก้เมนู
  // แบบในตัว: เพิ่ม/ลบใน soldOutMeats แบบ atomic | แบบกลุ่ม: Firestore แก้ element ใน array ตรงๆ ไม่ได้
  // จึงเขียน customGroups ทั้งก้อนใหม่ โดยเริ่มจากข้อมูลล่าสุดใน allMenuItems (realtime) แล้วแก้แค่ตัวเลือกนั้น
  const handleToggleMeatSoldOut = async (item: MenuItem, option: MeatOption) => {
    const ref = doc(db, "menuItems", item.id);
    if (option.meat) {
      await updateDoc(ref, { soldOutMeats: option.soldOut ? arrayRemove(option.meat) : arrayUnion(option.meat) });
      return;
    }
    const live = allMenuItems.find((m) => m.id === item.id) ?? item;
    const customGroups = (live.customGroups || []).map((g) =>
      g.id !== option.groupId ? g : {
        ...g,
        choices: g.choices.map((c) => {
          if (c.id !== option.choiceId) return c;
          if (!option.soldOut) return { ...c, soldOut: true };
          const { soldOut: _soldOut, ...rest } = c; // กลับมาขาย = ลบฟิลด์ออก (ไม่มีค่า = ขายปกติ)
          return rest;
        }),
      });
    await updateDoc(ref, { customGroups });
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

  // หน้าเลือกเมนูของ flow สั่งแทน: บิลย้อนหลังเลือกเมนูที่ "หมด" ตอนนี้ได้ (ที่ซ่อนไม่แสดงเหมือนเดิม)
  const manualMenuItems = backfill ? menuItems.map(ignoreSoldOut) : menuItems;
  const backfillNotice = backfill
    ? `${lang === "en" ? "Past bill" : "บิลย้อนหลัง"} · ${new Date(`${backfill.date}T00:00:00`).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { day: "numeric", month: "short" })} ${backfill.time}`
    : undefined;

  const handleAddCategory = async (nameEn: string, nameTh: string) => {
    const newOrder = allCategories.length > 0 ? Math.max(...allCategories.map((c) => c.order)) + 1 : 0;
    await addDoc(collection(db, "categories"), { nameEn, nameTh, order: newOrder, active: true });
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

  // ดาวในหน้าจัดการเมนู: เปิด = ต่อท้ายแถบ "แนะนำ" | ปิด = ลบทั้งสองฟิลด์ (ไม่มีค่า = ไม่แนะนำ)
  const handleToggleRecommended = async (item: MenuItem) => {
    const ref = doc(db, "menuItems", item.id);
    const live = allMenuItems.find((m) => m.id === item.id) ?? item;
    if (live.recommended) {
      await updateDoc(ref, { recommended: deleteField(), recommendedOrder: deleteField() });
      return;
    }
    const orders = allMenuItems.filter((m) => m.recommended).map((m) => m.recommendedOrder ?? -1);
    await updateDoc(ref, { recommended: true, recommendedOrder: orders.length > 0 ? Math.max(...orders) + 1 : 0 });
  };

  const handleReorderRecommended = async (orderedIds: string[]) => {
    await Promise.all(
      orderedIds.map((id, i) => updateDoc(doc(db, "menuItems", id), { recommendedOrder: i }))
    );
  };

  // เพิ่มรายการซื้อของ 1 บรรทัดเข้าไปในวันที่ระบุ (สร้าง doc ของวันนั้นถ้ายังไม่มี)
  // แล้วอัปเดต "รายชื่อของที่เคยกรอก" (expenseItems) ไว้ใช้ทำ autocomplete ต่อ
  const handleAddExpenseItem = async (date: string, item: ExpenseLineItem) => {
    // listener เพิ่งเริ่ม (เพิ่งเข้าหน้า) ยังไม่ได้ข้อมูล → อ่าน doc วันนั้นตรงๆ กันเขียนทับรายการเดิมหาย
    let existing: ExpenseDay | undefined = expenseDays.find((e) => e.id === date);
    if (!expensesSyncedRef.current) {
      const snap = await getDoc(doc(db, "expenses", date));
      existing = snap.exists() ? ({ id: snap.id, items: snap.data().items || [] } as ExpenseDay) : undefined;
    }
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
      content = <LinkExpiredScreen lang={lang} reason={expiredReason ?? "unknown"} />;
      break;

    case "item-detail": {
      const isManualFlow = !!manualSelectedItem;
      const activeItem = isManualFlow ? manualSelectedItem : selectedItem;
      content = activeItem ? (
        <ItemDetailScreen
          lang={lang}
          tableNumber={isManualFlow ? (manualIsTakeaway ? "0" : manualTable!) : tableNumber!}
          // ส่งข้อมูลสดจาก menuItems ไม่ใช่ activeItem ที่ copy ไว้ตอนกดเข้ามา — กด "หมด" (ทั้งเมนูหรือเนื้อสัตว์)
          // ระหว่างเปิดหน้านี้ค้างไว้ก็เห็นทันที (ฝั่งพนักงาน realtime; ฝั่งลูกค้าตาม cache)
          item={(isManualFlow ? manualMenuItems : menuItems).find((m) => m.id === activeItem.id) ?? activeItem}
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
          isStaffMode={isManualFlow}
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
          unavailableCartIds={cartUnavailableCartIds}
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
      content = !authChecked ? (
        <div className="min-h-screen bg-[#3C2414] flex flex-col items-center justify-center gap-5">
          <img src={logo} alt="Hueanyong Kitchen" className="w-28 h-28 object-contain" />
          <Loader2 size={22} className="animate-spin text-[#E6D5BA]/60" />
        </div>
      ) : (
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
            onUnmarkServed={handleUnmarkServed}
            onServeItem={handleServeItem}
            onUnserveItem={handleUnserveItem}
            onRestoreItem={handleRestoreItem}
            onRemoveItem={(orderId, cartId, onVoided) => {
              const target = orders.find((o) => o.id === orderId)?.items.find((ci) => ci.cartId === cartId);
              if (target) askVoidItem(target, (reason) => onVoided(handleRemoveOrderItem(orderId, cartId, reason)));
            }}
            onCancelOrder={(orderId) =>
              askCancelOrder((reason) => handleCancelOrder(orderId, reason))
            }
            onTabChange={handleStaffTabChange}
            onLogout={handleLogout}
            onLangToggle={toggleLang}
            onAskConfirm={askConfirm}
            onNotice={setNotice}
            onStartManualOrder={handleStartManualOrder}
            onMoveTable={setMoveFromTable}
            categories={allCategories}
            tableClosedAt={tableClosedAt}
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
            onCloseTable={closeTableWithNotice}
            onCloseTakeaway={handleCloseTakeawayOrder}
            onServeItem={handleServeItem}
            onRemoveItem={(orderId, cartId) => {
              const target = orders.find((o) => o.id === orderId)?.items.find((ci) => ci.cartId === cartId);
              if (target) {
                askVoidItem(target, (reason) =>
                  handleRemoveOrderItem(orderId, cartId, reason).catch((err) =>
                    setNotice((lang === "en" ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err))),
                  ),
                );
              }
            }}
            onAdjustItem={handleAdjustPaymentItem}
            onAdjustTakeawayItem={handleAdjustTakeawayItem}
            onRestoreItem={handleRestoreItem}
            onCancelOrder={(orderId) =>
              askCancelOrder((reason) => handleCancelOrder(orderId, reason))
            }
            onCancelOrders={(orderIds) =>
              askCancelOrder((reason) =>
                orderIds.forEach((id) => handleCancelOrder(id, reason))
              )
            }
            onAskConfirm={askConfirm}
            onNotice={setNotice}
            onMoveTable={setMoveFromTable}
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
            onSetAvailability={handleSetAvailability}
            onToggleMeatSoldOut={handleToggleMeatSoldOut}
            onDelete={handleDeleteItem}
            onAddCategory={handleAddCategory}
            onDeleteCategory={handleDeleteCategory}
            onToggleRecommended={handleToggleRecommended}
            onReorderRecommended={handleReorderRecommended}
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
            initialDate={historyInitialDate}
            onAddBackfill={handleStartBackfill}
            onCancelBackfill={handleCancelBackfill}
            onAskConfirm={askConfirm}
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
            onNotice={setNotice}
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
            menuItems={manualMenuItems}
            categories={categories}
            activeCategory={manualCategory}
            onCategoryChange={setManualCategory}
            onItemClick={(item) => { setManualSelectedItem(item); setView("item-detail"); }}
            onViewCart={() => setView("staff-manual-cart")}
            onLangToggle={toggleLang}
            isTakeaway={manualIsTakeaway}
            onExit={handleExitManualOrder}
            onAddOn={() => setView("staff-manual-addon")}
            notice={backfillNotice}
          />
        </Suspense>
      );
      break;

    case "staff-manual-addon":
      content = (
        <Suspense fallback={staffLoadingFallback}>
          <StaffAddOnScreen
            lang={lang}
            onAdd={handleManualAddOn}
            onCancel={() => setView("staff-manual-menu")}
            onLangToggle={toggleLang}
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
            onConfirm={backfill ? () => { setBackfillError(null); setView("staff-backfill-payment"); } : handleConfirmManualOrder}
            onLangToggle={toggleLang}
            isTakeaway={manualIsTakeaway}
            submitting={isSubmittingManualOrder}
            unavailableCartIds={backfill ? [] : cartUnavailableCartIds}
            confirmLabel={backfill ? (lang === "en" ? "Next: payment" : "ถัดไป: วิธีจ่าย") : undefined}
            notice={backfillNotice}
          />
        </Suspense>
      );
      break;

    case "staff-backfill-setup":
      content = backfill ? (
        <Suspense fallback={staffLoadingFallback}>
          <StaffBackfillSetupScreen
            lang={lang}
            date={backfill.date}
            initialTime={backfill.time}
            onPickTable={handlePickBackfillTable}
            onPickTakeaway={handlePickBackfillTakeaway}
            onCancel={() => { setBackfill(null); setView("staff-history"); }}
            onLangToggle={toggleLang}
          />
        </Suspense>
      ) : null;
      break;

    case "staff-backfill-payment":
      content = backfill ? (
        <Suspense fallback={staffLoadingFallback}>
          <StaffBackfillPaymentScreen
            lang={lang}
            date={backfill.date}
            time={backfill.time}
            tableNumber={manualTable}
            isTakeaway={manualIsTakeaway}
            cart={manualCart}
            submitting={isSubmittingBackfill}
            error={backfillError}
            onBack={() => setView("staff-manual-cart")}
            onSave={handleSaveBackfill}
            onLangToggle={toggleLang}
          />
        </Suspense>
      ) : null;
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
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          tone={confirmDialog.tone}
          lang={lang}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {notice && <NoticeModal message={notice} lang={lang} onClose={() => setNotice(null)} />}
      {moveFromTable && (
        <Suspense fallback={null}>
          <MoveTableModal
            lang={lang}
            from={moveFromTable}
            occupied={occupiedTables(orders)}
            onSelect={(to) => confirmMoveTable(moveFromTable, to)}
            onCancel={() => setMoveFromTable(null)}
          />
        </Suspense>
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
