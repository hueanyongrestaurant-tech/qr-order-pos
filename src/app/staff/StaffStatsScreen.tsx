import { useState, useEffect, useRef } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import type { Category, Language, MenuItem, Order, StaffTab } from "../types";
import { T } from "../translations";
import { menuLookup, selectionKey, selectionLabels } from "../statsInsights";
import {
  cartItemTotal,
  dayKeysInRange,
  fetchFirstOrderDay,
  fetchPaidOrdersCached,
  formatClock,
  FETCH_MAX_AUTO_RETRIES,
  FETCH_RETRY_DELAY_MS,
  formatDateInput,
  orderTotal,
  orderPaymentBreakdown,
} from "../utils";
import { StaffHeader } from "./StaffHeader";
import { StatsInsights } from "./StatsInsights";

// ช่วงของส่วนวิเคราะห์ — แยกจากตัวเลือกวันที่ของส่วนรายได้
type AnalysisPreset = "today" | "7" | "30" | "all" | "custom";
const ANALYSIS_PRESETS: { value: AnalysisPreset; th: string; en: string }[] = [
  { value: "today", th: "วันนี้", en: "Today" },
  { value: "7", th: "7 วัน", en: "7 days" },
  { value: "30", th: "30 วัน", en: "30 days" },
  { value: "all", th: "ทั้งหมด", en: "All time" },
  { value: "custom", th: "เลือกวัน", en: "Pick dates" },
];

interface StaffStatsProps {
  lang: Language;
  categories: Category[];
  menuItems: MenuItem[]; // เมนูปัจจุบัน (รวมที่ซ่อน) — ชื่อในสถิติใช้ของปัจจุบันตาม id
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

export function StaffStatsScreen({ lang, categories, menuItems, onTabChange, onLogout, onLangToggle }: StaffStatsProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  // เปิดหน้ามาแสดง "วันนี้" ก่อน
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [searchQuery, setSearchQuery] = useState("");

  // ดึงออเดอร์ที่ชำระแล้วเฉพาะช่วงวันที่ที่เลือก (ไม่ใช่ listener ถาวร) — bin ตาม createdAt เหมือนเดิม
  const [paidOrders, setPaidOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false); // true = พึ่ง fail อยู่ระหว่างรอ auto-retry รอบถัดไป
  const [loadFailed, setLoadFailed] = useState(false); // true = auto-retry ครบแล้วยังไม่สำเร็จ รอกดเอง
  const resetRetry = () => { setRetryCount(0); setRetrying(false); setLoadFailed(false); };
  const [reloadKey, setReloadKey] = useState(0); // เพิ่มทีละ 1 = ปุ่มรีเฟรช
  const forceRefreshRef = useRef(false); // true = รอบถัดไปข้าม cache
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    setLoading(true);
    // ผ่าน cache รายวันใน utils — ดึงจริงเฉพาะวันที่ยังไม่มีใน cache (+ วันนี้ถ้า cache เกิน 5 นาที)
    const force = forceRefreshRef.current;
    forceRefreshRef.current = false;
    fetchPaidOrdersCached(startDate, endDate, force, { persist: true })
      .then(({ orders: rows, fetchedAt: at }) => {
        if (cancelled) return;
        setPaidOrders(rows);
        setFetchedAt(at);
        setLoadFailed(false);
      })
      .catch((err) => {
        console.error("fetchPaidOrders (stats) failed", err);
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
  }, [startDate, endDate, retryCount, reloadKey]);

  // ─── ส่วนวิเคราะห์: ช่วงวันที่แยกจากส่วนรายได้ — เริ่มที่ "วันนี้" (เข้าหน้าแล้วไม่ต้องโหลดออเดอร์ทั้งหมด) ───
  // "ทั้งหมด" = ตั้งแต่ออเดอร์แรก ใช้ cache บนเครื่อง (persist) — กดครั้งแรกต่อเครื่องดึงทุกวัน ครั้งต่อไปดึงแค่เมื่อวาน/วันนี้
  const [analysisPreset, setAnalysisPreset] = useState<AnalysisPreset>("today");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [firstDay, setFirstDay] = useState<string | null | undefined>(undefined); // undefined = ยังไม่รู้
  const [analysisOrders, setAnalysisOrders] = useState<Order[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const analysisForceRef = useRef(false); // true = ปุ่มรีเฟรช — ดึงเมื่อวาน/วันนี้ใหม่ + เช็คบิลย้อนหลังทันที
  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return formatDateInput(d); };
  const analysisStart = analysisPreset === "all" ? (firstDay ?? today)
    : analysisPreset === "today" ? today
    : analysisPreset === "30" ? daysAgo(29) : analysisPreset === "7" ? daysAgo(6) : customStart;
  const analysisEnd = analysisPreset === "custom" ? customEnd : today;
  const analysisReady = analysisPreset !== "all" || firstDay !== undefined;

  useEffect(() => {
    if (analysisPreset !== "all" || firstDay !== undefined) return;
    let cancelled = false;
    fetchFirstOrderDay()
      .then((d) => { if (!cancelled) setFirstDay(d); })
      .catch((err) => {
        console.error("fetchFirstOrderDay failed", err);
        if (!cancelled) { setAnalysisFailed(true); setAnalysisLoading(false); }
      });
    return () => { cancelled = true; };
  }, [analysisPreset, firstDay, analysisRetry]);

  useEffect(() => {
    if (!analysisReady) return;
    let cancelled = false;
    setAnalysisLoading(true);
    setAnalysisFailed(false);
    fetchPaidOrdersCached(analysisStart, analysisEnd, reloadKey > 0 && analysisForceRef.current, { persist: true })
      .then(({ orders: rows }) => { if (!cancelled) setAnalysisOrders(rows); })
      .catch((err) => {
        console.error("fetchPaidOrders (analysis) failed", err);
        if (!cancelled) setAnalysisFailed(true);
      })
      .finally(() => { analysisForceRef.current = false; if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisReady, analysisStart, analysisEnd, reloadKey, analysisRetry]);
  const analysisRangeStart = new Date(`${analysisStart}T00:00:00`);
  const analysisRangeEnd = new Date(`${analysisEnd}T23:59:59`);
  const analysisFiltered = analysisOrders.filter((o) => o.timestamp >= analysisRangeStart && o.timestamp <= analysisRangeEnd);
  const analysisDayCount = dayKeysInRange(analysisStart, analysisEnd).length;
  const shortDate = (key: string) =>
    new Date(`${key}T00:00:00`).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { day: "numeric", month: "short", year: "2-digit" });

  const rangeStart = new Date(`${startDate}T00:00:00`);
  const rangeEnd = new Date(`${endDate}T23:59:59`);
  const filtered = paidOrders.filter((o) => o.timestamp >= rangeStart && o.timestamp <= rangeEnd);

  const totalRevenue = filtered.reduce((s, o) => s + orderTotal(o), 0);
  // บิลจ่ายแยก (split) นับเข้าแต่ละฝั่งตามจำนวนจริง — บิลเก่านับทั้งใบเข้าฝั่งเดียวเหมือนเดิม
  const breakdowns = filtered.map(orderPaymentBreakdown);
  const cashRevenue = breakdowns.reduce((s, b) => s + b.cash, 0);
  const transferRevenue = breakdowns.reduce((s, b) => s + b.transfer, 0);
  const orderCount = filtered.length;
  const uniqueGroups = new Set(
    filtered.filter((o) => !o.isTakeaway).map((o) => o.paymentBatchId || o.id)
  ).size;

  // จัดกลุ่มตาม id เมนู + id ตัวเลือก (ไม่ใช่ชื่อตอนสั่ง) — เมนู/ตัวเลือกที่เปลี่ยนชื่อแล้วรวมเป็นแถวเดียว และโชว์ชื่อปัจจุบัน
  // (เมนูที่ถูกลบแล้วใช้ชื่อจากออเดอร์ล่าสุด) — ออเดอร์แบบเดิม (ตัวเลือกในตัว) ได้ id เดียวกับที่แปลงแล้ว จึงรวมกันด้วย
  const menus = menuLookup(menuItems);
  const menuCounts: Record<string, { nameEn: string; nameTh: string; optionLabel: string; qty: number; revenue: number }> = {};
  [...filtered].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).forEach((o) => {
    o.items.forEach((ci) => {
      if (ci.voided) return; // รายการที่ถูกยกเลิก ไม่นับในสถิติ
      const key = `${ci.item.id}|${selectionKey(ci)}`;
      const current = menus.get(ci.item.id);
      const name = current?.name ?? ci.item.name;
      // ชื่อทับด้วยออเดอร์ที่ใหม่กว่าเสมอ (เรียงเก่า→ใหม่แล้ว) — ใช้ตอนเมนู/ตัวเลือกถูกลบไปแล้ว
      menuCounts[key] = {
        qty: menuCounts[key]?.qty ?? 0,
        revenue: menuCounts[key]?.revenue ?? 0,
        nameEn: name.en,
        nameTh: name.th,
        optionLabel: selectionLabels(ci, current, lang).join(", "),
      };
      menuCounts[key].qty += ci.quantity;
      menuCounts[key].revenue += cartItemTotal(ci);
    });
  });
  // ยอดขายรายวันตามช่วงวันที่ที่เลือก — เติมทุกวันให้ครบแม้วันไหนไม่มียอดขาย
  // ถ้าเลือกวันเดียว (startDate === endDate) จะไม่แสดงกราฟ เพราะมีแท่งเดียวไม่มีประโยชน์
  const dailyRevenue: { date: string; label: string; revenue: number }[] | null =
    startDate === endDate
      ? null
      : (() => {
          const revByDay: Record<string, number> = {};
          filtered.forEach((o) => {
            const key = formatDateInput(o.timestamp);
            revByDay[key] = (revByDay[key] || 0) + orderTotal(o);
          });
          const days: { date: string; label: string; revenue: number }[] = [];
          const cursor = new Date(`${startDate}T00:00:00`);
          const last = new Date(`${endDate}T00:00:00`);
          while (cursor <= last) {
            const key = formatDateInput(cursor);
            const dateMonth = cursor.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
              day: "numeric",
              month: "short",
            });
            const weekday = cursor.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
              weekday: "short",
            });
            days.push({
              date: key,
              label: `${dateMonth} (${weekday})`,
              revenue: revByDay[key] || 0,
            });
            cursor.setDate(cursor.getDate() + 1);
          }
          return days;
        })();

  const revenueChartConfig = {
    revenue: {
      label: lang === "en" ? "Revenue" : "ยอดขาย",
      color: "var(--primary)",
    },
  } satisfies ChartConfig;

  const allTopMenus = Object.values(menuCounts).sort((a, b) => b.qty - a.qty);
  // กรองด้วยชื่อเมนู (ทั้งไทย/อังกฤษ, ไม่สนตัวพิมพ์, ค้นหาบางส่วนได้) — กระทบเฉพาะการแสดงผล ไม่แตะยอดขาย/รายได้
  const menuSearch = searchQuery.trim().toLowerCase();
  const topMenus = menuSearch
    ? allTopMenus.filter(
        (m) =>
          m.nameEn.toLowerCase().includes(menuSearch) ||
          m.nameTh.toLowerCase().includes(menuSearch)
      )
    : allTopMenus;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="stats" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-stretch gap-2 mb-5">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => { setStartDate(e.target.value); resetRetry(); }}
            className="flex-1 min-w-0 h-11 bg-card border-2 border-border rounded-xl px-2 sm:px-3 text-xs sm:text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="text-muted-foreground text-sm self-center">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => { setEndDate(e.target.value); resetRetry(); }}
            className="flex-1 min-w-0 h-11 bg-card border-2 border-border rounded-xl px-2 sm:px-3 text-xs sm:text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={() => { setStartDate(today); setEndDate(today); resetRetry(); }}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex items-center justify-center flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
          <button
            onClick={() => { forceRefreshRef.current = true; analysisForceRef.current = true; resetRetry(); setReloadKey((k) => k + 1); }}
            disabled={loading || retrying}
            aria-label={lang === "en" ? "Refresh" : "รีเฟรช"}
            className="h-11 w-11 rounded-xl bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all flex items-center justify-center flex-shrink-0 disabled:opacity-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {fetchedAt !== null && !loading && !retrying && (
          <div className="text-muted-foreground text-xs -mt-3 mb-4">
            {lang === "en" ? "As of" : "ข้อมูล ณ"} {formatClock(new Date(fetchedAt))}
          </div>
        )}

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

        {(loading || retrying) && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-4">
            <Loader2 size={14} className="animate-spin" />
            {retrying || retryCount > 0
              ? (lang === "en" ? "Couldn't load — retrying…" : "โหลดข้อมูลไม่สำเร็จ กำลังลองใหม่…")
              : (lang === "en" ? "Loading…" : "กำลังโหลด…")}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Total Revenue" : "ยอดขายรวม"}</div>
            <div className="font-display font-bold text-2xl text-primary">{t.thb}{totalRevenue}</div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Tables" : "จำนวนโต๊ะ"}</div>
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

        {dailyRevenue && (
          <div className="bg-card rounded-2xl border border-border p-4 mb-6">
            <h3 className="font-semibold text-foreground text-sm mb-3">
              {lang === "en" ? "Daily Revenue" : "ยอดขายรายวัน"}
            </h3>
            <ChartContainer config={revenueChartConfig} className="aspect-[16/9] w-full">
              <BarChart data={dailyRevenue} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
              </BarChart>
            </ChartContainer>
          </div>
        )}

        {/* ─── ส่วนวิเคราะห์ (ช่วงวันที่ของตัวเอง) ─── */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold text-foreground text-sm">{lang === "en" ? "Insights" : "วิเคราะห์"}</h3>
          <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-xl" role="radiogroup">
            {ANALYSIS_PRESETS.map((p) => (
              <button
                key={p.value}
                role="radio"
                aria-checked={analysisPreset === p.value}
                onClick={() => setAnalysisPreset(p.value)}
                className={`min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${analysisPreset === p.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {lang === "en" ? p.en : p.th}
              </button>
            ))}
          </div>
        </div>
        {analysisPreset === "custom" && (
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="flex-1 min-w-0 h-11 bg-card border-2 border-border rounded-xl px-2 sm:px-3 text-xs sm:text-sm text-foreground outline-none focus:border-primary"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={today}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="flex-1 min-w-0 h-11 bg-card border-2 border-border rounded-xl px-2 sm:px-3 text-xs sm:text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        )}
        <div className="text-muted-foreground text-xs mb-3 flex items-center gap-2">
          {analysisLoading && !analysisFailed && <Loader2 size={13} className="animate-spin" />}
          {analysisReady && (lang === "en"
            ? `${shortDate(analysisStart)} – ${shortDate(analysisEnd)} · ${analysisDayCount} days`
            : `${shortDate(analysisStart)} – ${shortDate(analysisEnd)} · ${analysisDayCount} วัน`)}
          {analysisLoading && !analysisFailed && analysisPreset === "all" && (lang === "en"
            ? " · first load on this device can take a while"
            : " · เปิดครั้งแรกบนเครื่องนี้อาจโหลดนานหน่อย")}
        </div>
        {analysisFailed && (
          <div className="flex items-center justify-between gap-2 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5 mb-4">
            <span className="text-destructive text-xs">
              {lang === "en" ? "Couldn't load insights. Check the internet and try again." : "โหลดส่วนวิเคราะห์ไม่สำเร็จ เช็คอินเทอร์เน็ตแล้วลองใหม่"}
            </span>
            <button onClick={() => setAnalysisRetry((n) => n + 1)} className="text-xs font-semibold text-destructive underline flex-shrink-0">
              {lang === "en" ? "Retry" : "ลองอีกครั้ง"}
            </button>
          </div>
        )}
        {!analysisLoading && !analysisFailed && analysisFiltered.length === 0 && (
          <div className="text-center py-6 mb-6 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
            {lang === "en" ? "No data for this period" : "ไม่มีข้อมูลในช่วงนี้"}
          </div>
        )}
        <StatsInsights lang={lang} orders={analysisFiltered} categories={categories} menuItems={menuItems} rangeStart={analysisRangeStart} rangeEnd={analysisRangeEnd} />

        <h3 className="font-semibold text-foreground text-sm mb-3">
          {lang === "en" ? "Items Sold" : "เมนูที่ขายได้"}
        </h3>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={lang === "en" ? "Search menu…" : "ค้นหาเมนู…"}
          className="w-full h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary mb-3"
        />
        {topMenus.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
            {menuSearch
              ? (lang === "en" ? "No menu items match your search" : "ไม่พบเมนูที่ค้นหา")
              : (lang === "en" ? "No data for this period" : "ไม่มีข้อมูลในช่วงนี้")}
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
