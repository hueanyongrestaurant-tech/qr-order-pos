import { useState } from "react";
import { Check, CreditCard, Minus, Plus, Printer } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { CartItem, Language, Order, PaymentMethod, StaffTab } from "../types";
import { T } from "../translations";
import { cartItemKey, cartItemTotal, compareTables, formatOptionDetails, liveItemCount, orderTotal } from "../utils";
import { StaffHeader } from "./StaffHeader";
import type { ReceiptData } from "./ticket";
import { useSelectedPrinterAddress } from "./printerStore";

// ─── Staff Payment Screen ─────────────────────────────────────────────────────

interface StaffPaymentProps {
  lang: Language;
  orders: Order[];
  onCloseTable: (n: string, paymentMethod: PaymentMethod, cashReceived?: number) => void;
  onCloseTakeaway: (orderId: string, paymentMethod: PaymentMethod, cashReceived?: number) => void;
  onAdjustItem: (contributingOrders: Order[], key: string, delta: number) => void;
  onAdjustTakeawayItem: (orderId: string, key: string, delta: number) => void;
  onCancelOrder: (orderId: string) => void;
  onCancelOrders: (orderIds: string[]) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

interface PaymentCardProps {
  keyId: string;
  label: string;
  subtitle: string;
  total: number;
  items: CartItem[];
  voidedItems?: CartItem[];
  onAdjust: (key: string, delta: number) => void;
  total2: number;
  closeAction: () => void;
  cancelAction?: () => void;
  printReceiptAction?: () => void;
  printDisabled: boolean;
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
  keyId, label, subtitle, total, items, voidedItems, onAdjust, total2, closeAction, cancelAction, printReceiptAction, printDisabled,
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
            {voidedItems && voidedItems.length > 0 && voidedItems.map((ci, ciIdx) => (
              <div key={`voided-${ciIdx}`} className="flex items-center justify-between py-1 opacity-50">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium line-through text-muted-foreground truncate">
                    {ci.quantity}× {lang === "en" ? ci.item.name.en : ci.item.name.th}
                  </div>
                  <div className="text-destructive text-xs">
                    {t.voidedLabel}{ci.voidReason ? ` · ${ci.voidReason}` : ""}
                  </div>
                </div>
                <span className="text-muted-foreground text-sm flex-shrink-0 ml-2 line-through">{t.thb}0</span>
              </div>
            ))}
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
                disabled={printDisabled || (paymentMethod === "cash" && (cashInput === "" || Number(cashInput) < total2))}
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

export function StaffPaymentScreen({
  lang, orders, onCloseTable, onCloseTakeaway, onAdjustItem, onAdjustTakeawayItem,
  onCancelOrder, onCancelOrders, onAskConfirm, onTabChange, onLogout, onLangToggle,
}: StaffPaymentProps) {
  const t = T[lang];
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  // native printing ต้องเปิดผ่านแอป Capacitor จริง + ตั้งเครื่องพิมพ์ไว้แล้วบนเครื่องนี้ —
  // เครื่องที่ไม่เข้าเงื่อนไขให้ปุ่มพิมพ์ disabled ไปเลย ไม่ fallback ไป window.print()/RawBT แล้ว
  // ใช้ hook แทนอ่าน localStorage ตรงๆ เพราะเลือกเครื่องพิมพ์ใหม่ใน PrinterSettingsModal
  // (ซึ่งอยู่ลึกใน StaffHeader) ไม่ทำให้หน้านี้ re-render เอง ต้องมี event subscription
  const selectedPrinterAddress = useSelectedPrinterAddress();
  const canPrintReceipt = Capacitor.isNativePlatform() && !!selectedPrinterAddress;
  const printDisabled = !canPrintReceipt || isPrinting;

  const handlePrintReceipt = async (data: ReceiptData) => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const { printReceiptNative } = await import("./nativePrinter");
      await printReceiptNative(data, lang);
    } catch (err: any) {
      alert((lang === "en" ? "Print failed: " : "พิมพ์ไม่สำเร็จ: ") + (err?.message || String(err)));
    } finally {
      setIsPrinting(false);
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
    const allItems = tableOrders.flatMap((o) => o.items).filter((ci) => !ci.voided);
    const voidedItems = tableOrders.flatMap((o) => o.items).filter((ci) => ci.voided);
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
      voidedItems,
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
                        voidedItems={g.voidedItems}
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
                        printDisabled={printDisabled}
                        cancelAction={() => {
                          onCancelOrders(g.orders.map((o) => o.id));
                          setExpandedKey(null);
                        }}
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
                        subtitle={`${liveItemCount(order.items)} ${t.items}`}
                        total={orderTotal(order)}
                        total2={orderTotal(order)}
                        items={order.items.filter((ci) => !ci.voided)}
                        voidedItems={order.items.filter((ci) => ci.voided)}
                        onAdjust={(key, delta) => onAdjustTakeawayItem(order.id, key, delta)}
                        closeAction={() => onCloseTakeaway(order.id, paymentMethod, paymentMethod === "cash" ? Number(cashInput || 0) : undefined)}
                        printReceiptAction={() =>
                          handlePrintReceipt({
                            label: order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน"),
                            items: order.items.filter((ci) => !ci.voided),
                            total: orderTotal(order),
                            paymentMethod,
                            cashReceived: paymentMethod === "cash" ? Number(cashInput || 0) : undefined,
                          })
                        }
                        printDisabled={printDisabled}
                        cancelAction={() => { onCancelOrder(order.id); setExpandedKey(null); }}
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
    </>
  );
}
