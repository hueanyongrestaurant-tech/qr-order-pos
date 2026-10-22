import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
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
import { writeBatch, collection, addDoc, setDoc, onSnapshot, query, orderBy, where, limit, getDocs, getDoc, doc, updateDoc, deleteDoc, serverTimestamp, Timestamp, runTransaction, arrayUnion, arrayRemove, increment, deleteField, FieldPath, type Transaction, type DocumentReference } from "firebase/firestore";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { buildMenuSnapshot, readMenuSnapshot, readMenuSnapshotHash, writeMenuSnapshot } from "./menuSnapshot";
import { shouldTrackStock, soldOutAfterStockSet, stockNeeds, type StockEntry } from "./stock";
import type { StockFormValue } from "./staff/StaffMenuEditScreen";
import { createOrderTakingStock, runStockTransaction, STOCK_CONFIG_REF, StockShortError } from "./stockStore";
import {
  allPrepLinks, buildStockAlerts, choiceKey, guestLineDocIds, isPrepId, localSoldOutPatch, prepIsOut, prepSoldOutChanges, prepTrackedFor,
  setPrepOnChoices, staffLineDocIds, PREP_ID_PREFIX, type ChoiceRef, type PrepEntry,
} from "./prep";

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
import { ADD_ONS, ADDON_CATEGORY_ID, AUDIT_UI_ENABLED, STAFF_EMAIL } from "./constants";
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
  lineServedQty,
  lineFullyServed,
  planServe,
  planUnserve,
  planVoid,
  planAdjustQty,
  type LineChangePlan,
  type ServeState,
  orderSendOutcome,
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
  allocateTransfer,
} from "./utils";
import { hasLegacyOptions, LEGACY_OPTION_VALUES, normalizeMenuItem, setChoiceClosed } from "./menuOptions";
import { LannaBorder, RestaurantLogo } from "./shared";
// เฉพาะ printerStore เพราะเป็น localStorage ล้วน ไม่มี Capacitor — ส่วน nativePrinter.ts
// (import capacitor-thermal-printer) โหลดแบบ dynamic import เฉพาะตอนจะใช้จริงเท่านั้น ไม่งั้น
// ลูกค้าที่สแกน QR จะโดนดึง plugin ของฝั่งพนักงานไปรวมกับ chunk หลักด้วย
import { getPrintRole, getSelectedPrinterAddress } from "./staff/printerStore";
import { isSoundMuted } from "./staff/soundStore";
import { connectionAlertFrom, setConnectionAlert } from "./staff/connectionStore";
import { activeDineInOrders, buildMoveTicketOrder, moveBanner, occupiedTables, takeNewMoves } from "./staff/tableMove";
import { tableShort, tableTitle } from "./tables";
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
import { forgetCachedLink, getCustomerLink } from "./customerLink";
import { buildTableView, encodeTableView, lineFromCartItem, type SentOrder } from "./tableView";
import { fetchTableLink, writeTableView } from "./tableViewStore";
import { refreshTableLinks, useTableLinks } from "./staff/tableLinkStore";
import { OrderedSheet } from "./customer/OrderedSheet";

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

// เวลาปิดบิล/ย้ายโต๊ะล่าสุดของโต๊ะ (ms) — 0 = ไม่เคย, "error" = อ่านไม่ได้/ไม่ทันเวลา (ผู้เรียกต้องปล่อยผ่าน)
// ย้ายโต๊ะจดทั้ง closedAt (รอบนั่งของโต๊ะเดิมหมดอายุ ต้องสแกน QR ที่โต๊ะใหม่) และ movedAt (บอกลูกค้าว่า "ย้ายแล้ว")
async function fetchTableClosure(table: string): Promise<{ closedAt: number; movedAt: number } | "error"> {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "status", TABLE_CLOSURES_DOC)),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), CLOSURE_CHECK_TIMEOUT_MS)),
    ]);
    const ms = (ts: any) => (ts?.toMillis ? ts.toMillis() : 0);
    return { closedAt: ms(snap.data()?.closedAt?.[table]), movedAt: ms(snap.data()?.movedAt?.[table]) };
  } catch {
    return "error";
  }
}

// รายการที่เครื่องนี้ส่งในรอบนั่งนี้ (ลิงก์ ?t= เท่านั้น) — โชว์ "กำลังส่งเข้าร้าน" จนกว่าสรุปของโต๊ะจะมี (ดู tableView.ts)
const sentOrdersKey = (sessionId: string) => `${STORAGE_PREFIX}:sentOrders:${sessionId}`;
function readSentOrders(sessionId: string): SentOrder[] {
  try {
    const raw = sessionStorage.getItem(sentOrdersKey(sessionId));
    return raw === null ? [] : (JSON.parse(raw) as SentOrder[]);
  } catch {
    return [];
  }
}
function recordSentOrder(sessionId: string, sent: SentOrder) {
  try {
    const list = [...readSentOrders(sessionId).filter((s) => s.id !== sent.id), sent].slice(-20);
    sessionStorage.setItem(sentOrdersKey(sessionId), JSON.stringify(list));
  } catch { /* ignore */ }
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

// โต๊ะของลูกค้าจากลิงก์ที่เปิดเข้ามา (?t= หรือ ?table= — main.tsx ตัดสินไว้ก่อน render แล้ว) | null = ฝั่งพนักงาน
function getTableFromUrl(): string | null {
  const link = getCustomerLink();
  return link.kind === "token" || link.kind === "legacy" ? link.table : null;
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
// เขียน customGroups ทั้งก้อนลงเมนูแบบเดิม (ตัวเลือกในตัว) → ปิด field แบบเดิมไปพร้อมกัน ไม่งั้นอ่านแล้วกลุ่มซ้ำ
function legacyOptionsPatch(raw: MenuItem): Record<string, unknown> {
  return hasLegacyOptions(raw)
    ? {
      hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false,
      ...Object.fromEntries(LEGACY_OPTION_VALUES.map((k) => [k, deleteField()])),
    }
    : {};
}

// ผลของ prepSoldOutChanges เป็น patch ต่อเมนู (เมนูหมด/เปิด + ธง, customGroups ที่ตัวเลือกปิด/เปิด)
function prepSyncPatches(
  menus: MenuItem[],
  stockMap: Map<string, StockEntry>,
  prepMap: Map<string, PrepEntry>,
): Map<string, Record<string, unknown>> {
  const { close, reopen, groups } = prepSoldOutChanges(menus, stockMap, prepMap);
  const patches = new Map<string, Record<string, unknown>>();
  const add = (id: string, patch: Record<string, unknown>) => patches.set(id, { ...(patches.get(id) ?? {}), ...patch });
  close.forEach((id) => add(id, { soldOut: true, soldOutByPrep: true }));
  reopen.forEach((id) => add(id, { soldOut: false, soldOutByPrep: deleteField() }));
  groups.forEach((customGroups, id) => {
    const raw = menus.find((m) => m.id === id);
    add(id, { customGroups, ...(raw ? legacyOptionsPatch(raw) : {}) });
  });
  return patches;
}

// รอให้การแก้เมนูหลายจุดติดกัน (เช่นลากเรียงลำดับ = เขียนหลาย doc) นิ่งก่อนค่อยเขียน menu snapshot ครั้งเดียว
const MENU_SNAPSHOT_DEBOUNCE_MS = 2000;
// ออเดอร์เปลี่ยนติดๆ กัน (เสิร์ฟทีละรายการ) รวมเป็นการเขียนสรุปโต๊ะครั้งเดียว
const TABLE_VIEW_DEBOUNCE_MS = 1000;
// ลูกค้ากดส่งออเดอร์แล้ว server ไม่ตอบภายในนี้ = ขึ้น "ส่งไม่สำเร็จ" (ตะกร้ายังอยู่ กดส่งใหม่ได้ ดู handleConfirmOrder)
const ORDER_SEND_TIMEOUT_MS = 10000;
// listener ออเดอร์ฝั่งพนักงาน error แล้ว รอเท่านี้ก่อน subscribe ใหม่ (ไม่ยิงถี่ — แต่ละรอบอ่านออเดอร์ค้างใหม่ทั้งชุด)
const ORDERS_RETRY_MS = 30000;
// สถานะออฟไลน์ต้องค้างนานเท่านี้ก่อนขึ้นแถบเตือน — กันกระพริบตอนเน็ตสะดุดแป๊บเดียว
const CONNECTION_ALERT_DELAY_MS = 4000;

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
    setShowOrdered(false);
  };
  const revokeCustomerLink = () => {
    const link = getCustomerLink();
    if (link.kind === "token") forgetCachedLink(link.token);
    expireTableSession("revoked");
  };
  // "ที่สั่งไปแล้ว" — เฉพาะลิงก์ใหม่ (?t=) ลิงก์แบบเดิม (?table=) ไม่มี
  const customerLink = getCustomerLink();
  const customerToken = customerLink.kind === "token" ? customerLink.token : null;
  const [showOrdered, setShowOrdered] = useState(false);

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

  // allMenuItems = ข้อมูลดิบจาก Firestore (ใช้สร้าง menu snapshot ให้ hash ตรงกับเครื่องที่ยังเป็นแอปเก่า)
  // menuItems / staffMenuItems = ผ่าน normalizeMenuItem แล้ว (ตัวเลือกทั้งหมดอยู่ใน customGroups) — หน้าจอใช้ชุดนี้
  const [allMenuItems, setAllMenuItems] = useState<(MenuItem & { active?: boolean })[]>([]);
  const staffMenuItems = useMemo(() => allMenuItems.map(normalizeMenuItem), [allMenuItems]);
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
  // สัญญาณการเชื่อมต่อฝั่งพนักงาน (ดู connectionStore) — ordersRetry เพิ่มทีละ 1 เพื่อ subscribe listener ออเดอร์ใหม่หลัง error
  const [ordersFromCache, setOrdersFromCache] = useState(false);
  // true = orders listener ได้ข้อมูลจาก server แล้วอย่างน้อย 1 ครั้ง — gate การเขียนสรุป "ที่สั่งไปแล้ว"
  // (ก่อนหน้านั้น orders ว่าง/มาจาก cache — ห้ามเขียนสรุปว่างทับของจริง)
  const [ordersSynced, setOrdersSynced] = useState(false);
  const [ordersListenerError, setOrdersListenerError] = useState(false);
  const [ordersRetry, setOrdersRetry] = useState(0);
  const [browserOffline, setBrowserOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

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
      setMenuItems(data.filter((m) => m.active !== false).map(normalizeMenuItem));
      if (!snapshot.metadata.fromCache) setStaffMenuSynced(true);
    });
    return unsubscribe;
  }, []);

  // ─── สต็อก (ฝั่งพนักงานที่ล็อกอินแล้ว) — ดู stock.ts / stockStore.ts ───
  // stockMap = stock/* ทั้งหมด (เฉพาะเมนูที่ตั้งจำนวนไว้ มีไม่กี่ doc) | stockEnabled = สวิตช์ทั้งร้าน (ไม่มี doc = เปิด)
  // prepMap = ของเตรียม (stock/prep_* อยู่ใน listener เดียวกัน ไม่อ่านเพิ่ม — ดู prep.ts)
  // stockSynced = ได้ข้อมูล stock จาก server แล้ว — กันเปิดขายคืนผิดๆ ตอนเพิ่งเปิดแอปแล้ว cache ยังว่าง
  const [stockMap, setStockMap] = useState<Map<string, StockEntry>>(new Map());
  const [prepMap, setPrepMap] = useState<Map<string, PrepEntry>>(new Map());
  const [stockSynced, setStockSynced] = useState(false);
  const [stockEnabled, setStockEnabled] = useState(true);
  useEffect(() => {
    if (getTableFromUrl() !== null || !everAuthed) return;
    const unsubStock = onSnapshot(collection(db, "stock"), (snapshot) => {
      const next = new Map<string, StockEntry>();
      const nextPreps = new Map<string, PrepEntry>();
      snapshot.docs.forEach((d) => {
        const data = d.data();
        const alertAt = typeof data.alertAt === "number" ? { alertAt: data.alertAt } : {};
        if (isPrepId(d.id)) {
          nextPreps.set(d.id, {
            name: typeof data.name === "string" ? data.name : "",
            ...(typeof data.remaining === "number" ? { remaining: data.remaining } : {}),
            ...alertAt,
          });
          return;
        }
        if (typeof data.remaining !== "number") return;
        next.set(d.id, { remaining: data.remaining, ...alertAt });
      });
      setStockMap(next);
      setPrepMap(nextPreps);
      if (!snapshot.metadata.fromCache) setStockSynced(true);
    });
    const unsubConfig = onSnapshot(STOCK_CONFIG_REF(), (snap) => setStockEnabled(snap.data()?.enabled !== false));
    return () => { unsubStock(); unsubConfig(); };
  }, [everAuthed]);

  // สต็อกเหลือ ≤ 0 → กด "หมด" ให้ (ลูกค้าเขียน menuItems ไม่ได้ เครื่องพนักงานที่เปิดอยู่ทำแทน — หลายเครื่องเขียนค่าเดียวกันซ้ำได้ ไม่เป็นไร)
  // ไม่เปิดขายกลับเองเด็ดขาด — คืนสต็อกแล้วก็ยังหมดจนกว่าพนักงานจะกดเปิดขาย/ใส่จำนวนใหม่
  const autoSoldOutPendingRef = useRef(new Set<string>());
  useEffect(() => {
    if (getTableFromUrl() !== null || !staffLoggedIn || !stockEnabled) return;
    allMenuItems.forEach((m) => {
      const entry = stockMap.get(m.id);
      if (!entry || entry.remaining > 0 || !m.stockTracked || m.soldOut || m.active === false) return;
      if (autoSoldOutPendingRef.current.has(m.id)) return;
      autoSoldOutPendingRef.current.add(m.id);
      updateDoc(doc(db, "menuItems", m.id), { soldOut: true })
        .catch((err) => console.error("auto sold-out failed", err))
        .finally(() => autoSoldOutPendingRef.current.delete(m.id));
    });
  }, [stockMap, allMenuItems, stockEnabled, staffLoggedIn]);

  // ของเตรียมเหลือ ≤ 0 → กด "หมด" ทุกเมนูที่ผูกทั้งเมนู / ปิดทุกตัวเลือกที่ผูก (ติดธง soldOutByPrep)
  // เติม/ไม่จำกัด/ลบ/ถอดแล้ว → เปิดคืนเฉพาะที่มีธง (ที่พนักงานปิดเองไม่มีธง ปิดต่อไป)
  // รอข้อมูล stock และเมนูจาก server ก่อน ไม่งั้น cache ว่างทำให้เปิดคืนผิด
  const prepSoldOutPendingRef = useRef(new Set<string>());
  useEffect(() => {
    if (getTableFromUrl() !== null || !staffLoggedIn || !stockEnabled || !stockSynced || !staffMenuSynced) return;
    prepSyncPatches(allMenuItems, stockMap, prepMap).forEach((patch, id) => {
      if (prepSoldOutPendingRef.current.has(id)) return;
      prepSoldOutPendingRef.current.add(id);
      updateDoc(doc(db, "menuItems", id), patch)
        .catch((err) => console.error("prep sold-out sync failed", err))
        .finally(() => prepSoldOutPendingRef.current.delete(id));
    });
  }, [stockMap, prepMap, allMenuItems, stockEnabled, stockSynced, staffMenuSynced, staffLoggedIn]);

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
      setMenuItems(cached.menuItems.filter((m) => m.active !== false).map(normalizeMenuItem));
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
      setMenuItems(menuData.filter((m) => m.active !== false).map(normalizeMenuItem));
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

  // ─── สรุป "ที่สั่งไปแล้ว" ของแต่ละโต๊ะ (tableViews — ดู tableView.ts / tableViewStore.ts) ───
  // ทุกเครื่องพนักงานที่เปิดอยู่ช่วยเขียน: คำนวณจากออเดอร์ค้างใน listener เดิม (ไม่อ่านเพิ่ม) เขียนเฉพาะโต๊ะที่สรุปเปลี่ยน
  // รหัสของทุกโต๊ะอ่านครั้งเดียวตอนเปิดแอป (~1 read ต่อโต๊ะ) ไม่ฟังค้าง — เขียนแล้วไม่มี read ตามมา
  // ปิดบิล/ย้ายโต๊ะ: ออเดอร์หายจาก listener (หรือย้ายไปโต๊ะใหม่) → สรุปของโต๊ะเดิมว่างแล้วเขียนทับเอง
  const tableLinks = useTableLinks();
  const writtenTableViewHashRef = useRef(new Map<string, string>()); // token → hash ที่เขียนไปแล้ว/กำลังเขียน
  useEffect(() => {
    if (getTableFromUrl() !== null || !everAuthed) return;
    refreshTableLinks().catch((err) => console.error("read tableViews failed", err));
  }, [everAuthed]);
  useEffect(() => {
    if (getTableFromUrl() !== null || !everAuthed || !ordersSynced || !tableLinks) return;
    const timer = window.setTimeout(() => {
      tableLinks.forEach((link, table) => {
        const encoded = encodeTableView(buildTableView(orders, table));
        const written = writtenTableViewHashRef.current;
        if ((written.get(link.token) ?? link.hash) === encoded.hash) return;
        written.set(link.token, encoded.hash);
        writeTableView(link.token, encoded).catch((err) => {
          if (written.get(link.token) === encoded.hash) written.delete(link.token); // ลองใหม่รอบหน้า
          // อีกเครื่องสร้างรหัสใหม่ให้โต๊ะนี้ไปแล้ว (doc เดิมถูกลบ) — อ่านรหัสใหม่ แล้ว effect นี้จะเขียนให้เอง
          if (err?.code === "not-found") refreshTableLinks().catch(() => { });
          else console.error("write tableView failed", table, err);
        });
      });
    }, TABLE_VIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [everAuthed, ordersSynced, tableLinks, orders]);

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
    fetchTableClosure(initialSessionStart.session.table).then((closure) => {
      const cur = tableSessionRef.current;
      if (cancelled || closure === "error" || !cur || cur.baselineClosedAt !== undefined) return;
      tableSessionRef.current = { ...cur, baselineClosedAt: closure.closedAt };
      writeTableSession(tableSessionRef.current);
    });
    return () => { cancelled = true; };
  }, []);

  // เปิดหน้าค้างไว้เกิน 3 ชม. แล้วกลับมาดู → หน้าให้สแกนใหม่ทันที (ไม่ต้องรอกดสั่ง)
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
    let retryTimer: number | undefined;
    // includeMetadataChanges: ให้ listener แจ้งตอน SDK ต่อ server ไม่ได้/กลับมาได้ (metadata.fromCache) — ใช้ขึ้น
    // แถบเตือนออฟไลน์ (connectionStore) ไม่มี read เพิ่ม snapshot ที่เปลี่ยนแค่ metadata ข้ามงานอื่นทั้งหมด
    // error = listener ถูกปิดไปแล้ว → ขึ้นแถบเตือน แล้ว subscribe ใหม่หลัง ORDERS_RETRY_MS (ordersRetry ใน deps)
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      setOrdersFromCache(snapshot.metadata.fromCache);
      if (!snapshot.metadata.fromCache) setOrdersSynced(true);
      setOrdersListenerError(false);
      if (!isFirstOrdersSnapshotRef.current && snapshot.docChanges().length === 0) return; // metadata อย่างเดียว

      const data = snapshot.docs
        .map((d) => mapOrderDoc(d.id, d.data()))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      setOrders(data);
      const newMoves = takeNewMoves(seenMoveIds, data);

      if (isFirstOrdersSnapshotRef.current) {
        // เปิดแอปตอนเน็ตหลุด SDK ส่ง snapshot จาก cache (ว่าง) มาก่อน — ยังไม่นับเป็น "snapshot แรก" ไม่งั้นพอต่อได้
        // ออเดอร์ค้างทุกใบจะเข้ามาเป็น "added" แล้วพิมพ์ซ้ำทั้งหมด
        if (!snapshot.metadata.fromCache) isFirstOrdersSnapshotRef.current = false;
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
    }, (err) => {
      console.error("Orders listener failed:", err);
      setOrdersListenerError(true);
      retryTimer = window.setTimeout(() => setOrdersRetry((n) => n + 1), ORDERS_RETRY_MS);
    });
    return () => {
      unsubscribe();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [everAuthed, ordersRetry]);

  // แถบเตือนออฟไลน์ฝั่งพนักงาน — รวมสัญญาณแล้วส่งให้ StaffHeader ผ่าน connectionStore
  // ขึ้นหลังค้างนาน CONNECTION_ALERT_DELAY_MS (กันกระพริบตอนเน็ตสะดุดแป๊บเดียว) หายทันทีเมื่อกลับมาต่อได้
  useEffect(() => {
    if (getTableFromUrl() !== null) return;
    const update = () => setBrowserOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const alert = everAuthed && getTableFromUrl() === null
      ? connectionAlertFrom({ browserOffline, ordersFromCache, ordersError: ordersListenerError })
      : null;
    if (alert === null) {
      setConnectionAlert(null);
      return;
    }
    const timer = window.setTimeout(() => setConnectionAlert(alert), CONNECTION_ALERT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [everAuthed, browserOffline, ordersFromCache, ordersListenerError]);

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
  // ยกเลิกบางชิ้น: picked = พนักงานเลือกจำนวนจากหน้าต่างเลือกจำนวนแล้ว (นับเป็นการยืนยันแล้ว) → ถามแค่เหตุผล
  // ตอน flag เปิด / ไม่ได้ผ่านหน้าต่างเลือกจำนวน (เหลือ 1 ชิ้น) → askVoidItem แบบเดิม
  const askVoidQty = (item: CartItem, picked: boolean, onConfirm: (reason: string) => void) => {
    if (!picked) { askVoidItem(item, onConfirm); return; }
    askReason(T[lang].voidItemReasonTitle, onConfirm);
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
    setCartShortCartIds((prev) => prev.filter((id) => id !== cartId)); // แก้จำนวนแล้ว ลองส่งใหม่ได้
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
  // cartId ที่สต็อกเหลือไม่พอจำนวนที่สั่ง (ยังเหลืออยู่บ้าง) — ป้าย "เหลือไม่พอ" ลูกค้าไม่เห็นตัวเลข
  const [cartShortCartIds, setCartShortCartIds] = useState<string[]>([]);

  // เอาข้อมูลเมนูล่าสุดทับในเครื่อง + cache ฝั่งลูกค้าด้วย ไม่ต้องรอ cache 15 นาทีหมดอายุ
  const patchLocalMenu = (fresh: Map<string, Partial<MenuItem>>) => {
    const patch = <M extends MenuItem>(m: M): M => {
      const f = fresh.get(m.id);
      return f ? { ...m, ...f } : m;
    };
    setAllMenuItems((prev) => prev.map(patch));
    setMenuItems((prev) => prev.map(patch).filter((m) => m.active !== false).map(normalizeMenuItem));
    const cached = readMenuCache<{ categories: Category[]; menuItems: MenuItem[]; timestamp: number }>();
    if (cached) writeMenuCache({ ...cached, menuItems: cached.menuItems.map(patch) });
  };

  // blocked = มีรายการที่สั่งไม่ได้ในตะกร้า ห้ามส่ง | false = ส่งได้ (รวมกรณีเช็คไม่สำเร็จ/ช้าเกิน — ไม่ให้ลูกค้าติดส่งไม่ได้)
  // fresh = ข้อมูลเมนูล่าสุดจาก server (ว่าง = เช็คไม่ได้) — ใช้ต่อว่าเมนูไหนติดสต็อก
  const cartHasUnavailableItems = async (items: CartItem[]): Promise<{ blocked: boolean; fresh: Map<string, MenuItem> }> => {
    const fresh = await fetchFreshMenuItems(items.map((ci) => ci.item.id), SOLD_OUT_CHECK_TIMEOUT_MS);
    const unavailable = items.filter((ci) => {
      const f = fresh.get(ci.item.id);
      return f ? isCartItemUnavailable(ci, f) : false;
    });
    setCartUnavailableCartIds(unavailable.map((ci) => ci.cartId));
    setCartShortCartIds([]);
    if (unavailable.length === 0) return { blocked: false, fresh };
    patchLocalMenu(fresh);
    return { blocked: true, fresh };
  };

  // ตัดสต็อกไม่ผ่าน: เหลือ 0 = ป้าย "หมด" (+ ทำเมนูในเครื่องเป็นหมดทันที) / ยังเหลือแต่ไม่พอ = ป้าย "เหลือไม่พอ"
  // shortIds เป็น stock doc (สต็อกของเมนู หรือของเตรียม) — บรรทัดที่ใช้ doc นั้นโดนทุกบรรทัด (docIdsOf ตัวเดียวกับตอนคิด needs)
  // หมด → เมนูในเครื่องเป็นหมด หรือปิดเฉพาะตัวเลือกที่ผูกของเตรียมนั้น (localSoldOutPatch)
  const showStockShort = (items: CartItem[], err: StockShortError, docIdsOf: (ci: CartItem) => string[]) => {
    const outIds = err.shortIds.filter((id) => (err.current.get(id) ?? 0) <= 0);
    const lowIds = err.shortIds.filter((id) => !outIds.includes(id));
    const uses = (ci: CartItem, ids: string[]) => docIdsOf(ci).some((d) => ids.includes(d));
    setCartUnavailableCartIds(items.filter((ci) => uses(ci, outIds)).map((ci) => ci.cartId));
    setCartShortCartIds(items.filter((ci) => !uses(ci, outIds) && uses(ci, lowIds)).map((ci) => ci.cartId));
    if (outIds.length > 0) patchLocalMenu(localSoldOutPatch(allMenuItems, outIds));
  };
  // ตัดสำเร็จแล้วมี doc เหลือ 0 → เมนู/ตัวเลือกในเครื่องที่ใช้ doc นั้นเป็นหมดทันที (ไม่ต้องรอ cache/เครื่องพนักงาน)
  const patchSoldOutAfterTake = (soldOutIds: string[]) => {
    if (soldOutIds.length > 0) patchLocalMenu(localSoldOutPatch(allMenuItems, soldOutIds));
  };

  // เวลาของสรุป "ที่สั่งไปแล้ว" ที่อ่านได้ตอนเช็คก่อนส่งรอบล่าสุด (ดู pendingSentOrders)
  const viewUpdatedAtBeforeSendRef = useRef<number | undefined>(undefined);
  // เช็ครอบนั่งก่อนส่งออเดอร์: หมดอายุ 3 ชม. / โต๊ะถูกปิดบิลหรือย้ายไปหลังลูกค้าเปิดหน้า / ลิงก์ ?t= ถูกสร้างใหม่แทน
  // → หน้าให้สแกน QR ใหม่ | อ่านไม่ได้/ไม่ทัน → ปล่อยสั่งได้ตามปกติ (ไม่ให้ปัญหาเน็ตทำให้ลูกค้าจริงสั่งไม่ได้)
  const tableSessionExpiredBeforeOrder = async (): Promise<boolean> => {
    const session = tableSessionRef.current;
    if (!session) return false;
    if (session.expired) { expireTableSession(session.expired); return true; }
    if (isSessionTimedOut(session, Date.now())) { expireTableSession("timeout"); return true; }
    // ลิงก์ ?t=: รหัสยังใช้ได้ไหม (พนักงานกดสร้างรหัสใหม่ = ลิงก์เดิมใช้ไม่ได้) — อ่านไม่ได้ = ปล่อยผ่านเหมือนเวลาปิดบิล
    const link = getCustomerLink();
    const [closure, linkNow] = await Promise.all([
      fetchTableClosure(session.table),
      link.kind === "token" ? fetchTableLink(link.token, CLOSURE_CHECK_TIMEOUT_MS).catch(() => "error" as const) : Promise.resolve("error" as const),
    ]);
    if (link.kind === "token" && (linkNow === null || (linkNow !== "error" && linkNow.table !== session.table))) {
      revokeCustomerLink();
      return true;
    }
    viewUpdatedAtBeforeSendRef.current = linkNow && linkNow !== "error" ? linkNow.updatedAtMs : undefined;
    const result = checkClosure(session, closure === "error" ? "error" : closure.closedAt);
    if (result.session !== session) {
      tableSessionRef.current = result.session;
      writeTableSession(result.session);
    }
    if (result.expired) {
      expireTableSession(closure !== "error" && closure.movedAt > 0 && closure.movedAt >= closure.closedAt ? "moved" : "closed");
      return true;
    }
    return false;
  };

  // ออเดอร์ที่กำลังส่ง/ส่งไม่สำเร็จของตะกร้าปัจจุบัน — id ใช้ซ้ำตอนกดส่งใหม่, uncertain = เคยมีรอบที่ไม่รู้ผล
  const orderAttemptRef = useRef<{ id: string; signature: string; uncertain: boolean } | null>(null);
  // true = ขึ้นข้อความ "ส่งออเดอร์ไม่สำเร็จ กรุณาเรียกพนักงาน" ในหน้าตะกร้า (ตะกร้ายังอยู่ กดส่งใหม่ได้)
  const [orderSendFailed, setOrderSendFailed] = useState(false);
  // ตะกร้าล่าสุด (ไว้เช็คตอนออเดอร์ที่หมดเวลาไปแล้วส่งถึงทีหลัง — ลูกค้าแก้ตะกร้าไปแล้วห้ามล้างทิ้ง)
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const orderSignature = (items: CartItem[]) =>
    JSON.stringify([tableNumber, (JSON.parse(JSON.stringify(items)) as CartItem[]).map(stripItemPhoto)]);
  const finishOrderSent = () => {
    const attempt = orderAttemptRef.current;
    const session = tableSessionRef.current;
    if (customerToken && attempt && session) {
      recordSentOrder(session.id, {
        id: attempt.id,
        sentAt: Date.now(),
        lines: cartRef.current.map(lineFromCartItem),
        viewUpdatedAtMs: viewUpdatedAtBeforeSendRef.current,
      });
    }
    orderAttemptRef.current = null;
    setOrderSendFailed(false);
    setCart([]);
    setCartUnavailableCartIds([]);
    setCartShortCartIds([]);
    setView("order-sent");
  };

  const handleConfirmOrder = async () => {
    // กันกดปุ่ม/แตะจอซ้ำเร็ว ๆ (พบบ่อยทั้ง iOS และ Android) ที่ทำให้ยิง addDoc สองครั้ง
    // กลายเป็นออเดอร์เบิ้ล — เช็คด้วย ref เพราะ state อาจอัปเดตไม่ทันถ้าแตะรัวมาก
    if (isSubmittingOrderRef.current) return;
    if (!(tableNumber && cart.length > 0)) return;
    isSubmittingOrderRef.current = true;
    setIsSubmittingOrder(true);
    setOrderSendFailed(false);
    try {
      const { blocked, fresh } = await cartHasUnavailableItems(cart);
      if (blocked) return;
      if (await tableSessionExpiredBeforeOrder()) return;
      // JSON round-trip: ตัดฟิลด์ undefined ให้ Firestore | .map(stripItemPhoto): ตัดรูป base64 ที่ทำ doc บวม
      const cleanItems = (JSON.parse(JSON.stringify(cart)) as CartItem[]).map(stripItemPhoto);
      // ตะกร้าเดิม (โต๊ะ + รายการเหมือนเดิมเป๊ะ) ใช้ doc id เดิมทุกครั้งที่กดส่งใหม่ — ดู orderSendOutcome
      // แก้ตะกร้าแล้วถือเป็นออเดอร์ใหม่ สุ่ม id ใหม่
      const signature = orderSignature(cart);
      if (orderAttemptRef.current?.signature !== signature) {
        orderAttemptRef.current = { id: doc(collection(db, "orders")).id, signature, uncertain: false };
      }
      const attempt = orderAttemptRef.current;
      const orderRef = doc(db, "orders", attempt.id);
      const orderData = { tableNumber, items: cleanItems, status: "in-progress", createdAt: serverTimestamp() };
      // เมนูติดสต็อกดูจากข้อมูลล่าสุดที่เพิ่งเช็ค (ไม่ได้ = จากเมนูในเครื่อง) — ไม่มีเลย = ส่งแบบเดิมทุกอย่าง
      // ของเตรียมที่ผูกไว้ (prepTracked — ทั้งเมนูและตัวเลือกที่เลือก) ตัดใน transaction เดียวกัน — ดู prep.ts
      const docIdsOf = (ci: CartItem) => guestLineDocIds(fresh.get(ci.item.id) ?? allMenuItems.find((m) => m.id === ci.item.id), ci);
      const needs = stockNeeds(cart, docIdsOf);
      const writing: Promise<unknown> = needs.size === 0
        ? setDoc(orderRef, orderData)
        : runStockTransaction((tx) => createOrderTakingStock(tx, { orderRef, orderData, needs, guest: true }))
          .then((r) => patchSoldOutAfterTake(r.soldOutIds));
      // หมดเวลาแล้ว SDK ยังพยายามส่งต่อเองเบื้องหลัง — ถ้าส่งถึงทีหลังและตะกร้ายังเหมือนเดิม พาไปหน้าส่งสำเร็จเอง
      writing.then(() => {
        if (orderAttemptRef.current === attempt && orderSignature(cartRef.current) === attempt.signature) finishOrderSent();
      }, () => {});
      let errCode: string | undefined;
      try {
        await Promise.race([
          writing,
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), ORDER_SEND_TIMEOUT_MS)),
        ]);
      } catch (err: any) {
        if (err instanceof StockShortError) {
          showStockShort(cart, err, docIdsOf);
          return;
        }
        errCode = typeof err?.code === "string" ? err.code : "unknown";
        console.error("send order failed", err);
      }
      const outcome = orderSendOutcome(errCode, attempt.uncertain);
      if (outcome === "sent") {
        if (orderAttemptRef.current === attempt) finishOrderSent();
        return;
      }
      if (outcome === "uncertain") attempt.uncertain = true;
      setOrderSendFailed(true);
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
    setCartShortCartIds((prev) => prev.filter((id) => id !== cartId));
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
      if ((await cartHasUnavailableItems(manualCart)).blocked) return;
      const cleanItems = (JSON.parse(JSON.stringify(manualCart)) as CartItem[]).map(stripItemPhoto);
      // มีเมนูติดสต็อก → สร้างออเดอร์ (+ ตัวนับคิวกลับบ้าน) + ตัดสต็อก ใน transaction เดียว
      const docIdsOf = (ci: CartItem) =>
        staffLineDocIds(allMenuItems.find((m) => m.id === ci.item.id), ci, stockEnabled, stockMap, prepMap);
      const needs = stockNeeds(manualCart, docIdsOf);
      if (needs.size > 0) {
        const orderRef = doc(collection(db, "orders"));
        const counterRef = doc(db, "counters", `takeaway-${getTodayKey()}`);
        try {
          await runStockTransaction((tx) => createOrderTakingStock(tx, {
            orderRef,
            orderData: manualIsTakeaway
              ? { tableNumber: "0", isTakeaway: true, items: cleanItems, status: "in-progress", createdAt: serverTimestamp() }
              : { tableNumber: manualTable, items: cleanItems, status: "in-progress", createdAt: serverTimestamp() },
            needs,
            guest: false,
            prepare: manualIsTakeaway
              ? async (t) => {
                const snap = await t.get(counterRef);
                const next = (snap.exists() ? (snap.data().count || 0) : 0) + 1;
                return { fields: { takeawayLabel: `T-${next}` }, write: () => t.set(counterRef, { count: next }) };
              }
              : undefined,
          }));
        } catch (err) {
          if (err instanceof StockShortError) { showStockShort(manualCart, err, docIdsOf); return; }
          throw err;
        }
      } else if (manualIsTakeaway) {
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
      setCartShortCartIds([]);
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

  // เสิร์ฟทีละรายการ/ทีละจำนวน (qty ชิ้น) — เขียนแค่ key ของรายการนั้นใน servedUnits/servedAt (ไม่แตะ items[]
  // ที่ใช้คิดเงิน) ยังไม่ครบ = servedUnits.count ครบ = จด servedAt (เครื่องที่ยังเป็นแอปเวอร์ชันเก่าเห็นตรงกัน)
  // และถ้ารายการที่ไม่ถูก void เสิร์ฟครบทุกตัวแล้ว เปลี่ยน status เป็น awaiting-payment ในจังหวะเดียวกัน
  // ทำใน transaction เพื่อนับจากข้อมูลล่าสุดบน server — กันแท็บเล็ต 2 เครื่องกดพร้อมกันแล้วนับเกินจำนวนสั่ง
  // หรือไม่มีใครเปลี่ยน status ให้ คืนจำนวนที่เสิร์ฟจริง (อาจน้อยกว่าที่ขอถ้าอีกเครื่องเสิร์ฟไปก่อน) 0 = ไม่ได้เสิร์ฟ
  const handleServeItem = async (orderId: string, cartId: string, qty = 1): Promise<number> => {
    const ref = doc(db, "orders", orderId);
    const done = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const raw = snap.data();
      const items: CartItem[] = raw.items || [];
      const plan = planServe(raw, items, cartId, qty);
      if (!plan) return null;
      const units = new FieldPath("servedUnits", cartId);
      if (plan.complete) {
        tx.update(ref, new FieldPath("servedAt", cartId), serverTimestamp(), units, { last: plan.add },
          ...(plan.orderComplete ? ["status", "awaiting-payment"] : []));
      } else {
        tx.update(ref, units, { count: plan.count, last: plan.add });
      }
      return plan.add;
    });
    return done ?? 0;
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
  // รายการที่เคยเสิร์ฟไปบางส่วนก่อน "เสิร์ฟทั้งหมด" จด last = ส่วนที่ "เสิร์ฟทั้งหมด" เติมให้ (ย้อนทีหลังได้ถูกจำนวน)
  const keepServedArgs = (raw: ServeState, items: CartItem[], exceptCartId: string): unknown[] =>
    liveItems(items)
      .filter((ci) => ci.cartId !== exceptCartId && !raw.servedAt?.[ci.cartId])
      .flatMap((ci) => {
        const partial = lineServedQty({ servedUnits: raw.servedUnits }, ci);
        return [
          new FieldPath("servedAt", ci.cartId), serverTimestamp(),
          ...(partial > 0 ? [new FieldPath("servedUnits", ci.cartId), { last: ci.quantity - partial }] : []),
        ];
      });

  // ย้อนการเสิร์ฟของ 1 รายการ — qty = จำนวนที่ย้อน (แถบเลิกทำส่งจำนวนที่เพิ่งกดเสิร์ฟ) ไม่ส่ง = ย้อนชุดล่าสุด
  // (ดู planUnserve) เหลือ 0 = กลับเป็นยังไม่เสิร์ฟทั้งบรรทัด — ออเดอร์ที่รอชำระอยู่กลับเป็นกำลังเตรียม
  const handleUnserveItem = async (orderId: string, cartId: string, qty?: number) => {
    const ref = doc(db, "orders", orderId);
    const done = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const raw = snap.data();
      if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw notUndoableError(raw.status);
      const items: CartItem[] = raw.items || [];
      const target = items.find((ci) => ci.cartId === cartId);
      if (!target) return null;
      const plan = planUnserve(raw, target, qty);
      if (!plan) return null; // ยังไม่เสิร์ฟอยู่แล้ว
      tx.update(
        ref,
        new FieldPath("servedAt", cartId), deleteField(),
        new FieldPath("servedUnits", cartId), plan.count > 0 ? { count: plan.count } : deleteField(),
        ...(raw.status === "awaiting-payment" ? ["status", "in-progress", ...keepServedArgs(raw, items, cartId)] : []),
      );
      return { raw, target, plan };
    });
    if (done) {
      await logActivity({
        action: "unserve_item",
        orderId,
        tableNumber: logTableOf(done.raw),
        itemName: done.target.item.name.th,
        // รายการหลายชิ้น: ย้อนกี่ชิ้น เหลือเสิร์ฟแล้วกี่ชิ้น จากที่สั่งกี่ชิ้น
        ...(done.target.quantity > 1
          ? { details: { unservedQty: done.plan.back, servedLeft: done.plan.count, quantity: done.target.quantity } }
          : {}),
      });
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
      // จำนวนที่ย้อน = ส่วนที่ "เสิร์ฟทั้งหมด" เติมให้ — รายการที่เสิร์ฟไปบางส่วนก่อนแล้วกลับไปเหลือเท่าเดิม
      const reverted = liveItems(items)
        .filter((ci) => !served[ci.cartId])
        .map((ci) => ({ ci, back: ci.quantity - lineServedQty({ servedUnits: raw.servedUnits }, ci) }))
        .filter((r) => r.back > 0);
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
        details: { items: done.reverted.map(({ ci, back }) => ({ name: ci.item.name.th, quantity: back })) },
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
      const target = items.find((ci) => ci.cartId === cartId);
      if (!target || !target.voided) return null;
      const newItems = items.map((ci) => {
        if (ci.cartId !== cartId) return ci;
        const { voided: _v, voidReason: _r, voidedAt: _a, voidedWhileUnserved: _u, ...rest } = ci;
        return rest;
      });
      if (raw.status === "awaiting-payment" && target.voidedWhileUnserved && !lineFullyServed(raw, target)) {
        tx.update(ref, "items", newItems, "status", "in-progress", ...keepServedArgs(raw, items, cartId));
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

  // แถบเตือนหน้าออเดอร์: หมดแล้ว (สต็อกเมนู/ของเตรียมเหลือ ≤ 0) + ใกล้หมด — ดู buildStockAlerts ใน prep.ts
  const stockAlerts = buildStockAlerts(stockEnabled, allMenuItems, stockMap, prepMap,
    (m) => (lang === "en" ? m.name.en || m.name.th : m.name.th));

  // ยอดบิลที่พนักงานเห็น ณ ตอนกด — โต๊ะ = รวมทุกออเดอร์ค้างของโต๊ะ (รวมรอบที่ยังเตรียมอยู่) / กลับบ้าน = ใบเดียว
  // ใช้บันทึก "ยอดบิลเดิม → ใหม่" ลง log ของการยกเลิก/ปรับจำนวน
  const billTotalOf = (orderId: string): number | undefined => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return undefined;
    if (order.isTakeaway) return orderTotal(order);
    return orders
      .filter((o) => !o.isTakeaway && o.tableNumber === order.tableNumber && (o.status === "in-progress" || o.status === "awaiting-payment"))
      .reduce((s, o) => s + orderTotal(o), 0);
  };

  // เขียนผลของ planVoid/planAdjustQty — items[] ใหม่ + จด servedAt ถ้าบรรทัดเดิมเสิร์ฟครบ + เปลี่ยน status ตามกฎเดิม
  const applyLineChange = (
    tx: Transaction, ref: DocumentReference, raw: ServeState, cartId: string, plan: LineChangePlan, reason: string,
  ) => {
    const units = raw.servedUnits?.[cartId];
    tx.update(
      ref,
      "items", plan.items,
      ...(plan.completeLine
        ? [new FieldPath("servedAt", cartId), serverTimestamp(), new FieldPath("servedUnits", cartId), { last: units?.last ?? units?.count ?? 1 }]
        : []),
      ...(plan.status === "cancelled"
        ? ["status", "cancelled", ...(reason ? ["cancelReason", reason] : []), "cancelledAt", new Date()]
        : plan.status === "awaiting-payment" ? ["status", "awaiting-payment"] : []),
    );
  };

  // ยกเลิก (void) รายการ — ยังคงอยู่ใน items[] เสมอ (ห้ามลบออกจาก array) + ตัดรูปทิ้ง + log void_item
  // qty = จำนวนที่ยกเลิก (ค่าเริ่มต้น = ทั้งหมดที่ยังไม่เสิร์ฟ) ยกเลิกได้เฉพาะชิ้นที่ยังไม่เสิร์ฟ — ไม่หมดบรรทัดจะแยกเป็น
  // บรรทัด voided ใหม่ (ดู planVoid) wholeLine = กด − จนเหลือ 0 ในหน้าจ่ายเงิน: ยกเลิกทั้งบรรทัดแม้เสิร์ฟแล้ว
  // ทำใน transaction (นับจากข้อมูลล่าสุด กันสองเครื่องกดพร้อมกัน) ไม่เหลือรายการเลย = ยกเลิกทั้งใบ ("cancelled")
  // คืน cartId ของรายการที่ถูก void (ใช้คืนรายการจากแถบย้อนกลับ)
  // billTotalBefore: ยอดบิลบนการ์ดหน้าจ่ายเงินตอนกด — ไม่ส่ง = คิดจากออเดอร์ค้างของโต๊ะ (billTotalOf)
  const voidOrderItem = async (
    orderId: string,
    cartId: string,
    reason: string,
    opts: { qty?: number; wholeLine?: boolean; billTotalBefore?: number } = {},
  ): Promise<string | null> => {
    const billTotalBefore = opts.billTotalBefore ?? billTotalOf(orderId);
    const ref = doc(db, "orders", orderId);
    const done = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const raw = snap.data();
      const items: CartItem[] = raw.items || [];
      const plan = planVoid(raw, items, cartId, opts.qty ?? Number.MAX_SAFE_INTEGER, {
        wholeLine: opts.wholeLine,
        splitId: `${cartId}-x${uid()}`,
        reason,
        now: new Date(),
      });
      if (!plan) {
        const target = items.find((ci) => ci.cartId === cartId);
        if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw notUndoableError(raw.status);
        if (target && !target.voided) {
          throw new Error(lang === "en" ? "Every piece of this item is already served" : "รายการนี้เสิร์ฟครบทุกชิ้นแล้ว ยกเลิกไม่ได้");
        }
        return null; // ถูกยกเลิกไปแล้ว (เช่นจากอีกเครื่อง)
      }
      applyLineChange(tx, ref, raw, cartId, plan, reason);
      return { raw, plan };
    });
    if (!done) return null;
    const { raw, plan } = done;
    const amount = cartItemUnitPrice(plan.target) * plan.n;
    await logActivity({
      action: "void_item",
      orderId,
      tableNumber: logTableOf(raw),
      itemName: plan.target.item.name.th,
      amount,
      reason,
      details: {
        voidedQty: plan.n,
        quantityBefore: plan.quantityBefore,
        ...(billTotalBefore !== undefined ? { billTotalBefore, billTotalAfter: billTotalBefore - amount } : {}),
      },
    });
    await addVoidReason(reason);
    return plan.voidedCartId;
  };

  const handleRemoveOrderItem = (orderId: string, cartId: string, reason: string, qty?: number) =>
    voidOrderItem(orderId, cartId, reason, { qty });

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
          paidAt: serverTimestamp(),
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
            ? (en ? `${tableTitle(tableNum, lang)} has items not served yet. Serve all items first.` : `${tableTitle(tableNum, lang)} ยังเสิร์ฟไม่ครบ เสิร์ฟให้ครบก่อนปิดบิล`)
            : err.code === "changed"
              ? (en ? `${tableTitle(tableNum, lang)}'s bill just changed. Check the total and close again.` : `บิล${tableTitle(tableNum, lang)} เพิ่งมีการเปลี่ยนแปลง ตรวจยอดแล้วกดปิดบิลอีกครั้ง`)
              : (en ? `${tableTitle(tableNum, lang)}'s bill is already closed.` : `บิล${tableTitle(tableNum, lang)} ถูกปิดไปแล้ว`),
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
      // มือถือลูกค้าที่โต๊ะเดิมสั่งต่อไม่ได้ — ต้องสแกน QR ที่โต๊ะใหม่ (ไม่งั้นของจะเข้าโต๊ะเดิมที่ว่างแล้ว)
      tx.set(doc(db, "status", TABLE_CLOSURES_DOC), { closedAt: { [from]: serverTimestamp() }, movedAt: { [from]: serverTimestamp() } }, { merge: true });
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
    askConfirm(t.moveTableConfirm(n, tableShort(from, lang), tableShort(to, lang)), () => {
      handleMoveTable(from, to).catch((err) => {
        if (err instanceof MoveTableError) setNotice(err.code === "occupied" ? t.moveTableOccupied(tableTitle(to, lang)) : t.moveTableNothing(tableTitle(from, lang)));
        else setNotice(t.moveTableFailed + (err?.message || String(err)));
      });
    }, { confirmLabel: t.moveTableConfirmYes });
  };

  const handleCloseTakeawayOrder = async (orderId: string, payment: PaymentInput) => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "paid",
      paidAt: serverTimestamp(),
      ...paymentFields(payment, payment.transferAmount),
    });
  };

  // ปรับจำนวนรายการตอนชำระเงิน — ลดจนเหลือ 0 = void ทั้งบรรทัด (ต้องกรอกเหตุผลก่อน) แทนการลบออกจาก array
  // ปรับ +1/-1 แบบไม่ถึง void ก็ต้องกรอกเหตุผลก่อนเช่นกัน แล้วบันทึก log adjust_item_qty
  // ปุ่ม − ลดได้ทั้งจานที่เสิร์ฟแล้วและยังไม่เสิร์ฟ (ตามเดิม) — ทำใน transaction เหมือนการยกเลิก (planAdjustQty)
  // (ตอน AUDIT_UI_ENABLED = false askReason จะข้ามหน้าต่างแล้วทำงานทันที — ดู askReason)
  const adjustLine = (order: Order, target: CartItem, delta: number, billTotalBefore: number) => {
    const failNotice = (err: any) =>
      setNotice((lang === "en" ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err)));
    if (target.quantity + delta <= 0) {
      askVoidItem(target, (reason) => {
        voidOrderItem(order.id, target.cartId, reason, { wholeLine: true, billTotalBefore }).catch(failNotice);
      });
      return;
    }
    askReason(T[lang].adjustItemReasonTitle, (reason) => {
      void (async () => {
        const ref = doc(db, "orders", order.id);
        const done = await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return null;
          const raw = snap.data();
          const plan = planAdjustQty(raw, raw.items || [], target.cartId, delta);
          if (!plan) {
            if (raw.status !== "in-progress" && raw.status !== "awaiting-payment") throw notUndoableError(raw.status);
            return null;
          }
          applyLineChange(tx, ref, raw, target.cartId, plan, reason);
          return { raw, plan };
        });
        if (!done) return;
        const amount = delta * cartItemUnitPrice(done.plan.target);
        await logActivity({
          action: "adjust_item_qty",
          orderId: order.id,
          tableNumber: logTableOf(done.raw),
          itemName: done.plan.target.item.name.th,
          amount,
          reason,
          details: { oldQty: done.plan.oldQty, newQty: done.plan.newQty, billTotalBefore, billTotalAfter: billTotalBefore + amount },
        });
      })().catch(failNotice);
    });
  };

  const handleAdjustPaymentItem = async (contributingOrders: Order[], key: string, delta: number) => {
    // ยอดบิลของทั้งโต๊ะ (ตรงกับตัวเลขบนการ์ดหน้าชำระเงิน) ณ ตอนกด
    const billTotalBefore = contributingOrders.reduce((s, o) => s + orderTotal(o), 0);
    for (const order of contributingOrders) {
      const target = order.items.find((ci) => !ci.voided && cartItemKey(ci) === key);
      if (!target) continue;
      adjustLine(order, target, delta, billTotalBefore);
      return;
    }
  };

  const handleAdjustTakeawayItem = async (orderId: string, key: string, delta: number) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const target = order.items.find((ci) => !ci.voided && cartItemKey(ci) === key);
    if (!target) return;
    adjustLine(order, target, delta, orderTotal(order));
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

  const handleSaveItem = async (item: MenuItem, stockForm: StockFormValue) => {
    const rawPrev = allMenuItems.find((m) => m.id === item.id);
    const prev = rawPrev ? normalizeMenuItem(rawPrev) : undefined;
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
    // สต็อก: เขียนพร้อมเมนูใน batch เดียว — ใส่จำนวนใหม่ = เปิดขาย (0 = หมด) | ลบจำนวนทิ้ง = ไม่จำกัด (สถานะขายคงเดิม)
    // ของเตรียม: prepIds (ทั้งเมนู — แท็บสต็อก / ตัวเลือก — แท็บตัวเลือก) จากฟอร์ม ตัดตัวที่ถูกลบไปแล้วทิ้ง
    // (ตัดเฉพาะตอนได้ข้อมูล stock จาก server แล้ว ไม่งั้นการผูกหายหมด) | ธง soldOutByPrep ของเมนูจากค่าล่าสุด เก็บไว้เฉพาะตอนยังหมดอยู่
    // ไม่ได้ผูกอะไร = ไม่ใส่ฟิลด์ของเตรียมเลย (เมนูเดิมหน้าตาเหมือนเดิม)
    const keepPreps = (ids: string[] | undefined) => (ids ?? []).filter((p) => !stockSynced || prepMap.has(p));
    const { prepIds: formPrepIds, prepTracked: _stalePrepTracked, soldOutByPrep: _staleSoldOutByPrep, ...liveForm } =
      withLiveAvailability(normalizeMenuItem(item), prev);
    const live = liveForm.customGroups
      ? {
        ...liveForm,
        customGroups: liveForm.customGroups.map((g) => ({
          ...g,
          choices: g.choices.map(({ prepIds: choicePrepIds, ...c }) => {
            const kept = keepPreps(choicePrepIds);
            return kept.length > 0 ? { ...c, prepIds: kept } : c;
          }),
        })),
      }
      : liveForm;
    const prepIds = keepPreps(formPrepIds);
    const links = allPrepLinks({ ...live, prepIds });
    const { remaining, alertAt, remainingChanged } = stockForm;
    const soldOut = remainingChanged && remaining !== null ? soldOutAfterStockSet(remaining) : live.soldOut;
    const batch = writeBatch(db);
    batch.set(doc(db, "menuItems", item.id), {
      ...live,
      photo,
      stockTracked: shouldTrackStock(stockEnabled, remaining !== null),
      soldOut,
      ...(prepIds.length > 0 ? { prepIds } : {}),
      ...(links.length > 0 ? { prepTracked: prepTrackedFor(stockEnabled, links) } : {}),
      ...(soldOut && prev?.soldOutByPrep ? { soldOutByPrep: true } : {}),
    });
    const stockRef = doc(db, "stock", item.id);
    if (remaining === null) {
      if (stockMap.has(item.id)) batch.delete(stockRef);
    } else if (remainingChanged || !stockMap.has(item.id)) {
      batch.set(stockRef, { remaining, ...(alertAt !== null ? { alertAt } : {}) });
    } else {
      batch.update(stockRef, { alertAt: alertAt ?? deleteField() });
    }
    await batch.commit();
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
  // กด "ขาย" ที่เมนูที่สต็อกเหลือ ≤ 0 → เปิดขายทันทีแบบไม่จำกัด (ลบสต็อกทิ้ง) ไม่งั้นจะถูกกดหมดกลับเอง
  // อยากจำกัดจำนวนอีก พนักงานใส่ใหม่ที่หน้าแก้เมนู
  // ของเตรียมที่ผูกไว้หมดอยู่ (เหลือ ≤ 0) + กด "ขาย" → ของเตรียมนั้นเป็นไม่จำกัด เมนูอื่นที่ระบบกดหมดเพราะมันเปิดขายคืนใน commit เดียวกัน
  // กดเองทุกแบบ = ลบธง soldOutByPrep (กด "หมด" เอง = หมดจนกว่าพนักงานเปิดเอง ไม่โดนเปิดคืนตอนเติมของเตรียม)
  const handleSetAvailability = async (item: MenuItem, availability: MenuAvailability) => {
    const entry = stockMap.get(item.id);
    const ownOut = availability === "available" && !!entry && entry.remaining <= 0;
    const outPreps = availability === "available" ? (item.prepIds ?? []).filter((p) => prepIsOut(prepMap.get(p))) : [];
    if (ownOut || outPreps.length > 0) {
      const batch = writeBatch(db);
      if (ownOut) batch.delete(doc(db, "stock", item.id));
      const nextPreps = new Map(prepMap);
      outPreps.forEach((p) => {
        batch.update(doc(db, "stock", p), { remaining: deleteField(), alertAt: deleteField() });
        nextPreps.set(p, { name: prepMap.get(p)?.name ?? "" });
      });
      const nextStock = new Map(stockMap);
      if (ownOut) nextStock.delete(item.id);
      prepSyncPatches(allMenuItems.filter((m) => m.id !== item.id), nextStock, nextPreps).forEach((patch, id) =>
        batch.update(doc(db, "menuItems", id), patch));
      batch.update(doc(db, "menuItems", item.id), {
        active: true, soldOut: false, soldOutByPrep: deleteField(), ...(ownOut ? { stockTracked: false } : {}),
      });
      await batch.commit();
      return;
    }
    await updateDoc(doc(db, "menuItems", item.id), {
      active: availability !== "hidden",
      soldOut: availability === "soldOut",
      ...(item.soldOutByPrep ? { soldOutByPrep: deleteField() } : {}),
    });
  };

  // สวิตช์ระบบสต็อกทั้งร้าน — ปิด = ทุกออเดอร์กลับไปส่งแบบเดิม (ไม่ตัดสต็อก) แต่จำนวนที่ตั้งไว้ยังเก็บอยู่
  // เขียน stockTracked ของเมนูที่เกี่ยวข้องตามสวิตช์ (เครื่องลูกค้าดูจาก field นี้ ไม่ต้องอ่านอะไรเพิ่ม)
  const handleSetStockEnabled = async (enabled: boolean) => {
    const batch = writeBatch(db);
    batch.set(STOCK_CONFIG_REF(), { enabled }, { merge: true });
    allMenuItems.forEach((m) => {
      const tracked = shouldTrackStock(enabled, stockMap.has(m.id));
      const links = allPrepLinks(m);
      const prepTracked = prepTrackedFor(enabled, links);
      const patch: Record<string, boolean> = {};
      if (!!m.stockTracked !== tracked) patch.stockTracked = tracked;
      if (links.length > 0 && !!m.prepTracked !== prepTracked) patch.prepTracked = prepTracked;
      if (Object.keys(patch).length > 0) batch.update(doc(db, "menuItems", m.id), patch);
    });
    await batch.commit();
  };

  // ─── ของเตรียม (แท็บในหน้าจัดการเมนู) — ดู prep.ts ───
  // การผูกของเตรียม prepId ให้ตรงกับที่ต้องการ (ทั้งเมนู = wantMenus, ตัวเลือก = wantChoices) → patch ต่อเมนูที่เปลี่ยน
  // ทั้งเมนูใช้ arrayUnion/arrayRemove (ไม่ทับการผูกของเตรียมอื่นที่เครื่องอื่นเพิ่งทำ) | ตัวเลือกต้องเขียน customGroups ทั้งก้อน
  // จากข้อมูลล่าสุดในเครื่อง (เหมือนสวิตช์เปิด/ปิดตัวเลือก) — เมนูแบบเดิมแปลงเป็นแบบใหม่ไปพร้อมกัน
  const prepLinkPatches = (prepId: string, wantMenus: Set<string>, wantChoices: Map<string, Set<string>>) => {
    const patches = new Map<string, Record<string, unknown>>();
    allMenuItems.forEach((m) => {
      const patch: Record<string, unknown> = {};
      const linked = !!m.prepIds?.includes(prepId);
      const want = wantMenus.has(m.id);
      let nextPrepIds = m.prepIds ?? [];
      if (linked !== want) {
        nextPrepIds = want ? [...nextPrepIds, prepId] : nextPrepIds.filter((p) => p !== prepId);
        patch.prepIds = want ? arrayUnion(prepId) : nextPrepIds.length > 0 ? arrayRemove(prepId) : deleteField();
      }
      const groups = setPrepOnChoices(normalizeMenuItem(m).customGroups ?? [], prepId, wantChoices.get(m.id) ?? new Set());
      if (groups) Object.assign(patch, { customGroups: groups }, legacyOptionsPatch(m));
      if (Object.keys(patch).length === 0) return;
      const links = allPrepLinks({ ...normalizeMenuItem(m), ...(groups ? { customGroups: groups } : {}), prepIds: nextPrepIds });
      patch.prepTracked = links.length > 0 ? prepTrackedFor(stockEnabled, links) : deleteField();
      patches.set(m.id, patch);
    });
    return patches;
  };

  // บันทึกจากหน้าต่างแก้: ชื่อ/เตือน/จำนวน (แก้ช่องจำนวนจริงเท่านั้นถึงเขียนทับ — ลูกค้าอาจเพิ่งตัดไประหว่างเปิดค้าง) + การผูก
  // เปิดขาย/กดหมดเมนูและตัวเลือกที่ผูกตามจำนวนใหม่ ให้ effect prepSoldOutChanges ทำต่อ
  const handleSavePrep = async (
    prepId: string | null,
    form: { name: string; remaining: number | null; alertAt: number | null; remainingChanged: boolean },
    links: { menuIds: string[]; choices: ChoiceRef[] },
  ) => {
    const id = prepId ?? `${PREP_ID_PREFIX}${doc(collection(db, "stock")).id}`;
    const batch = writeBatch(db);
    batch.set(doc(db, "stock", id), {
      kind: "prep",
      name: form.name,
      alertAt: form.alertAt ?? deleteField(),
      ...(form.remainingChanged || !prepId ? { remaining: form.remaining ?? deleteField() } : {}),
    }, { merge: true });
    const wantChoices = new Map<string, Set<string>>();
    links.choices.forEach((c) => {
      if (!wantChoices.has(c.menuId)) wantChoices.set(c.menuId, new Set());
      wantChoices.get(c.menuId)!.add(choiceKey(c.groupId, c.choiceId));
    });
    prepLinkPatches(id, new Set(links.menuIds), wantChoices).forEach((patch, menuId) =>
      batch.update(doc(db, "menuItems", menuId), patch));
    await batch.commit();
  };

  // ปุ่ม −/+ บนการ์ด: บันทึกทันที (increment = ไม่ชนกับลูกค้าที่ตัดพร้อมกัน) — ลดต่ำกว่า 0 ไม่ได้
  const handleAdjustPrep = async (prepId: string, delta: 1 | -1) => {
    const p = prepMap.get(prepId);
    if (p?.remaining === undefined || (delta < 0 && p.remaining <= 0)) return;
    await updateDoc(doc(db, "stock", prepId), { remaining: increment(delta) });
  };

  // ใส่จำนวนใหม่ทั้งก้อน (ผ่านหน้าต่างยืนยันแล้ว) — null = ไม่จำกัด
  const handleSetPrepRemaining = async (prepId: string, remaining: number | null) => {
    await updateDoc(doc(db, "stock", prepId), { remaining: remaining ?? deleteField() });
  };

  // ลบของเตรียม: ถอดออกจากทุกเมนู/ตัวเลือกที่ผูกใน commit เดียวกัน (ที่หมดเพราะมันเปิดคืนเองผ่าน effect)
  const handleDeletePrep = async (prepId: string) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, "stock", prepId));
    prepLinkPatches(prepId, new Set(), new Map()).forEach((patch, menuId) => batch.update(doc(db, "menuItems", menuId), patch));
    await batch.commit();
  };

  // ตั้ง เปิด/ปิด ตัวเลือก 1 ตัว (ปุ่มด่วนในหน้าจัดการเมนู + สวิตช์ในหน้าแก้เมนู) — บันทึกทันที ไม่ผ่านปุ่มบันทึก
  // Firestore แก้ element ใน array ตรงๆ ไม่ได้ จึงเขียน customGroups ทั้งก้อนใหม่ โดยเริ่มจากข้อมูลล่าสุดใน allMenuItems
  // (realtime) แล้วแก้แค่ตัวเลือกนั้น — เมนูที่ยังเป็นตัวเลือกในตัวแบบเดิม ถูกแปลงเป็นกลุ่มลง DB ไปในครั้งเดียวกัน
  // คืน false = ยังไม่มีเมนู/กลุ่ม/ตัวเลือกนี้ใน DB (เช่นเพิ่งเพิ่มในหน้าแก้ ยังไม่กดบันทึก) — ผู้เรียกเก็บค่าไว้ในฟอร์มแทน
  // เปิดตัวเลือกที่ของเตรียมที่ผูกหมดอยู่ → ของเตรียมนั้นเป็นไม่จำกัด + เปิดคืนเมนู/ตัวเลือกอื่นที่ปิดเพราะมันใน commit เดียวกัน
  // กดเองทุกแบบ = ลบธง soldOutByPrep ของตัวเลือก (setChoiceClosed) — ปิดเองแล้วไม่โดนเปิดคืนตอนเติมของเตรียม
  const handleSetChoiceClosed = async (itemId: string, groupId: string, choiceId: string, closed: boolean): Promise<boolean> => {
    const raw = allMenuItems.find((m) => m.id === itemId);
    if (!raw) return false;
    const groups = normalizeMenuItem(raw).customGroups || [];
    const customGroups = setChoiceClosed(groups, groupId, choiceId, closed);
    if (!customGroups) return false;
    const choice = groups.find((g) => g.id === groupId)?.choices.find((c) => c.id === choiceId);
    const outPreps = closed ? [] : (choice?.prepIds ?? []).filter((p) => prepIsOut(prepMap.get(p)));
    if (outPreps.length === 0) {
      await updateDoc(doc(db, "menuItems", itemId), { customGroups, ...legacyOptionsPatch(raw) });
      return true;
    }
    const batch = writeBatch(db);
    const nextPreps = new Map(prepMap);
    outPreps.forEach((p) => {
      batch.update(doc(db, "stock", p), { remaining: deleteField(), alertAt: deleteField() });
      nextPreps.set(p, { name: prepMap.get(p)?.name ?? "" });
    });
    batch.update(doc(db, "menuItems", itemId), { customGroups, ...legacyOptionsPatch(raw) });
    prepSyncPatches(allMenuItems.filter((m) => m.id !== itemId), stockMap, nextPreps).forEach((patch, id) =>
      batch.update(doc(db, "menuItems", id), patch));
    await batch.commit();
    return true;
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
    if (stockMap.has(itemId)) await deleteDoc(doc(db, "stock", itemId)); // สต็อกของเมนูที่ลบไม่มีใครใช้แล้ว
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
          onViewOrdered={customerToken ? () => setShowOrdered(true) : undefined}
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
          shortCartIds={cartShortCartIds}
          sendError={orderSendFailed ? T[lang].orderSendFailed : undefined}
        />
      );
      break;

    case "order-sent":
      content = (
        <OrderSentScreen
          lang={lang}
          tableNumber={tableNumber!}
          onOrderMore={() => setView("menu")}
          onViewOrdered={customerToken ? () => setShowOrdered(true) : undefined}
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
            onRemoveItem={(orderId, cartId, qty, picked, onVoided) => {
              const target = orders.find((o) => o.id === orderId)?.items.find((ci) => ci.cartId === cartId);
              if (target) askVoidQty(target, picked, (reason) => onVoided(handleRemoveOrderItem(orderId, cartId, reason, qty)));
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
            stockAlerts={stockAlerts}
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
            onRemoveItem={(orderId, cartId, qty, picked) => {
              const target = orders.find((o) => o.id === orderId)?.items.find((ci) => ci.cartId === cartId);
              if (target) {
                askVoidQty(target, picked, (reason) =>
                  handleRemoveOrderItem(orderId, cartId, reason, qty).catch((err) =>
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
            items={staffMenuItems}
            categories={allCategories}
            onAdd={handleAddNewItem}
            onEdit={handleEditItem}
            onSetAvailability={handleSetAvailability}
            onSetChoiceClosed={(item, groupId, choiceId, closed) => {
              handleSetChoiceClosed(item.id, groupId, choiceId, closed).catch((err) => setNotice(String(err?.message || err)));
            }}
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
            stockMap={stockMap}
            prepMap={prepMap}
            onSavePrep={handleSavePrep}
            onAdjustPrep={(prepId, delta) => { handleAdjustPrep(prepId, delta).catch((err) => setNotice(String(err?.message || err))); }}
            onSetPrepRemaining={handleSetPrepRemaining}
            onDeletePrep={(prepId) => { handleDeletePrep(prepId).catch((err) => setNotice(String(err?.message || err))); }}
            stockEnabled={stockEnabled}
            onSetStockEnabled={(enabled) =>
              askConfirm(
                enabled
                  ? (lang === "en" ? "Turn the stock system ON? Orders will take from stock again." : "เปิดระบบสต็อก? ออเดอร์จะกลับมาตัดสต็อก")
                  : (lang === "en" ? "Turn the stock system OFF? Orders stop taking from stock (numbers are kept)." : "ปิดระบบสต็อก? ออเดอร์จะไม่ตัดสต็อก (จำนวนที่ตั้งไว้ยังเก็บอยู่)"),
                () => { handleSetStockEnabled(enabled).catch((err) => setNotice(String(err?.message || err))); },
              )}
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
            onSetChoiceClosed={handleSetChoiceClosed}
            onCancel={() => setView("staff-menu")}
            onLangToggle={toggleLang}
            categories={categories}
            stock={stockMap.get(editingItem.id)}
            prepMap={prepMap}
            stockEnabled={stockEnabled}
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
            categories={allCategories}
            menuItems={allMenuItems}
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
            shortCartIds={backfill ? [] : cartShortCartIds}
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
      {showOrdered && customerToken && tableNumber && tableSessionRef.current && (
        <OrderedSheet
          lang={lang}
          token={customerToken}
          table={tableNumber}
          baselineClosedAt={tableSessionRef.current.baselineClosedAt ?? null}
          sentOrders={readSentOrders(tableSessionRef.current.id)}
          onRevoked={revokeCustomerLink}
          onClose={() => setShowOrdered(false)}
        />
      )}
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
