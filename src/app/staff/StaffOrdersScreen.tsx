import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Clock, Plus, Printer, Trash2, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { CartItem, Language, Order, StaffTab } from "../types";
import { T } from "../translations";
import { compareTables, formatClock, liveItems, orderTotal, timeAgo } from "../utils";

const UNDO_MS = 5000;
import { StaffHeader } from "./StaffHeader";
import { kitchenOptionSummary } from "./ticket";
import { useSelectedPrinterAddress } from "./printerStore";

// ─── Staff Orders Screen ──────────────────────────────────────────────────────

interface StaffOrdersProps {
  lang: Language;
  orders: Order[];
  onMarkServed: (orderId: string) => Promise<void>;
  onUnmarkServed: (orderId: string) => Promise<void>;
  onServeItem: (orderId: string, cartId: string) => Promise<void>;
  onUnserveItem: (orderId: string, cartId: string) => Promise<void>;
  onRemoveItem: (orderId: string, cartId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onStartManualOrder: () => void;
}

export function StaffOrdersScreen({ lang, orders, onMarkServed, onUnmarkServed, onServeItem, onUnserveItem, onRemoveItem, onCancelOrder, onTabChange, onLogout, onLangToggle, onAskConfirm, onStartManualOrder }: StaffOrdersProps) {
  const t = T[lang];

  // กดเสิร์ฟแล้วย้ายโซนทันทีบนเครื่องนี้ ไม่ต้องรอ transaction วิ่งไป server กลับมา (เน็ตร้านช้าอาจกินเวลาหลายวิ
  // ระหว่างนั้นพนักงานจะกดซ้ำ) — key = "orderId:cartId" ต่อรายการ หรือ "orderId:*" เมื่อกดเสิร์ฟทั้งหมด
  const [pendingServed, setPendingServed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ id: number; label: string; undo: () => void } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = (label: string, undo: () => void) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    const id = Date.now();
    setToast({ id, label, undo });
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast((cur) => (cur?.id === id ? null : cur));
    }, UNDO_MS);
  };

  const dismissToast = () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  };

  const failAlert = (err: any) =>
    alert((lang === "en" ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err)));

  const handleServeItem = (order: Order, ci: CartItem) => {
    const key = `${order.id}:${ci.cartId}`;
    addPending(key);
    // resolve เป็น true/false เสมอ (ไม่ reject) — กัน unhandled rejection ตอนไม่มีใครกดเลิกทำ
    const serving = onServeItem(order.id, ci.cartId).then(
      () => true,
      (err) => {
        dropPending(key);
        failAlert(err);
        return false;
      },
    );
    const name = lang === "en" ? ci.item.name.en : ci.item.name.th;
    // เลิกทำต้องรอให้การเสิร์ฟเขียนเสร็จก่อน ไม่งั้น unserve อาจวิ่งถึง server ก่อน แล้ว serve มาทับทีหลัง
    showToast(`${t.servedToast} · ${name}`, () => {
      dropPending(key);
      serving.then((ok) => (ok ? onUnserveItem(order.id, ci.cartId) : undefined)).catch(failAlert);
    });
  };

  const handleServeAll = (order: Order) => {
    const key = `${order.id}:*`;
    addPending(key);
    const serving = onMarkServed(order.id).then(
      () => true,
      (err) => {
        dropPending(key);
        failAlert(err);
        return false;
      },
    );
    const label = order.isTakeaway ? order.takeawayLabel : `${t.tableLabel} ${order.tableNumber}`;
    showToast(`${order.isTakeaway ? (lang === "en" ? "Ready" : "พร้อมรับแล้ว") : t.markServed} · ${label}`, () => {
      dropPending(key);
      serving.then((ok) => (ok ? onUnmarkServed(order.id) : undefined)).catch(failAlert);
    });
  };

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
  const canPrint = Capacitor.isNativePlatform() && !!selectedPrinterAddress;

  // ปุ่มพิมพ์เอง — ใช้ตอนสร้างออเดอร์ใหม่ (ที่ auto-print ไปแล้ว แต่พิมพ์ซ้ำได้ถ้ากระดาษติด/พลาด)
  // และตอนแก้ไขรายการออเดอร์ที่กำลังทำอยู่ (auto-print จะไม่ยิงซ้ำให้ ต้องกดเองตรงนี้)
  const handlePrintKitchen = async (order: Order) => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const { printKitchenTicketNative } = await import("./nativePrinter");
      await printKitchenTicketNative(order, lang);
    } catch (err: any) {
      alert((lang === "en" ? "Print failed: " : "พิมพ์ไม่สำเร็จ: ") + (err?.message || String(err)));
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
  const awaitingByTable: Record<string, { orders: Order[]; served: CartItem[]; waiting: number; total: number }> = {};
  orders.forEach((o) => {
    if (o.isTakeaway || (o.status !== "in-progress" && o.status !== "awaiting-payment")) return;
    const g = (awaitingByTable[o.tableNumber] ??= { orders: [], served: [], waiting: 0, total: 0 });
    g.orders.push(o);
    g.served.push(...liveItems(o.items).filter((ci) => isServed(o, ci)));
    g.waiting += unserved(o).length;
    g.total += orderTotal(o);
  });
  const awaitingTables = Object.entries(awaitingByTable)
    .filter(([, g]) => g.served.length > 0)
    .sort(([a], [b]) => compareTables(a, b));

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
                        onClick={() => onCancelOrder(order.id)}
                        className="text-destructive/60 hover:text-destructive transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      {order.items.map((ci) => (
                        <div key={ci.cartId} className={`flex items-start gap-2.5 ${ci.voided ? "opacity-50" : ""}`}>
                          <div className={`font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${ci.voided ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
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
                          <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <Clock size={12} />
                          <span>{formatClock(order.timestamp)}</span>
                        </div>
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
                      {order.items.filter((ci) => ci.voided || !isServed(order, ci)).map((ci) => (
                        <div key={ci.cartId} className={`flex items-start gap-2.5 ${ci.voided ? "opacity-50" : ""}`}>
                          <div className={`font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${ci.voided ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                            {ci.quantity}
                          </div>
                          {renderItemDetails(
                            ci,
                            !ci.voided && (
                              <button
                                onClick={() => onRemoveItem(order.id, ci.cartId)}
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
                    <div className="px-4 py-2.5 space-y-1">
                      {data.served.map((ci) => (
                        <div key={ci.cartId} className="flex items-start gap-2 text-sm">
                          <span className="font-semibold text-secondary w-5 flex-shrink-0">{ci.quantity}</span>
                          <span className="text-foreground leading-tight">{lang === "en" ? ci.item.name.en : ci.item.name.th}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* แถบเลิกทำ 5 วิ หลังกดเสิร์ฟ — กันแตะพลาดบนแท็บเล็ต */}
      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-[#3C2414] text-[#FFF8F0] rounded-xl shadow-lg pl-4 pr-1.5 py-1.5 max-w-md w-full">
            <span className="flex-1 min-w-0 truncate text-sm">{toast.label}</span>
            <button
              onClick={() => {
                toast.undo();
                dismissToast();
              }}
              className="min-h-[44px] px-4 rounded-lg font-semibold text-sm text-amber-300 hover:bg-white/10 active:scale-95 transition-all"
            >
              {t.undo}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
