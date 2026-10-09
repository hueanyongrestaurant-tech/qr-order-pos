import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, History, Loader2 } from "lucide-react";
import type { Language, Order, StaffTab } from "../types";
import { T } from "../translations";
import {
  cartItemTotal,
  dayAfter,
  fetchPaidOrders,
  FETCH_MAX_AUTO_RETRIES,
  FETCH_RETRY_DELAY_MS,
  formatClock,
  formatDateInput,
  formatOptionDetails,
  liveItemCount,
  orderTotal,
  orderPaymentBreakdown,
} from "../utils";
import { StaffHeader } from "./StaffHeader";

interface StaffHistoryProps {
  lang: Language;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
  initialDate?: string;                                  // เปิดหน้ามาที่วันนี้แทน "วันนี้" (หลังบันทึกบิลย้อนหลัง)
  onAddBackfill: () => void;                             // ไปหน้าเพิ่มบิลย้อนหลัง
  onCancelBackfill: (orders: Order[]) => Promise<void>;  // ยกเลิกบิลย้อนหลัง (ถามยืนยันแล้ว)
  onAskConfirm: (message: string, onConfirm: () => void) => void;
}

// วิธีชำระของทั้งบิล — รวมทุกออเดอร์ในบิล ไม่ดูแค่ใบแรก เพราะบิลจ่ายแยกแบ่งยอดโอนไว้คนละใบ
// จ่ายแยกแสดงยอดจริงของแต่ละฝั่ง บิลเก่า/จ่ายทางเดียวแสดงแค่ชื่อวิธีเหมือนเดิม
function paymentSummary(orders: Order[], lang: Language, thb: string): string {
  const cashLabel = lang === "en" ? "Cash" : "เงินสด";
  const transferLabel = lang === "en" ? "Transfer" : "เงินโอน";
  if (orders.some((o) => o.paymentMethod === "split")) {
    const sum = orders.map(orderPaymentBreakdown).reduce((a, b) => ({ cash: a.cash + b.cash, transfer: a.transfer + b.transfer }), { cash: 0, transfer: 0 });
    return `${cashLabel} ${thb}${sum.cash} · ${transferLabel} ${thb}${sum.transfer}`;
  }
  return orders[0].paymentMethod === "cash" ? cashLabel : transferLabel;
}

interface HistoryEntry {
  tableNumber: string;
  isTakeaway?: boolean;
  takeawayLabel?: string;
  timestamp: Date;
  orders: Order[];
  total: number;
  itemCount: number;
  backfilled: boolean;
}

export function StaffHistoryScreen({ lang, onTabChange, onLogout, onLangToggle, initialDate, onAddBackfill, onCancelBackfill, onAskConfirm }: StaffHistoryProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  const [date, setDate] = useState(initialDate ?? today);
  const [reloadKey, setReloadKey] = useState(0); // เพิ่มทีละ 1 = ดึงข้อมูลวันเดิมใหม่ (หลังยกเลิกบิลย้อนหลัง)
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  // ดึงออเดอร์ที่ชำระแล้วเฉพาะวันที่เลือกไว้ (default วันนี้) — one-time fetch ต่อวันเดียว
  // (ไม่ใช่ rolling window หลายวันเหมือนเดิม) เร็วขึ้นเพราะ query แคบลงมาก
  const [fetchedOrders, setFetchedOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false); // true = พึ่ง fail อยู่ระหว่างรอ auto-retry รอบถัดไป
  const [loadFailed, setLoadFailed] = useState(false); // true = auto-retry ครบแล้วยังไม่สำเร็จ รอกดเอง
  const resetRetry = () => { setRetryCount(0); setRetrying(false); setLoadFailed(false); };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    setLoading(true);

    fetchPaidOrders(new Date(`${date}T00:00:00`), dayAfter(date))
      .then((rows) => {
        if (cancelled) return;
        setFetchedOrders(rows);
        setLoadFailed(false);
      })
      .catch((err) => {
        console.error("fetchPaidOrders (history) failed", err);
        if (cancelled) return;
        if (retryCount < FETCH_MAX_AUTO_RETRIES) {
          setRetrying(true);
          retryTimer = window.setTimeout(() => {
            setRetrying(false);
            setRetryCount((n) => n + 1);
          }, FETCH_RETRY_DELAY_MS);
        } else {
          setLoadFailed(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, retryCount, reloadKey]);

  const paidOrders = fetchedOrders
    .filter((o) => o.status === "paid")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  function dateLabel(d: Date): string {
    return d.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
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
      existing.itemCount += liveItemCount(o.items);
      if (o.timestamp < existing.timestamp) existing.timestamp = o.timestamp;
      if (o.backfilled) existing.backfilled = true;
    } else {
      entryMap.set(key, {
        tableNumber: o.tableNumber,
        isTakeaway: o.isTakeaway,
        takeawayLabel: o.takeawayLabel,
        timestamp: o.timestamp,
        orders: [o],
        total: orderTotal(o),
        itemCount: liveItemCount(o.items),
        backfilled: !!o.backfilled,
      });
    }
  });
  const entries = Array.from(entryMap.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const dayTotal = entries.reduce((s, e) => s + e.total, 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="history" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-stretch gap-2 mb-4">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => { if (e.target.value) { setDate(e.target.value); resetRetry(); } }}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={() => { setDate(today); resetRetry(); }}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
        </div>

        <button
          onClick={onAddBackfill}
          className="w-full mb-4 py-2.5 rounded-xl text-sm font-medium bg-card border-2 border-dashed border-primary/50 text-primary hover:bg-primary/5 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <History size={15} />
          {lang === "en" ? "Add a past bill (yesterday)" : "เพิ่มบิลย้อนหลัง (เมื่อวาน)"}
        </button>

        <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs mb-4">
          <div className="flex items-center gap-2 min-w-0">
            {(loading || retrying) && <Loader2 size={14} className="animate-spin" />}
            <span className="truncate">
              {retrying || (loading && retryCount > 0)
                ? (lang === "en" ? "Couldn't load — retrying…" : "โหลดข้อมูลไม่สำเร็จ กำลังลองใหม่…")
                : dateLabel(new Date(`${date}T00:00:00`))}
            </span>
          </div>
          {!loading && !retrying && entries.length > 0 && (
            <span className="flex-shrink-0">{entries.length} {entries.length === 1 ? t.bills : t.billsPlural} · {t.thb}{dayTotal}</span>
          )}
        </div>

        {loadFailed && (
          <div className="flex items-center justify-between gap-2 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5 mb-4">
            <span className="text-destructive text-xs">
              {lang === "en" ? "Couldn't load. Check the internet and try again." : "โหลดไม่สำเร็จ เช็คอินเทอร์เน็ตแล้วลองใหม่"}
            </span>
            <button
              onClick={resetRetry}
              className="text-xs font-semibold text-destructive underline flex-shrink-0"
            >
              {lang === "en" ? "Retry" : "ลองอีกครั้ง"}
            </button>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {loading || retrying
              ? (lang === "en" ? "Loading…" : "กำลังโหลด…")
              : loadFailed
                ? (lang === "en" ? "Couldn't load data" : "โหลดข้อมูลไม่สำเร็จ")
                : (lang === "en" ? "No paid bills on this day" : "ไม่มีบิลที่จ่ายแล้วในวันที่เลือก")}
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e, idx) => {
              const entryKey = `${date}-${idx}`;
              const isExpanded = expandedEntry === entryKey;
              return (
                <div key={idx} className="bg-card rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedEntry(isExpanded ? null : entryKey)}
                    className="w-full p-3 flex items-center justify-between"
                  >
                    <div className="text-left">
                      <div className="text-sm font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                        {e.isTakeaway ? e.takeawayLabel : `${t.tableLabel} ${e.tableNumber}`}
                        {e.backfilled && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                            {lang === "en" ? "Added later" : "เพิ่มย้อนหลัง"}
                          </span>
                        )}
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
                        <div key={ciIdx} className={`flex items-start justify-between text-sm ${ci.voided ? "opacity-50" : ""}`}>
                          <div>
                            <div className={ci.voided ? "line-through text-muted-foreground" : "text-foreground"}>
                              {ci.quantity}× {lang === "en" ? ci.item.name.en : ci.item.name.th}
                            </div>
                            {formatOptionDetails(ci, lang) && (
                              <div className="text-muted-foreground text-xs">{formatOptionDetails(ci, lang)}</div>
                            )}
                            {ci.voided && (
                              <div className="text-destructive text-xs">
                                {t.voidedLabel}{ci.voidReason ? ` · ${ci.voidReason}` : ""}
                              </div>
                            )}
                          </div>
                          <span className="text-muted-foreground flex-shrink-0">{t.thb}{cartItemTotal(ci)}</span>
                        </div>
                      ))}
                      {e.orders[0]?.paymentMethod && (
                        <div className="text-muted-foreground text-xs pt-1">
                          {paymentSummary(e.orders, lang, t.thb)}
                        </div>
                      )}
                      {e.backfilled && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-muted-foreground text-xs">
                            {e.orders[0]?.backfilledAt
                              ? `${lang === "en" ? "Entered" : "บันทึกเมื่อ"} ${e.orders[0].backfilledAt.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { day: "numeric", month: "short" })} ${formatClock(e.orders[0].backfilledAt)}`
                              : ""}
                          </span>
                          <button
                            disabled={cancellingKey === entryKey}
                            onClick={() =>
                              onAskConfirm(
                                lang === "en"
                                  ? `Cancel this past bill (${t.thb}${e.total})? It will be removed from sales and stats.`
                                  : `ยกเลิกบิลย้อนหลังนี้ (${t.thb}${e.total})? ยอดจะถูกหักออกจากยอดขายและสถิติ`,
                                () => {
                                  setCancellingKey(entryKey);
                                  onCancelBackfill(e.orders)
                                    .then(() => { setExpandedEntry(null); setReloadKey((k) => k + 1); })
                                    .catch((err) => console.error("cancel backfill failed", err))
                                    .finally(() => setCancellingKey(null));
                                },
                              )
                            }
                            className="text-destructive/80 hover:text-destructive text-xs font-medium flex-shrink-0 disabled:opacity-40"
                          >
                            {lang === "en" ? "Cancel this bill" : "ยกเลิกบิลนี้"}
                          </button>
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
    </div>
  );
}
