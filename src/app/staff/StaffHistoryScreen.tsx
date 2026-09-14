import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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
} from "../utils";
import { StaffHeader } from "./StaffHeader";

interface StaffHistoryProps {
  lang: Language;
  onTabChange: (tab: StaffTab) => void;
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

export function StaffHistoryScreen({ lang, onTabChange, onLogout, onLangToggle }: StaffHistoryProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  const [date, setDate] = useState(today);
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
  }, [date, retryCount]);

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
    } else {
      entryMap.set(key, {
        tableNumber: o.tableNumber,
        isTakeaway: o.isTakeaway,
        takeawayLabel: o.takeawayLabel,
        timestamp: o.timestamp,
        orders: [o],
        total: orderTotal(o),
        itemCount: liveItemCount(o.items),
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
              {lang === "en" ? "Couldn't load data. Check your connection." : "โหลดข้อมูลไม่สำเร็จ เช็คการเชื่อมต่อของคุณ"}
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
                : (lang === "en" ? "No completed orders on this day" : "ไม่มีออเดอร์ที่เสร็จสิ้นในวันนี้")}
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
    </div>
  );
}
