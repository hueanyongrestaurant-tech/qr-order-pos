import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import type { CartItem, Language, Order, StaffTab } from "../types";
import { T } from "../translations";
import { ADD_ONS } from "../constants";
import {
  cartItemTotal,
  dayAfter,
  fetchPaidOrders,
  FETCH_MAX_AUTO_RETRIES,
  FETCH_RETRY_DELAY_MS,
  formatDateInput,
  orderTotal,
} from "../utils";
import { StaffHeader } from "./StaffHeader";

interface StaffStatsProps {
  lang: Language;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

export function StaffStatsScreen({ lang, onTabChange, onLogout, onLangToggle }: StaffStatsProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  // เริ่มต้นเป็นช่วง 7 วันล่าสุด (ย้อนหลัง 6 วัน + วันนี้) เพื่อให้กราฟยอดขายรายวันแสดงทันทีที่เข้าหน้า
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return formatDateInput(d);
  })();
  const [startDate, setStartDate] = useState(sevenDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [searchQuery, setSearchQuery] = useState("");

  // ดึงออเดอร์ที่ชำระแล้วเฉพาะช่วงวันที่ที่เลือก (ไม่ใช่ listener ถาวร) — bin ตาม createdAt เหมือนเดิม
  const [paidOrders, setPaidOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false); // true = พึ่ง fail อยู่ระหว่างรอ auto-retry รอบถัดไป
  const [loadFailed, setLoadFailed] = useState(false); // true = auto-retry ครบแล้วยังไม่สำเร็จ รอกดเอง
  const resetRetry = () => { setRetryCount(0); setRetrying(false); setLoadFailed(false); };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    setLoading(true);
    fetchPaidOrders(new Date(`${startDate}T00:00:00`), dayAfter(endDate))
      .then((rows) => {
        if (cancelled) return;
        setPaidOrders(rows);
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
  }, [startDate, endDate, retryCount]);

  const rangeStart = new Date(`${startDate}T00:00:00`);
  const rangeEnd = new Date(`${endDate}T23:59:59`);
  const filtered = paidOrders.filter((o) => o.timestamp >= rangeStart && o.timestamp <= rangeEnd);

  const totalRevenue = filtered.reduce((s, o) => s + orderTotal(o), 0);
  const cashRevenue = filtered.filter((o) => o.paymentMethod === "cash").reduce((s, o) => s + orderTotal(o), 0);
  const transferRevenue = filtered.filter((o) => o.paymentMethod === "transfer").reduce((s, o) => s + orderTotal(o), 0);
  const orderCount = filtered.length;
  const uniqueGroups = new Set(
    filtered.filter((o) => !o.isTakeaway).map((o) => o.paymentBatchId || o.id)
  ).size;

  function optionKey(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(ci.meat);
    if (ci.portion === "special") parts.push("special");
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(`spice${ci.spiceLevel}`);
    if (ci.addEgg) parts.push("egg");
    (ci.addOns || []).forEach((id) => parts.push(id));
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      selected.forEach((cid) => parts.push(cid));
    });
    return parts.join(",");
  }

  function optionLabel(ci: CartItem, lang: Language): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(T[lang].meats[ci.meat]);
    if (ci.portion === "special") parts.push(T[lang].special);
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(T[lang].eggAdded);
    (ci.addOns || []).forEach((id) => {
      const addon = ADD_ONS.find((a) => a.id === id);
      if (addon) parts.push(lang === "en" ? addon.label.en : addon.label.th);
    });
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(", ");
  }

  const menuCounts: Record<string, { nameEn: string; nameTh: string; optionLabel: string; qty: number; revenue: number }> = {};
  filtered.forEach((o) => {
    o.items.forEach((ci) => {
      if (ci.voided) return; // รายการที่ถูกยกเลิก ไม่นับในสถิติ
      const key = `${ci.item.id}|${optionKey(ci)}`;
      if (!menuCounts[key]) {
        menuCounts[key] = {
          nameEn: ci.item.name.en,
          nameTh: ci.item.name.th,
          optionLabel: optionLabel(ci, lang),
          qty: 0,
          revenue: 0,
        };
      }
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
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="text-muted-foreground text-sm self-center">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => { setEndDate(e.target.value); resetRetry(); }}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={() => { setStartDate(today); setEndDate(today); resetRetry(); }}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex items-center justify-center flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
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
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Total Revenue" : "รายได้รวม"}</div>
            <div className="font-display font-bold text-2xl text-primary">{t.thb}{totalRevenue}</div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="text-muted-foreground text-xs mb-1">{lang === "en" ? "Customer Groups" : "จำนวนกลุ่มลูกค้า"}</div>
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

        <h3 className="font-semibold text-foreground text-sm mb-3">
          {lang === "en" ? "Items Ordered" : "รายการที่ขายทั้งหมด"}
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
