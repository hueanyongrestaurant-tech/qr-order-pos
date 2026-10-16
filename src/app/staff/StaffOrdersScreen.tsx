import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, Check, Clock, Plus, Printer, RotateCcw, Trash2, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { CartItem, Category, ConfirmOptions, Language, Order, StaffTab } from "../types";
import { T } from "../translations";
import { compareTables, formatClock, liveItems, orderTotal } from "../utils";
import { isLikelyNewCustomer } from "../tableSession";
import { StaffHeader } from "./StaffHeader";

// แถบย้อนกลับค้างไว้ 10 วิ หลังกดเสิร์ฟ/พร้อมรับ/ยกเลิกรายการ
const UNDO_MS = 10000;

// ป้ายเวลารอบนการ์ดกำลังเตรียม (นับจากเวลาสั่งของออเดอร์ใบนั้น) — ถึง WARN เป็นเหลือง ถึง LATE เป็นแดง
const WAIT_WARN_MIN = 15;
const WAIT_LATE_MIN = 25;

// เวลาปัจจุบันที่ขยับเองทุกต้นนาที — ให้ป้ายเวลารออัปเดตโดยไม่ต้องอ่าน Firestore เพิ่ม
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: number | undefined;
    const align = window.setTimeout(() => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 60000);
    }, 60000 - (Date.now() % 60000));
    return () => {
      window.clearTimeout(align);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return now;
}
import { kitchenOptionSummary } from "./ticket";
import { usePrintRole, useSelectedPrinterAddress } from "./printerStore";
import { noItemsForRoleMessage } from "./stationTickets";

// ─── Staff Orders Screen ──────────────────────────────────────────────────────

interface StaffOrdersProps {
  lang: Language;
  orders: Order[];
  onMarkServed: (orderId: string) => Promise<void>;
  onUnmarkServed: (orderId: string) => Promise<void>;
  onServeItem: (orderId: string, cartId: string) => Promise<void>;
  onUnserveItem: (orderId: string, cartId: string) => Promise<void>;
  onRestoreItem: (orderId: string, cartId: string) => Promise<void>;
  // App ถามยืนยัน/เหตุผลเอง — onVoided ถูกเรียกพร้อม promise ของการ void เมื่อพนักงานยืนยันแล้วเท่านั้น
  onRemoveItem: (orderId: string, cartId: string, onVoided: (voiding: Promise<void>) => void) => void;
  onCancelOrder: (orderId: string) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void, labels?: ConfirmOptions) => void;
  onNotice: (message: string) => void; // หน้าต่างแจ้งเตือนในแอป (NoticeModal ใน App) — แทน alert() ของเบราว์เซอร์
  onStartManualOrder: () => void;
  onMoveTable: (table: string) => void; // ย้ายทุกออเดอร์ค้างของโต๊ะนี้ (ไม่ใช่แค่การ์ดใบที่กด) — App ถามโต๊ะปลายทาง/ยืนยันเอง
  categories: Category[]; // ทุกหมวด (รวมที่ซ่อน) — ใช้แยกรายการตามจุดตอนกดพิมพ์
  tableClosedAt: Record<string, number>; // เวลาปิดบิลล่าสุดของแต่ละโต๊ะ (ms) — ใช้ขึ้นป้าย "ลูกค้าใหม่?"
}

export function StaffOrdersScreen({ lang, orders, onMarkServed, onUnmarkServed, onServeItem, onUnserveItem, onRestoreItem, onRemoveItem, onCancelOrder, onTabChange, onLogout, onLangToggle, onAskConfirm, onNotice, onStartManualOrder, onMoveTable, categories, tableClosedAt }: StaffOrdersProps) {
  const t = T[lang];

  // กดเสิร์ฟแล้วย้ายโซนทันทีบนเครื่องนี้ ไม่ต้องรอ transaction วิ่งไป server กลับมา (เน็ตร้านช้าอาจกินเวลาหลายวิ
  // ระหว่างนั้นพนักงานจะกดซ้ำ) — key = "orderId:cartId" ต่อรายการ หรือ "orderId:*" เมื่อกดเสิร์ฟทั้งหมด
  const [pendingServed, setPendingServed] = useState<Set<string>>(new Set());

  const addPending = (key: string) => setPendingServed((prev) => new Set(prev).add(key));
  const dropPending = (key: string) =>
    setPendingServed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  // ล้าง key ที่ server ยืนยันแล้ว (เห็นใน servedAt หรือออเดอร์พ้น in-progress ไปแล้ว) ไม่ให้ Set โตค้าง
  useEffect(() => {
    setPendingServed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(
        [...prev].filter((key) => {
          const [orderId, cartId] = key.split(":");
          const o = orders.find((x) => x.id === orderId);
          if (!o || o.status !== "in-progress") return false;
          return cartId === "*" ? true : !o.servedAt?.[cartId];
        }),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [orders]);

  const failAlert = (err: any) =>
    onNotice((lang === "en" ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err)));

  const en = lang === "en";
  const tableText = (o: Order) => (o.isTakeaway ? o.takeawayLabel || "T" : `${t.tableLabel} ${o.tableNumber}`);
  const itemText = (ci: CartItem) =>
    (en ? ci.item.name.en || ci.item.name.th : ci.item.name.th) + (ci.quantity > 1 ? ` ×${ci.quantity}` : "");
  const noLabel = en ? "No" : "ไม่";
  const undoLabel = en ? "Undo" : "ย้อนกลับ";

  const now = useMinuteClock();
  const waitBadge = (o: Order) => {
    const mins = Math.max(0, Math.floor((now - o.timestamp.getTime()) / 60000));
    const tone =
      mins >= WAIT_LATE_MIN
        ? "bg-red-600 text-white border-red-600"
        : mins >= WAIT_WARN_MIN
          ? "bg-amber-100 text-amber-800 border-amber-400"
          : "bg-muted text-muted-foreground border-border";
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-sm font-bold whitespace-nowrap tabular-nums ${tone}`}>
        <Clock size={14} />
        {en ? `${mins} min` : `${mins} นาที`}
      </span>
    );
  };

  // ─── แถบย้อนกลับ (ด้านล่างจอ ค้าง UNDO_MS) ───
  const [toast, setToast] = useState<{ id: number; label: string; undo: () => Promise<unknown> } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);
  const dismissToast = () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  };
  const showToast = (label: string, undo: () => Promise<unknown>) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    const id = Date.now();
    setToast({ id, label, undo });
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast((cur) => (cur?.id === id ? null : cur));
    }, UNDO_MS);
  };

  // resolve เป็น true/false เสมอ (ไม่ reject) — การย้อนกลับต้องรอให้งานเดิมเขียนเสร็จก่อน ไม่งั้นการย้อน
  // อาจวิ่งถึง server ก่อน แล้วงานเดิมมาทับทีหลัง
  const settle = (p: Promise<void>, onFail?: () => void) =>
    p.then(
      () => true,
      (err) => {
        onFail?.();
        failAlert(err);
        return false;
      },
    );

  // ทุกปุ่มเสิร์ฟ/พร้อมรับถามยืนยันก่อน แล้วขึ้นแถบย้อนกลับ — ข้อความบอกชัดว่าทำอะไรกับโต๊ะไหน
  const serveItem = (order: Order, ci: CartItem) => {
    const key = `${order.id}:${ci.cartId}`;
    addPending(key);
    const serving = settle(onServeItem(order.id, ci.cartId), () => dropPending(key));
    showToast(en ? `Served ${itemText(ci)} (${tableText(order)})` : `เสิร์ฟ ${itemText(ci)} (${tableText(order)}) แล้ว`, () => {
      dropPending(key);
      return serving.then((ok) => (ok ? onUnserveItem(order.id, ci.cartId) : undefined));
    });
  };

  const serveAll = (order: Order) => {
    const key = `${order.id}:*`;
    addPending(key);
    const serving = settle(onMarkServed(order.id), () => dropPending(key));
    const label = order.isTakeaway
      ? (en ? `${tableText(order)} ready for pickup` : `${tableText(order)} พร้อมรับแล้ว`)
      : (en ? `Served all (${tableText(order)})` : `เสิร์ฟทั้งหมด (${tableText(order)}) แล้ว`);
    showToast(label, () => {
      dropPending(key);
      return serving.then((ok) => (ok ? onUnmarkServed(order.id) : undefined));
    });
  };

  const handleServeItem = (order: Order, ci: CartItem) => {
    onAskConfirm(
      en ? `Serve ${itemText(ci)} (${tableText(order)})?` : `เสิร์ฟ ${itemText(ci)} (${tableText(order)}) ใช่ไหม?`,
      () => serveItem(order, ci),
      { cancelLabel: noLabel, confirmLabel: t.serveItem, tone: "success" },
    );
  };

  const handleServeAll = (order: Order) => {
    if (order.isTakeaway) {
      onAskConfirm(
        en ? `${tableText(order)} ready for pickup?` : `${tableText(order)} พร้อมรับแล้ว ใช่ไหม?`,
        () => serveAll(order),
        { cancelLabel: noLabel, confirmLabel: en ? "Ready" : "พร้อมรับ", tone: "success" },
      );
      return;
    }
    const n = unserved(order).length;
    onAskConfirm(
      en ? `Serve all ${n} remaining items (${tableText(order)})?` : `เสิร์ฟทั้งหมด ${n} รายการที่เหลือ (${tableText(order)}) ใช่ไหม?`,
      () => serveAll(order),
      { cancelLabel: noLabel, confirmLabel: t.markServed, tone: "success" },
    );
  };

  // ยกเลิกรายการ — App ถามยืนยันเอง ยืนยันแล้วขึ้นแถบย้อนกลับ (คืนรายการ)
  const handleRemoveItem = (order: Order, ci: CartItem) => {
    onRemoveItem(order.id, ci.cartId, (p) => {
      const voiding = settle(p);
      // รายการสุดท้ายของออเดอร์ → ออเดอร์ถูกยกเลิกทั้งใบ ซึ่งไม่ทำย้อนกลับให้ — ไม่ขึ้นแถบเลย (ยกเลิกเงียบๆ)
      if (liveItems(order.items).length <= 1) return;
      showToast(en ? `Cancelled ${itemText(ci)} (${tableText(order)})` : `ยกเลิก ${itemText(ci)} (${tableText(order)}) แล้ว`, () =>
        voiding.then((ok) => (ok ? onRestoreItem(order.id, ci.cartId) : undefined)),
      );
    });
  };

  // ─── ย้อนทีหลัง: แตะรายการที่เสิร์ฟแล้ว / ที่ยกเลิกแล้ว → ปุ่มย้อนกลับ → หน้าต่างยืนยัน ───
  // key: "served:orderId:cartId" | "ready:orderId" | "void:orderId:cartId" — เปิดได้ทีละอัน แตะซ้ำเพื่อปิด
  const [undoPick, setUndoPick] = useState<string | null>(null);
  const togglePick = (key: string) => setUndoPick((cur) => (cur === key ? null : key));
  const runUndo = (message: string, action: () => Promise<void>) =>
    onAskConfirm(message, () => {
      setUndoPick(null);
      action().catch(failAlert);
    }, { cancelLabel: noLabel, confirmLabel: undoLabel, tone: "neutral" });

  const askUnserveItem = (order: Order, ci: CartItem) =>
    runUndo(
      en ? `Undo serving ${itemText(ci)} (${tableText(order)})? It goes back to not served.` : `ย้อน ${itemText(ci)} (${tableText(order)}) กลับเป็นยังไม่เสิร์ฟ ใช่ไหม?`,
      () => onUnserveItem(order.id, ci.cartId),
    );
  const askUnready = (order: Order) =>
    runUndo(
      en ? `Move ${tableText(order)} back to preparing?` : `ย้อน ${tableText(order)} กลับเป็นกำลังเตรียม ใช่ไหม?`,
      () => onUnmarkServed(order.id),
    );
  const askRestore = (order: Order, ci: CartItem) =>
    runUndo(
      en ? `Restore ${itemText(ci)} to the order (${tableText(order)})?` : `คืน ${itemText(ci)} กลับเข้าออเดอร์ (${tableText(order)}) ใช่ไหม?`,
      () => onRestoreItem(order.id, ci.cartId),
    );

  // ปุ่มย้อนกลับที่โผล่ใต้รายการหลังแตะ — สูง 44px กดง่ายทั้งแท็บเล็ตและมือถือ
  const undoButton = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="mt-1.5 w-full min-h-[44px] px-3 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-semibold bg-primary/10 text-primary border-2 border-primary/40 hover:bg-primary/15 active:scale-95 transition-all"
    >
      <RotateCcw size={16} />
      {label}
    </button>
  );

  // รายการนี้ถือว่าเสิร์ฟแล้วหรือยัง (รวมที่เพิ่งกดบนเครื่องนี้แต่ server ยังไม่ตอบ) — ใช้แบ่งโซนเท่านั้น ไม่เกี่ยวกับเงิน
  const isServed = (o: Order, ci: CartItem) =>
    o.status !== "in-progress" ||
    !!o.servedAt?.[ci.cartId] ||
    pendingServed.has(`${o.id}:*`) ||
    pendingServed.has(`${o.id}:${ci.cartId}`);
  const unserved = (o: Order) => liveItems(o.items).filter((ci) => !isServed(o, ci));
  const [isPrinting, setIsPrinting] = useState(false);
  // native printing ต้องเปิดผ่านแอป Capacitor จริง + ตั้งเครื่องพิมพ์ไว้แล้วบนเครื่องนี้ —
  // เครื่องที่ไม่เข้าเงื่อนไขให้ปุ่มพิมพ์ disabled ไปเลย ไม่ fallback ไป window.print()/RawBT แล้ว
  // ใช้ hook แทนอ่าน localStorage ตรงๆ เพราะเลือกเครื่องพิมพ์ใหม่ใน PrinterSettingsModal
  // (ซึ่งอยู่ลึกใน StaffHeader) ไม่ทำให้หน้านี้ re-render เอง ต้องมี event subscription
  const selectedPrinterAddress = useSelectedPrinterAddress();
  const printRole = usePrintRole();
  const canPrint = Capacitor.isNativePlatform() && !!selectedPrinterAddress;

  // ปุ่มพิมพ์เอง — ใช้ตอนสร้างออเดอร์ใหม่ (ที่ auto-print ไปแล้ว แต่พิมพ์ซ้ำได้ถ้ากระดาษติด/พลาด)
  // และตอนแก้ไขรายการออเดอร์ที่กำลังทำอยู่ (auto-print จะไม่ยิงซ้ำให้ ต้องกดเองตรงนี้)
  const handlePrintKitchen = async (order: Order) => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      // พิมพ์เฉพาะส่วนของจุดที่เครื่องนี้รับผิดชอบ — ไม่มีอะไรของจุดนี้ให้แจ้ง ไม่เงียบไปเฉยๆ
      const { printStationTicketsNative } = await import("./nativePrinter");
      const printed = await printStationTicketsNative(order, printRole, categories, lang);
      if (printed === 0) onNotice(noItemsForRoleMessage(printRole, lang));
    } catch (err: any) {
      onNotice((lang === "en" ? "Print failed: " : "พิมพ์ไม่สำเร็จ: ") + (err?.message || String(err)));
    } finally {
      setIsPrinting(false);
    }
  };
  const takeawayOrders = orders.filter(
    (o) => o.isTakeaway && o.status === "in-progress" && !pendingServed.has(`${o.id}:*`),
  );
  // การ์ดกำลังเตรียมแสดงเฉพาะรายการที่ยังไม่เสิร์ฟ — ซ่อนการ์ดเมื่อเสิร์ฟครบ (status จะถูกเปลี่ยนตามมาเอง)
  // ยกเว้นเคสที่ server บอกว่าเสิร์ฟครบแล้วแต่ status ยังค้าง in-progress (ไม่ควรเกิด) — ยังโชว์การ์ดไว้
  // ให้กด "เสิร์ฟทั้งหมด" ปิดได้ ไม่งั้นออเดอร์จะหายไปจากหน้าจ่ายเงินแบบไม่มีทางแก้
  const inProgress = orders.filter((o) => {
    if (o.status !== "in-progress" || o.isTakeaway) return false;
    if (unserved(o).length > 0) return true;
    const stuck = liveItems(o.items).every((ci) => !!o.servedAt?.[ci.cartId]);
    return stuck && !pendingServed.has(`${o.id}:*`);
  });

  // โซนรอชำระเงิน — รวมตามโต๊ะ: ทุกรายการที่เสิร์ฟแล้ว ทั้งจากออเดอร์ที่รอชำระทั้งใบ และรายการที่เสิร์ฟไปก่อน
  // จากออเดอร์ที่ยังกำลังเตรียม เป็นแค่การแสดงผล — การจ่ายเงินจริงยังอิง order.status เหมือนเดิม
  // (หน้าจ่ายเงินนับเฉพาะออเดอร์ที่ status เป็น awaiting-payment ทั้งใบ — ออเดอร์ที่ยังมีจานค้างยังไม่ถูกคิดเงิน)
  const awaitingByTable: Record<string, { orders: Order[]; served: { order: Order; ci: CartItem }[]; waiting: number; total: number }> = {};
  orders.forEach((o) => {
    if (o.isTakeaway || (o.status !== "in-progress" && o.status !== "awaiting-payment")) return;
    const g = (awaitingByTable[o.tableNumber] ??= { orders: [], served: [], waiting: 0, total: 0 });
    g.orders.push(o);
    g.served.push(...liveItems(o.items).filter((ci) => isServed(o, ci)).map((ci) => ({ order: o, ci })));
    g.waiting += unserved(o).length;
    g.total += orderTotal(o);
  });
  const awaitingTables = Object.entries(awaitingByTable)
    .filter(([, g]) => g.served.length > 0)
    .sort(([a], [b]) => compareTables(a, b));
  // กลับบ้านที่กด "พร้อมรับ" แล้ว (หรือเพิ่งกดบนเครื่องนี้แต่ server ยังไม่ตอบ) — แยกการ์ดต่อออเดอร์ (T-n)
  // เพราะไม่ได้รวมตามโต๊ะ ตรงกับหน้าจ่ายเงินที่แสดงกลับบ้านทีละใบ
  const awaitingTakeaways = orders
    .filter((o) => o.isTakeaway && (o.status === "awaiting-payment" || (o.status === "in-progress" && pendingServed.has(`${o.id}:*`))))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const awaitingCount = awaitingTables.length + awaitingTakeaways.length;

  // รายละเอียดของ 1 รายการ (ชื่อ/ตัวเลือก/หมายเหตุ/custom add-on/ป้าย void) — ใช้ร่วมกันทั้งการ์ดโต๊ะในร้าน
  // และการ์ดกลับบ้าน ให้พนักงานเห็นข้อมูลครบเท่ากันเสมอ ตัวเลือกใช้ kitchenOptionSummary() ตัวเดียวกับตั๋วครัว
  // footer = ปุ่มเล็กใต้รายละเอียด (ปุ่มยกเลิกรายการ) — แยกให้ห่างจากปุ่มเสิร์ฟที่อยู่ชิดขวา กันกดพลาด
  function renderItemDetails(ci: CartItem, footer?: ReactNode) {
    const options = kitchenOptionSummary(ci, lang);
    return (
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium leading-tight ${ci.voided ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {lang === "en" ? ci.item.name.en : ci.item.name.th}
        </div>
        {options && (
          // ตัวเลือกพิเศษเป็นสีแดงให้ครัวเห็นชัด — รายการที่ void แล้วคงสีเทา ไม่ให้สับสนกับป้าย void (สีแดงเหมือนกัน)
          <div className={`text-xs mt-0.5 ${ci.voided ? "text-muted-foreground" : "text-red-600"}`}>{options}</div>
        )}
        {ci.note && (
          <div className="text-amber-700 text-xs mt-0.5 italic">"{ci.note}"</div>
        )}
        {ci.customNote && (
          <div className="text-primary text-xs mt-0.5 font-medium">
            + {ci.customNote} (+{t.thb}{ci.customAddOnPrice || 0})
          </div>
        )}
        {ci.voided && (
          <div className="text-destructive text-xs mt-0.5">
            {t.voidedLabel}{ci.voidReason ? ` · ${ci.voidReason}` : ""}
          </div>
        )}
        {footer}
      </div>
    );
  }

  // แถวรายการในโซนรอชำระ — แตะได้ทั้งแถว (สูง 44px) เพื่อเปิด/ปิดปุ่มย้อนกลับ
  const tapHint = en ? "Tap an item to undo" : "แตะรายการเพื่อย้อนกลับ";
  function renderTapRow(ci: CartItem, onTap: () => void, active: boolean) {
    return (
      <button
        onClick={onTap}
        className={`w-full min-h-[44px] -mx-2 px-2 rounded-lg text-left flex items-center gap-2 text-sm transition-colors ${active ? "bg-primary/10" : "hover:bg-muted/60"}`}
        style={{ width: "calc(100% + 1rem)" }}
      >
        <span className="font-semibold text-secondary w-5 flex-shrink-0">{ci.quantity}</span>
        <span className="flex-1 text-foreground leading-tight">{lang === "en" ? ci.item.name.en : ci.item.name.th}</span>
        <RotateCcw size={14} className={active ? "text-primary" : "text-muted-foreground/50"} />
      </button>
    );
  }

  // รายการที่ยกเลิกแล้ว — แตะทั้งแถวเพื่อเปิดปุ่ม "คืนรายการ" (ยืนยันอีกชั้นก่อนคืน)
  function renderVoidedRow(order: Order, ci: CartItem) {
    const key = `void:${order.id}:${ci.cartId}`;
    return (
      <div key={ci.cartId}>
        <button onClick={() => togglePick(key)} className="w-full min-h-[44px] text-left flex items-start gap-2.5 rounded-lg">
          <div className="font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 bg-muted text-muted-foreground opacity-50">
            {ci.quantity}
          </div>
          <div className="flex-1 min-w-0">
            <div className="opacity-50">{renderItemDetails(ci)}</div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary">
              <RotateCcw size={11} />
              {en ? "Tap to restore" : "แตะเพื่อคืนรายการ"}
            </div>
          </div>
        </button>
        {undoPick === key && undoButton(en ? "Restore this item" : "คืนรายการนี้", () => askRestore(order, ci))}
      </div>
    );
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
          className={`flex-1 px-4 py-5 overflow-y-auto ${toast ? "pb-28" : ""}`}
          style={{ scrollbarWidth: "none" }}
        >

          <button
            onClick={onStartManualOrder}
            className="w-full mb-5 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {lang === "en" ? "Create Order for Table" : "สร้างออเดอร์ให้โต๊ะ"}
          </button>

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
                        <div className="flex items-center gap-1 text-accent text-xs font-medium">
                          <Clock size={12} />
                          <span>{formatClock(order.timestamp)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {waitBadge(order)}
                        <button
                          onClick={() => onCancelOrder(order.id)}
                          className="text-destructive/60 hover:text-destructive transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      {order.items.map((ci) => ci.voided ? renderVoidedRow(order, ci) : (
                        <div key={ci.cartId} className="flex items-start gap-2.5">
                          <div className="font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 bg-primary/15 text-primary">
                            {ci.quantity}
                          </div>
                          {renderItemDetails(ci)}
                        </div>
                      ))}
                    </div>
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => handleServeAll(order)}
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
                          {/* เข้ามาไม่นานหลังโต๊ะนี้เพิ่งปิดบิล — อาจเป็นลูกค้าคนก่อนที่เปิดหน้าเว็บค้างไว้ ให้พนักงานดูโต๊ะจริงก่อนทำ */}
                          {isLikelyNewCustomer(order.timestamp.getTime(), tableClosedAt[order.tableNumber]) && (
                            <div className="inline-flex items-center px-1.5 py-0.5 mb-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-300 text-[11px] font-semibold whitespace-nowrap">
                              {en ? "New customer?" : "ลูกค้าใหม่?"}
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                            <Clock size={12} />
                            <span>{formatClock(order.timestamp)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {waitBadge(order)}
                        <button
                          onClick={() => onCancelOrder(order.id)}
                          className="text-destructive/60 hover:text-destructive transition-colors"
                          title={t.cancelOrder}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Items */}
                    {/* Items — เฉพาะที่ยังไม่เสิร์ฟ (+ รายการที่ void ไว้ให้เห็นเหมือนเดิม) ที่เสิร์ฟแล้วย้ายไปโซนรอชำระ */}
                    <div className="px-4 py-3 space-y-3">
                      {order.items.filter((ci) => ci.voided || !isServed(order, ci)).map((ci) => ci.voided ? renderVoidedRow(order, ci) : (
                        <div key={ci.cartId} className="flex items-start gap-2.5">
                          <div className={`font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${ci.voided ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                            {ci.quantity}
                          </div>
                          {renderItemDetails(
                            ci,
                            !ci.voided && (
                              <button
                                onClick={() => handleRemoveItem(order, ci)}
                                className="mt-1 -ml-1 px-1 py-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <X size={12} />
                                {t.removeItem}
                              </button>
                            ),
                          )}
                          {!ci.voided && (
                            <button
                              onClick={() => handleServeItem(order, ci)}
                              className="flex-shrink-0 min-h-[44px] min-w-[76px] px-3 rounded-xl border-2 border-secondary text-secondary text-sm font-semibold hover:bg-secondary/10 transition-all active:scale-95 flex items-center justify-center gap-1"
                            >
                              <Check size={16} />
                              {t.serveItem}
                            </button>
                          )}
                        </div>
                      ))}
                      {(() => {
                        const servedCount = liveItems(order.items).filter((ci) => isServed(order, ci)).length;
                        return servedCount > 0 ? (
                          <div className="text-xs text-secondary">
                            {t.servedToast} {servedCount} {t.items}
                          </div>
                        ) : null;
                      })()}
                    </div>

                    {/* Action */}
                    <div className="px-4 pb-4 flex gap-2">
                      <button
                        onClick={() => handlePrintKitchen(order)}
                        disabled={!canPrint || isPrinting}
                        className="flex-shrink-0 bg-muted text-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-muted/80 transition-all active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Printer size={15} />
                      </button>
                      <button
                        onClick={() => onMoveTable(order.tableNumber)}
                        title={t.moveTable}
                        className="flex-shrink-0 bg-muted text-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-muted/80 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <ArrowRightLeft size={15} />
                      </button>
                      <button
                        onClick={() => handleServeAll(order)}
                        className="flex-1 min-h-[44px] bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Check size={15} />
                        {t.markServed}
                        {unserved(order).length > 1 && ` (${unserved(order).length})`}
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
                {awaitingCount}
              </span>
            </div>

            {awaitingCount === 0 ? (
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
                      {data.waiting > 0 ? (
                        // ยังมีจานค้าง — บิลยังไม่ครบ ไม่โชว์ยอดกันพนักงานเข้าใจว่าเก็บเงินได้แล้ว
                        <div className="text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-1 rounded-full whitespace-nowrap">
                          {t.stillWaiting} {data.waiting} {t.items}
                        </div>
                      ) : (
                        <div className="font-display font-bold text-xl text-foreground">
                          {t.thb}{data.total}
                        </div>
                      )}
                    </div>
                    {/* แตะรายการที่เสิร์ฟแล้ว → ปุ่มย้อนกลับเป็นยังไม่เสิร์ฟ */}
                    <div className="px-4 py-1.5">
                      {data.served.map(({ order, ci }) => {
                        const key = `served:${order.id}:${ci.cartId}`;
                        return (
                          <div key={ci.cartId}>
                            {renderTapRow(ci, () => togglePick(key), undoPick === key)}
                            {undoPick === key && undoButton(en ? "Undo — not served yet" : "ย้อนกลับ (ยังไม่เสิร์ฟ)", () => askUnserveItem(order, ci))}
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 pb-3 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{tapHint}</span>
                      <button
                        onClick={() => onMoveTable(tableNum)}
                        className="min-h-[36px] px-3 rounded-lg inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 active:scale-95 transition-all"
                      >
                        <ArrowRightLeft size={13} />
                        {t.moveTable}
                      </button>
                    </div>
                  </div>
                ))}
                {awaitingTakeaways.map((order) => (
                  <div
                    key={order.id}
                    className="bg-card rounded-2xl border-2 overflow-hidden opacity-80"
                    style={{ borderColor: "rgba(74, 103, 65, 0.3)" }}
                  >
                    <div
                      className="px-4 py-3 flex items-center justify-between border-b"
                      style={{ background: "rgba(74, 103, 65, 0.06)", borderColor: "rgba(74, 103, 65, 0.15)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary text-secondary-foreground font-display font-bold text-sm rounded-full flex items-center justify-center flex-shrink-0">
                          {order.takeawayLabel || "T"}
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{lang === "en" ? "Takeaway" : "กลับบ้าน"}</div>
                          <div className="text-muted-foreground text-sm">{formatClock(order.timestamp)}</div>
                        </div>
                      </div>
                      <div className="font-display font-bold text-xl text-foreground">
                        {t.thb}{orderTotal(order)}
                      </div>
                    </div>
                    {/* กลับบ้านพร้อมรับทั้งใบ — แตะรายการไหนก็ได้ → ปุ่มย้อนทั้งใบกลับเป็นกำลังเตรียม */}
                    <div className="px-4 py-1.5">
                      {liveItems(order.items).map((ci) =>
                        <div key={ci.cartId}>{renderTapRow(ci, () => togglePick(`ready:${order.id}`), undoPick === `ready:${order.id}`)}</div>,
                      )}
                      {undoPick === `ready:${order.id}` && undoButton(en ? "Undo — back to preparing" : "ย้อนกลับ (กำลังเตรียม)", () => askUnready(order))}
                    </div>
                    <div className="px-4 pb-3 text-[11px] text-muted-foreground">{tapHint}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* แถบย้อนกลับ — ด้านล่างจอ ตัวใหญ่ สีเข้มตัดกับพื้น ปุ่มสีเหลืองใหญ่กดง่าย ค้าง UNDO_MS */}
      {toast && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 pointer-events-none" role="status" aria-live="polite">
          <div className="pointer-events-auto flex items-center gap-3 bg-[#1F140B] text-white rounded-2xl shadow-2xl border-2 border-amber-400 pl-4 pr-2 py-2 max-w-xl w-full">
            <span className="flex-1 min-w-0 text-base font-semibold leading-snug">{toast.label}</span>
            <button
              onClick={() => {
                const undo = toast.undo;
                dismissToast();
                undo().catch(failAlert);
              }}
              className="flex-shrink-0 min-h-[52px] px-5 rounded-xl inline-flex items-center gap-2 bg-amber-400 text-[#1F140B] text-base font-bold hover:bg-amber-300 active:scale-95 transition-all"
            >
              <RotateCcw size={18} />
              {undoLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
