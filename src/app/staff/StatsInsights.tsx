import { useState } from "react";
import { Clock, Crown, Timer, Utensils } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import type { Category, Language, MenuItem, Order } from "../types";
import { T } from "../translations";
import { ZONES, isKnownTable, tableButtonLabel, tableTitle, zoneTitle } from "../tables";
import { billsPerHour, counterCategoryIds, formatMinutes, groupBills, menuLookup, popularChoices, rangeDayCount, seatingSummary, serveSummary, SERVE_MAX_MINUTES, tableStats, topHours, topItems } from "../statsInsights";

// ─── ส่วนสถิติใต้รายได้: การ์ดสรุป / โต๊ะแยกตามชั้น / ช่วงเวลาที่คนเยอะสุด ─────────────
// คิดจากออเดอร์ที่จ่ายแล้วชุดเดียวกับส่วนรายได้ (ไม่อ่าน Firestore เพิ่ม) — ดู statsInsights.ts
// ตัวเลขเขียนให้อ่านตรงๆ ทุกจุด แถบ/เส้นเป็นแค่ตัวช่วยเทียบ ไม่ต้องตีความสี

// การ์ดเวลา (เวลานั่ง + สั่ง → เสิร์ฟ) แสดงค่าไหน — สลับทีเดียวทุกการ์ด จำไว้ในเครื่องนี้ (localStorage)
type TimeMode = "avg" | "min" | "max";
const TIME_MODE_KEY = "statsTimeMode";
const TIME_MODES: { value: TimeMode; th: string; en: string }[] = [
  { value: "avg", th: "เฉลี่ย", en: "Avg" },
  { value: "min", th: "เร็วสุด", en: "Fastest" },
  { value: "max", th: "ช้าสุด", en: "Slowest" },
];
function readTimeMode(): TimeMode {
  try {
    const v = localStorage.getItem(TIME_MODE_KEY);
    return v === "min" || v === "max" ? v : "avg";
  } catch {
    return "avg";
  }
}

function StatCard({ icon, label, value, sub, detail }: { icon: React.ReactNode; label: string; value: string; sub?: string; detail?: string[] }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1.5">
        <span className="text-primary">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display font-bold text-xl text-foreground leading-tight line-clamp-2 break-words">{value}</div>
      {sub && <div className="text-muted-foreground text-[11px] mt-1 truncate">{sub}</div>}
      {detail?.map((d) => <div key={d} className="text-muted-foreground text-[11px] leading-snug mt-0.5">{d}</div>)}
    </div>
  );
}

export function StatsInsights({ lang, orders, categories, menuItems, rangeStart, rangeEnd }: {
  lang: Language;
  orders: Order[];
  categories: Category[]; // ใช้ตัดหมวดเครื่องดื่ม/ของฝากออกจากการ์ดเมนูขายดี
  menuItems: MenuItem[];  // เมนูปัจจุบัน — ชื่อ/ตัวเลือกในการ์ดเมนูขายดีใช้ของปัจจุบัน (ดู topItems)
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const t = T[lang];
  const en = lang === "en";
  const [timeMode, setTimeModeState] = useState<TimeMode>(readTimeMode);
  const setTimeMode = (m: TimeMode) => {
    setTimeModeState(m);
    try { localStorage.setItem(TIME_MODE_KEY, m); } catch { /* ใช้ไม่ได้ก็แค่ไม่จำ */ }
  };
  const bills = groupBills(orders);
  if (bills.length === 0) return null;

  const seating = seatingSummary(bills);
  const tables = tableStats(bills, "bills");
  const topTable = tables[0];
  const takeaway = bills.filter((b) => b.isTakeaway);
  const dineInCount = bills.length - takeaway.length;
  const menus = menuLookup(menuItems);
  const items = topItems(orders, 1, counterCategoryIds(categories), menus);
  // ตัวเลือกยอดนิยมของเมนูอันดับ 1 — บรรทัดละกลุ่ม เช่น "ไก่ 45% · หมู 35% · เนื้อ 20%"
  const bestChoices = items[0]
    ? popularChoices(orders, items[0].id, menus).map((g) =>
      g.choices.map((c) => `${en ? c.labelEn : c.labelTh} ${c.pct}%`).join(" · "))
    : [];
  const days = rangeDayCount(rangeStart, rangeEnd);
  const perHour = billsPerHour(bills, days);
  const peaks = topHours(perHour, 3);
  // วันเดียว = จำนวนบิลจริง | หลายวัน = เฉลี่ยต่อวัน
  const perDayLabel = (h: { total: number; avg: number }) =>
    days === 1 ? (en ? `${h.total} bills` : `${h.total} บิล`) : (en ? `avg ${h.avg} bills/day` : `เฉลี่ย ${h.avg} บิล/วัน`);
  const hourConfig = {
    value: { label: days === 1 ? (en ? "Bills" : "บิล") : (en ? "Bills per day (avg)" : "บิลเฉลี่ยต่อวัน"), color: "var(--primary)" },
  } satisfies ChartConfig;
  const shortDate = (d: Date) => d.toLocaleDateString(en ? "en-US" : "th-TH", { day: "numeric", month: "short" });
  const money = (v: number) => (v >= 10000 ? `${t.thb}${(v / 1000).toFixed(1)}k` : `${t.thb}${v.toLocaleString()}`);
  const itemName = (m: { nameTh: string; nameEn: string }) => (en ? m.nameEn || m.nameTh : m.nameTh);

  // โต๊ะแยกตามชั้น: แถวเฉพาะโต๊ะที่มีบิล เรียงจากบิลมากไปน้อย — โต๊ะที่ไม่มีบิลรวมไว้บรรทัดเดียวใต้ตาราง
  const byTable = new Map(tables.map((r) => [r.table, r]));
  const dineInRevenue = tables.reduce((s, r) => s + r.revenue, 0);
  const floors = ZONES.map((z) => {
    const label = new Map(z.tables.map((tb) => [tb.id, tableButtonLabel(tb, lang)]));
    const rows = z.tables.map((tb) => byTable.get(tb.id) ?? { table: tb.id, bills: 0, revenue: 0 })
      .sort((a, b) => b.bills - a.bills || a.revenue - b.revenue || a.table.localeCompare(b.table, undefined, { numeric: true }));
    return {
      floor: z.zone,
      name: zoneTitle(z, lang),
      label,
      rows: rows.filter((r) => r.bills > 0),
      unused: rows.filter((r) => r.bills === 0).sort((a, b) => a.table.localeCompare(b.table, undefined, { numeric: true })).map((r) => label.get(r.table) ?? r.table),
      bills: rows.reduce((s, r) => s + r.bills, 0),
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      max: Math.max(1, ...rows.map((r) => r.bills)),
    };
  });
  // โต๊ะที่ไม่อยู่ในผัง (เลขโต๊ะเก่า/รูปแบบอื่น) — ยังนับในยอดรวม แค่ไม่มีแถวของตัวเอง
  const unmappedBills = tables.filter((r) => !isKnownTable(r.table)).reduce((s, r) => s + r.bills, 0);

  // เวลานั่ง: ข้อความเล็กบรรทัดเดียว เฉพาะตอนข้อมูลยังเก็บไม่ครบช่วง
  // ค่าตามปุ่ม เฉลี่ย | เร็วสุด | ช้าสุด (ข้อมูลชุดเดียวกัน) — "<1 นาที" แทน "0 นาที"
  const mins = (m: number | null) => m === null ? "–" : m < 1 ? (en ? "<1 min" : "<1 นาที") : formatMinutes(m, lang);
  const pick = (c: { avgMinutes: number | null; minMinutes: number | null; maxMinutes: number | null }) =>
    mins(timeMode === "min" ? c.minMinutes : timeMode === "max" ? c.maxMinutes : c.avgMinutes);
  const modeLabel = TIME_MODES.find((m) => m.value === timeMode)!;

  const seatingSub = seating.trackedSince && seating.missingPaidAt > 0
    ? (en ? `since ${shortDate(seating.trackedSince)}` : `เก็บตั้งแต่ ${shortDate(seating.trackedSince)}`)
    : seating.avgMinutes === null && dineInCount > 0
      ? (en ? "no data yet" : "ยังไม่มีข้อมูล")
      : undefined;

  // สั่ง → เสิร์ฟ เฉลี่ยต่อชิ้น (ดู serveSummary) — "<1 นาที" แทน "0 นาที"
  const serve = serveSummary(orders, categories, menus);
  const serveRows = [
    { key: "food", label: en ? "Food" : "อาหาร", cells: serve.food },
    { key: "drink", label: en ? "Drinks" : "เครื่องดื่ม", cells: serve.drink },
  ];
  const serveHasData = serveRows.some((r) => r.cells.dineIn.pieces + r.cells.takeaway.pieces > 0);
  const maxHours = SERVE_MAX_MINUTES / 60;

  return (
    <div className="space-y-6 mb-6">
      {/* ─── เฉลี่ย | เร็วสุด | ช้าสุด — ใช้กับการ์ดเวลาทุกใบ ─── */}
      <div className="flex rounded-full bg-muted p-0.5 w-fit" role="radiogroup">
        {TIME_MODES.map((m) => (
          <button
            key={m.value}
            role="radio"
            aria-checked={timeMode === m.value}
            onClick={() => setTimeMode(m.value)}
            className={`text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${timeMode === m.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {en ? m.en : m.th}
          </button>
        ))}
      </div>

      {/* ─── การ์ดสรุป ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-1 grid">
        <StatCard
          icon={<Clock size={14} />}
          label={en ? `Time at table (${modeLabel.en.toLowerCase()})` : `เวลานั่ง (${modeLabel.th})`}
          value={pick(seating)}
          sub={seatingSub}
        />
        </div>
        <StatCard
          icon={<Utensils size={14} />}
          label={en ? "Busiest table" : "โต๊ะยอดนิยม"}
          value={topTable ? tableTitle(topTable.table, lang) : "–"}
          sub={topTable ? (en ? `${topTable.bills} bills` : `${topTable.bills} บิล`) : undefined}
        />
        <StatCard
          icon={<Crown size={14} />}
          label={en ? "Best seller (food)" : "เมนูขายดีอันดับ 1"}
          value={items[0] ? itemName(items[0]) : "–"}
          sub={items[0] ? (en ? `${items[0].qty} sold` : `ขายได้ ${items[0].qty}`) : undefined}
          detail={bestChoices}
        />
      </div>

      {/* ─── สั่ง → เสิร์ฟ ─── */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <h3 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-1.5">
          <Timer size={14} className="text-primary" />
          {en ? `Order → served (${modeLabel.en.toLowerCase()}, per piece)` : `สั่ง → เสิร์ฟ (${modeLabel.th} ต่อชิ้น)`}
        </h3>
        {serveHasData ? (
          <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-2 items-center">
            <span />
            <span className="text-[11px] text-muted-foreground">{en ? "Dine-in" : "ทานที่ร้าน"}</span>
            <span className="text-[11px] text-muted-foreground">{en ? "Takeaway" : "กลับบ้าน"}</span>
            {serveRows.map((r) => (
              <div key={r.key} className="contents">
                <span className="text-sm font-semibold text-foreground">{r.label}</span>
                {[r.cells.dineIn, r.cells.takeaway].map((c, i) => (
                  <div key={i} className="rounded-xl bg-background border border-border px-3 py-2 min-w-0">
                    <div className="font-display font-bold text-lg text-foreground leading-tight tabular-nums whitespace-nowrap">{pick(c)}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">{c.pieces > 0 ? (en ? `${c.pieces} pcs` : `${c.pieces} ชิ้น`) : (en ? "no data" : "ไม่มีข้อมูล")}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {en ? "No serve times in this period yet — recorded from this app version on." : "ยังไม่มีเวลาเสิร์ฟในช่วงนี้ — เริ่มเก็บตั้งแต่แอปเวอร์ชันนี้"}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-3 leading-snug">
          {en
            ? `Not counted: voided items · backfilled bills · souvenirs · served before ordering or after ${maxHours} h`
            : `ไม่นับ: รายการที่ยกเลิก · บิลย้อนหลัง · ของฝาก · เสิร์ฟก่อนสั่ง/นานเกิน ${maxHours} ชม.`}
          {serve.outliers > 0 && (en ? ` (${serve.outliers} pcs dropped)` : ` (ตัดไป ${serve.outliers} ชิ้น)`)}
          {/* ข้อมูลไม่ครบ: เริ่มเก็บกลางช่วง = บอกวันที่เริ่ม | ไม่งั้นบอกจำนวนชิ้นที่ไม่มีเวลา (เช่นแท็บเล็ตที่ยังเป็นแอปเก่า) */}
          {serveHasData && serve.missing > 0 && serve.trackedSince && (serve.trackedSince > rangeStart && rangeDayCount(rangeStart, serve.trackedSince) > 1
            ? (en ? ` · recorded since ${shortDate(serve.trackedSince)}` : ` · เริ่มเก็บ ${shortDate(serve.trackedSince)}`)
            : (en ? ` · ${serve.missing} pcs without a time` : ` · ไม่มีเวลา ${serve.missing} ชิ้น`))}
        </p>
      </div>

      {/* ─── โต๊ะแยกตามชั้น ─── */}
      {dineInCount > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <h3 className="font-semibold text-foreground text-sm mb-3">{en ? "Tables by zone" : "โต๊ะแยกตามโซน"}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {floors.map((f) => (
              <div key={f.floor} className="rounded-xl bg-background border border-border p-3">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <span className="font-semibold text-foreground">{f.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {f.bills} {en ? "bills" : "บิล"} · {money(f.revenue)} · {Math.round((f.bills / dineInCount) * 100)}%
                  </span>
                </div>
                {f.rows.length > 0 && <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm">
                  <span className="text-[11px] text-muted-foreground">{en ? "Table" : "โต๊ะ"}</span>
                  <span />
                  <span className="text-[11px] text-muted-foreground text-right">{en ? "Bills" : "บิล"}</span>
                  <span className="text-[11px] text-muted-foreground text-right">{en ? "Revenue" : "ยอดเงิน"}</span>
                  {f.rows.map((r) => (
                    <div key={r.table} className="contents">
                      <span className="font-semibold text-foreground tabular-nums">{f.label.get(r.table) ?? r.table}</span>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(r.bills / f.max) * 100}%` }} />
                      </div>
                      <span className="text-right tabular-nums font-semibold text-foreground">{r.bills}</span>
                      <span className="text-right tabular-nums text-muted-foreground">{money(r.revenue)}</span>
                    </div>
                  ))}
                </div>}
                {f.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{en ? "No bills yet" : "ยังไม่มีบิล"}</p>
                ) : f.unused.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2">{en ? `No bills: ${f.unused.join(", ")}` : `ไม่มีบิล: ${f.unused.join(", ")}`}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            {en ? `Dine-in total ${money(dineInRevenue)}` : `ยอดรวมทานที่ร้าน ${money(dineInRevenue)}`}
            {takeaway.length > 0 && (en
              ? ` · Takeaway ${takeaway.length} bills · ${money(takeaway.reduce((s, b) => s + b.revenue, 0))}`
              : ` · กลับบ้าน ${takeaway.length} บิล · ${money(takeaway.reduce((s, b) => s + b.revenue, 0))}`)}
            {unmappedBills > 0 && (en ? ` · ${unmappedBills} bills at other tables` : ` · โต๊ะอื่นนอกผัง ${unmappedBills} บิล`)}
          </p>
        </div>
      )}

      {/* ─── ช่วงเวลาที่คนเยอะสุด ─── */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <h3 className="font-semibold text-foreground text-sm mb-3">{en ? "Busiest times" : "ช่วงที่คนเยอะสุด"}</h3>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {peaks.map((h, i) => (
            <div key={h.hour} className={`rounded-xl p-2.5 sm:p-3 border min-w-0 ${i === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground"}`}>
              <div className={`text-[11px] font-semibold ${i === 0 ? "opacity-90" : "text-muted-foreground"}`}>{en ? `#${i + 1}` : `อันดับ ${i + 1}`}</div>
              <div className="font-display font-bold text-sm sm:text-lg leading-tight mt-0.5 tabular-nums whitespace-nowrap">{h.hour}:00–{h.hour + 1}:00</div>
              <div className={`text-[11px] sm:text-xs mt-1 whitespace-nowrap ${i === 0 ? "opacity-90" : "text-muted-foreground"}`}>{perDayLabel(h)}</div>
            </div>
          ))}
        </div>
        {perHour.length > 1 && (
          <>
            <div className="text-xs text-muted-foreground mb-1">
              {days === 1 ? (en ? "Through the day (bills)" : "ทั้งวัน (จำนวนบิล)") : (en ? "Through the day (bills per day, avg)" : "ทั้งวัน (บิลเฉลี่ยต่อวัน)")}
            </div>
            <ChartContainer config={hourConfig} className="aspect-[3/1] sm:aspect-[4/1] w-full">
              <AreaChart data={perHour.map((h) => ({ label: `${h.hour}:00`, value: days === 1 ? h.total : h.avg }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} interval="preserveStartEnd" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="var(--color-value)" fillOpacity={0.15} />
              </AreaChart>
            </ChartContainer>
          </>
        )}
      </div>
    </div>
  );
}
