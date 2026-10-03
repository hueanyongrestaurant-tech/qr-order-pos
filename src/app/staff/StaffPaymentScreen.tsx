import { useState } from "react";
import { Check, CreditCard, Minus, Plus, Printer } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { CartItem, Language, Order, PaymentInput, PaymentMethod, StaffTab } from "../types";
import { T } from "../translations";
import { cartItemKey, cartItemTotal, compareTables, formatOptionDetails, liveItemCount, orderTotal } from "../utils";
import { StaffHeader } from "./StaffHeader";
import type { ReceiptData } from "./ticket";
import { useSelectedPrinterAddress } from "./printerStore";

// ─── Staff Payment Screen ─────────────────────────────────────────────────────

interface StaffPaymentProps {
  lang: Language;
  orders: Order[];
  onCloseTable: (n: string, payment: PaymentInput) => void;
  onCloseTakeaway: (orderId: string, payment: PaymentInput) => void;
  onAdjustItem: (contributingOrders: Order[], key: string, delta: number) => void;
  onAdjustTakeawayItem: (orderId: string, key: string, delta: number) => void;
  onCancelOrder: (orderId: string) => void;
  onCancelOrders: (orderIds: string[]) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

// จ่ายแยก: ช่องที่พนักงานพิมพ์เองล่าสุด (side) + ค่าที่พิมพ์ — อีกช่องคิดจากยอดบิลเสมอ
// เก็บค่าเดียวแบบนี้แทน 2 ช่องแยกกัน ทั้งสองช่องจึงรวมกันเท่ายอดบิลพอดีเสมอ ไม่มีทางขัดกันเอง
type SplitSide = "transfer" | "cash";
interface SplitEntry {
  side: SplitSide;
  value: string;
}
const EMPTY_SPLIT: SplitEntry = { side: "transfer", value: "" };

interface PaymentCardProps {
  keyId: string;
  label: string;
  subtitle: string;
  total: number;
  items: CartItem[];
  voidedItems?: CartItem[];
  onAdjust: (key: string, delta: number) => void;
  total2: number;
  closeAction: (payment: PaymentInput) => void;
  cancelAction?: () => void;
  printReceiptAction?: (payment: PaymentInput) => void;
  printDisabled: boolean;
  expandedKey: string | null;
  select: (key: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  cashInput: string;
  setCashInput: (v: string) => void;
  splitEntry: SplitEntry;
  setSplitEntry: (v: SplitEntry) => void;
  lang: Language;
  t: typeof T["en"];
}

// ช่องยอดของการจ่ายแยก 1 ช่อง — ช่องที่พนักงานพิมพ์เองดูเป็นช่องกรอกปกติ ส่วนช่องที่ระบบคิดให้
// พื้นจาง ขอบประ มีป้าย "คิดให้" แต่ยังแตะแก้ได้: แตะแล้วเลือกตัวเลขทั้งหมดไว้ พิมพ์ทับได้ทันที
// แล้วช่องนั้นกลายเป็นช่องที่กรอกเอง อีกช่องกลับไปเป็นช่องคิดให้แทน
function SplitAmountField({
  label, autoLabel, thb, entry, side, computed, onChange,
}: {
  label: string;
  autoLabel: string;
  thb: string;
  entry: SplitEntry;
  side: SplitSide;
  computed: number;
  onChange: (value: string) => void;
}) {
  const isEntered = entry.side === side;
  // ช่องคิดให้แสดงตัวเลขเฉพาะตอนผลคิดได้มากกว่า 0 — ค่าติดลบ/0 ปล่อยว่าง (ข้อความเตือนใต้ช่องบอกเหตุผลเอง)
  const value = isEntered ? entry.value : entry.value !== "" && computed > 0 ? String(computed) : "";
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-medium text-foreground mb-1">{label}</span>
      <span className="relative block">
        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isEntered ? "text-foreground" : "text-muted-foreground"}`}>{thb}</span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          // select หลังเฟรมถัดไป — มือถือ/WebView วาง caret ตามจุดที่แตะทีหลัง focus ทำให้ select ทันทีหลุด
          onFocus={(e) => { if (!isEntered) { const el = e.target; requestAnimationFrame(() => el.select()); } }}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          className={`w-full rounded-xl pl-7 pr-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:border-solid ${isEntered
            ? "bg-background border-2 border-border text-foreground font-semibold"
            : "bg-muted/50 border-2 border-dashed border-border text-muted-foreground"
            }`}
        />
        {!isEntered && value !== "" && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground bg-background/80 px-1.5 py-0.5 rounded-md">
            {autoLabel}
          </span>
        )}
      </span>
    </label>
  );
}

function PaymentCard({
  keyId, label, subtitle, total, items, voidedItems, onAdjust, total2, closeAction, cancelAction, printReceiptAction, printDisabled,
  expandedKey, select, paymentMethod, setPaymentMethod, cashInput, setCashInput, splitEntry, setSplitEntry, lang, t,
}: PaymentCardProps) {
  const isSelected = expandedKey === keyId;
  const cashLabel = lang === "en" ? "Cash" : "เงินสด";
  const transferLabel = lang === "en" ? "Transfer" : "เงินโอน";

  // split: กรอกช่องไหนก็ได้ (ยอดโอน หรือ ส่วนเงินสด) อีกช่อง = ยอดบิล − ช่องที่กรอก แล้วคิดเงินทอนจากส่วนเงินสด
  // ทั้งสองส่วนต้องมากกว่า 0 — ส่วนใดส่วนหนึ่งเป็น 0 หรือเต็มบิลให้ใช้ปุ่มเงินสด/เงินโอนแทน
  const enteredNum = Number(splitEntry.value);
  const transferNum = splitEntry.side === "transfer" ? enteredNum : total2 - enteredNum;
  const splitTransferValid = splitEntry.value !== "" && transferNum > 0 && transferNum < total2;
  const cashDue = paymentMethod === "cash" ? total2 : paymentMethod === "split" ? total2 - transferNum : 0;
  const cashNum = Number(cashInput);
  const canClose =
    paymentMethod === "transfer" ||
    (paymentMethod === "cash" && cashInput !== "" && cashNum >= cashDue) ||
    (paymentMethod === "split" && splitTransferValid && cashInput !== "" && cashNum >= cashDue);
  const payment: PaymentInput = {
    method: paymentMethod,
    ...(paymentMethod !== "transfer" ? { cashReceived: Number(cashInput || 0) } : {}),
    ...(paymentMethod === "split" ? { transferAmount: transferNum } : {}),
  };
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
            {(["cash", "transfer", "split"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => { setPaymentMethod(m); setCashInput(""); setSplitEntry(EMPTY_SPLIT); }}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all ${paymentMethod === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-foreground"
                  }`}
              >
                {m === "cash" ? cashLabel : m === "transfer" ? transferLabel : (lang === "en" ? "Cash + Transfer" : "สด + โอน")}
              </button>
            ))}
          </div>

          {paymentMethod === "split" && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">
                  {lang === "en" ? "Fill in either box" : "กรอกช่องไหนก็ได้ อีกช่องคิดให้"}
                </span>
                {/* แบ่งครึ่ง: ส่วนโอนปัดลง เศษไปอยู่ส่วนเงินสด (เช่นบิล 351 → โอน 175 สด 176) */}
                <button
                  onClick={() => setSplitEntry({ side: "transfer", value: String(Math.floor(total2 / 2)) })}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-all active:scale-95"
                >
                  {lang === "en" ? "Half" : "แบ่งครึ่ง"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["transfer", "cash"] as SplitSide[]).map((side) => (
                  <SplitAmountField
                    key={side}
                    label={side === "transfer" ? (lang === "en" ? "Transfer" : "ยอดโอน") : (lang === "en" ? "Cash part" : "ส่วนเงินสด")}
                    autoLabel={lang === "en" ? "auto" : "คิดให้"}
                    thb={t.thb}
                    entry={splitEntry}
                    side={side}
                    computed={side === "transfer" ? transferNum : total2 - transferNum}
                    onChange={(value) => setSplitEntry({ side, value })}
                  />
                ))}
              </div>
              {splitEntry.value !== "" && !splitTransferValid && (
                <div className="text-sm font-semibold mt-1.5 text-destructive">
                  {lang === "en"
                    ? `Both parts must be above ${t.thb}0 and add up to ${t.thb}${total2}`
                    : `ทั้งสองส่วนต้องมากกว่า ${t.thb}0 และรวมกันได้ ${t.thb}${total2}`}
                </div>
              )}
            </div>
          )}

          {(paymentMethod === "cash" || (paymentMethod === "split" && splitTransferValid)) && (
            <div className="mb-3">
              <input
                type="text"
                inputMode="numeric"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={paymentMethod === "split" ? (lang === "en" ? "Cash received (cash part)" : "รับเงินสดมา (ส่วนเงินสด)") : (lang === "en" ? "Cash received" : "รับเงินมา")}
                className="w-full bg-background border-2 border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {cashInput !== "" && (
                <div className={`text-sm font-semibold mt-1.5 ${cashNum >= cashDue ? "text-secondary" : "text-destructive"}`}>
                  {cashNum >= cashDue
                    ? `${lang === "en" ? "Change" : "เงินทอน"}: ${t.thb}${cashNum - cashDue}`
                    : (lang === "en" ? "Amount not enough" : "จำนวนเงินไม่พอ")}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {printReceiptAction && (
              <button
                onClick={() => printReceiptAction(payment)}
                disabled={printDisabled || !canClose}
                className="flex-shrink-0 bg-muted text-foreground px-4 py-3 rounded-xl text-sm font-semibold hover:bg-muted/80 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer size={16} />
              </button>
            )}
            <button
              onClick={() => closeAction(payment)}
              disabled={!canClose}
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
  const [splitEntry, setSplitEntry] = useState<SplitEntry>(EMPTY_SPLIT);
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
    setSplitEntry(EMPTY_SPLIT);
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
                    {lang === "en" ? "Dine-in" : "ทานที่ร้าน"}
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
                        closeAction={(payment) => onCloseTable(g.tableNumber, payment)}
                        printReceiptAction={(payment) =>
                          handlePrintReceipt({
                            label: `${t.tableLabel} ${g.tableNumber}`,
                            items: g.items,
                            total: g.total,
                            paymentMethod: payment.method,
                            cashReceived: payment.cashReceived,
                            transferAmount: payment.transferAmount,
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
                        splitEntry={splitEntry}
                        setSplitEntry={setSplitEntry}
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
                    {lang === "en" ? "Takeaway" : "กลับบ้าน"}
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
                        closeAction={(payment) => onCloseTakeaway(order.id, payment)}
                        printReceiptAction={(payment) =>
                          handlePrintReceipt({
                            label: order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน"),
                            items: order.items.filter((ci) => !ci.voided),
                            total: orderTotal(order),
                            paymentMethod: payment.method,
                            cashReceived: payment.cashReceived,
                            transferAmount: payment.transferAmount,
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
                        splitEntry={splitEntry}
                        setSplitEntry={setSplitEntry}
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
