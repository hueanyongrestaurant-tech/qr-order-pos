import { useState } from "react";
import { Clock, Crown, Receipt, Utensils } from "lucide-react";
import type { Language, MenuItem, Order } from "../types";
import { T } from "../translations";
import { TABLE_FLOORS } from "../constants";
import { resolvePhoto } from "../utils";
import { billsHeatmap, formatMinutes, groupBills, parseTableNumber, seatingSummary, tableStats, topItems } from "../statsInsights";

// ─── ส่วนสถิติใต้รายได้: การ์ดสรุป / ผังโต๊ะระบายสี / heatmap วัน×ชั่วโมง / เมนูขายดี ─────────────
// คิดจากออเดอร์ที่จ่ายแล้วชุดเดียวกับส่วนรายได้ (ไม่อ่าน Firestore เพิ่ม) — ดู statsInsights.ts
// สีความเข้ม = primary ผสมกับพื้นการ์ด (เฉดเดียว อ่อน → เข้ม) ใช้ได้ทั้งธีมสว่าง/มืด

// ความเข้ม 0..1 → สีพื้นช่อง (0 = ไม่มีข้อมูล ใช้พื้นจางแยกให้เห็นว่าว่าง)
function heat(ratio: number): { background: string; color: string } {
  if (ratio <= 0) return { background: "color-mix(in srgb, var(--muted) 45%, var(--card))", color: "var(--muted-foreground)" };
  const pct = Math.round(14 + ratio * 78);
  return {
    background: `color-mix(in srgb, var(--primary) ${pct}%, var(--card))`,
    color: pct >= 55 ? "var(--primary-foreground)" : "var(--foreground)",
  };
}

function HeatLegend({ lang }: { lang: Language }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>{lang === "en" ? "Less" : "น้อย"}</span>
      <div className="flex gap-[2px]">
        {[0.08, 0.3, 0.55, 0.8, 1].map((r) => (
          <span key={r} className="w-4 h-3 rounded-[3px]" style={{ background: heat(r).background }} />
        ))}
      </div>
      <span>{lang === "en" ? "More" : "มาก"}</span>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1.5">
        <span className="text-primary">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display font-bold text-xl text-foreground leading-tight line-clamp-2 break-words">{value}</div>
      {sub && <div className="text-muted-foreground text-[11px] mt-1 truncate">{sub}</div>}
    </div>
  );
}

export function StatsInsights({ lang, orders, rangeStart, rangeEnd, menuItems }: {
  lang: Language;
  orders: Order[];
  rangeStart: Date;
  rangeEnd: Date;
  menuItems: MenuItem[]; // ใช้แค่หารูปเมนู (ออเดอร์ไม่เก็บรูป)
}) {
  const t = T[lang];
  const en = lang === "en";
  const [tableMetric, setTableMetric] = useState<"bills" | "revenue">("bills");

  const bills = groupBills(orders);
  if (bills.length === 0) return null;

  const seating = seatingSummary(bills);
  const tables = tableStats(bills, tableMetric);
  const topTable = tableStats(bills, "bills", 1)[0];
  const takeaway = bills.filter((b) => b.isTakeaway);
  const dineInCount = bills.length - takeaway.length;
  const items = topItems(orders, 10);
  const totalQty = topItems(orders, Infinity).reduce((s, m) => s + m.qty, 0);
  const map = billsHeatmap(bills, rangeStart, rangeEnd);
  const weekdayShort = en ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const weekdayLong = en
    ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    : ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const shortDate = (d: Date) => d.toLocaleDateString(en ? "en-US" : "th-TH", { day: "numeric", month: "short" });
  const money = (v: number) => (v >= 10000 ? `${t.thb}${(v / 1000).toFixed(1)}k` : `${t.thb}${v.toLocaleString()}`);
  const itemName = (m: { nameTh: string; nameEn: string }) => (en ? m.nameEn || m.nameTh : m.nameTh);
  const photoOf = (id: string) => menuItems.find((m) => m.id === id)?.photo || "";

  // ผังโต๊ะ: ค่าตามตัวเลือก (บิล/ยอดเงิน) ของทุกโต๊ะในผัง
  const byTable = new Map(tables.map((r) => [r.table, r]));
  const tableMax = Math.max(1, ...tables.map((r) => r[tableMetric]));

  // เวลานั่ง: ข้อความเล็กบรรทัดเดียว เฉพาะตอนข้อมูลยังเก็บไม่ครบช่วง
  const seatingSub = seating.trackedSince && seating.missingPaidAt > 0
    ? (en ? `since ${shortDate(seating.trackedSince)}` : `เก็บตั้งแต่ ${shortDate(seating.trackedSince)}`)
    : seating.avgMinutes === null && dineInCount > 0
      ? (en ? "no data yet" : "ยังไม่มีข้อมูล")
      : undefined;

  return (
    <div className="space-y-6 mb-6">
      {/* ─── การ์ดสรุป ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Clock size={14} />}
          label={en ? "Avg. time at table" : "เวลานั่งเฉลี่ย"}
          value={seating.avgMinutes !== null ? formatMinutes(seating.avgMinutes, lang) : "–"}
          sub={seatingSub}
        />
        <StatCard
          icon={<Receipt size={14} />}
          label={en ? "Bills" : "จำนวนบิล"}
          value={`${bills.length}`}
          sub={en ? `Dine-in ${dineInCount} · Takeaway ${takeaway.length}` : `ทานที่ร้าน ${dineInCount} · กลับบ้าน ${takeaway.length}`}
        />
        <StatCard
          icon={<Utensils size={14} />}
          label={en ? "Busiest table" : "โต๊ะยอดนิยม"}
          value={topTable ? `${t.tableLabel} ${topTable.table}` : "–"}
          sub={topTable ? (en ? `${topTable.bills} bills` : `${topTable.bills} บิล`) : undefined}
        />
        <StatCard
          icon={<Crown size={14} />}
          label={en ? "Best seller" : "เมนูขายดีอันดับ 1"}
          value={items[0] ? itemName(items[0]) : "–"}
          sub={items[0] ? (en ? `${items[0].qty} sold` : `ขายได้ ${items[0].qty}`) : undefined}
        />
      </div>

      {/* ─── ผังโต๊ะ ─── */}
      {dineInCount > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h3 className="font-semibold text-foreground text-sm">{en ? "Table map" : "ผังโต๊ะ"}</h3>
            <div className="flex rounded-full bg-muted p-0.5" role="radiogroup">
              {(["bills", "revenue"] as const).map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={tableMetric === k}
                  onClick={() => setTableMetric(k)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${tableMetric === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {k === "bills" ? (en ? "Bills" : "จำนวนบิล") : (en ? "Revenue" : "ยอดเงิน")}
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
            {TABLE_FLOORS.map((f) => (
              <div key={f.floor}>
                <div className="text-xs font-semibold text-muted-foreground mb-2">{en ? `Floor ${f.floor}` : `ชั้น ${f.floor}`}</div>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: f.tables }, (_, i) => i + 1).map((n) => {
                    const stat = byTable.get(`${f.floor}-${n}`);
                    const v = stat ? stat[tableMetric] : 0;
                    const style = heat(v / tableMax);
                    return (
                      <div
                        key={n}
                        title={stat ? `${t.tableLabel} ${f.floor}-${n}: ${stat.bills} ${en ? "bills" : "บิล"} · ${t.thb}${stat.revenue.toLocaleString()}` : undefined}
                        className="aspect-square rounded-2xl flex flex-col items-center justify-center"
                        style={style}
                      >
                        <span className="font-display font-bold text-lg leading-none">{n}</span>
                        <span className="text-[10px] mt-1 tabular-nums opacity-90">
                          {v > 0 ? (tableMetric === "bills" ? `${v} ${en ? "bills" : "บิล"}` : money(v)) : "–"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
            <HeatLegend lang={lang} />
            {takeaway.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {en ? "Takeaway" : "กลับบ้าน"} · {takeaway.length} {en ? "bills" : "บิล"} · {money(takeaway.reduce((s, b) => s + b.revenue, 0))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ─── heatmap วัน × ชั่วโมง ─── */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <h3 className="font-semibold text-foreground text-sm">{en ? "Busy times" : "ช่วงเวลาคนเยอะ"}</h3>
        {map.peak && (
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            {en ? "Busiest: " : "คนเยอะสุด: "}
            <span className="font-semibold text-foreground">
              {map.weekdays.length > 1 ? `${weekdayLong[map.peak.weekday]} ` : ""}{map.peak.hour}:00–{map.peak.hour + 1}:00
            </span>
            {` · ${map.peak.count} ${en ? "bills" : "บิล"}`}
          </p>
        )}
        <div
          className="grid gap-[3px] items-center"
          // ช่องกว้างสุด ~4rem — ช่วงที่มีไม่กี่ชั่วโมง (เช่นวันนี้) จะไม่ยืดเป็นแถบยาวเต็มจอ
          style={{ gridTemplateColumns: `2.25rem repeat(${map.hours.length}, minmax(0, 1fr))`, maxWidth: `calc(2.25rem + ${map.hours.length} * 4rem)` }}
        >
          <span />
          {map.hours.map((h) => (
            <span key={h} className="text-[10px] text-muted-foreground text-center tabular-nums">{h}</span>
          ))}
          {map.weekdays.map((w) => (
            <div key={w} className="contents">
              <span className="text-[11px] text-muted-foreground pr-1">{weekdayShort[w]}</span>
              {map.hours.map((h) => {
                const c = map.counts[`${w}-${h}`] ?? 0;
                const style = heat(c / Math.max(1, map.max));
                return (
                  <div
                    key={h}
                    title={`${weekdayLong[w]} ${h}:00 · ${c} ${en ? "bills" : "บิล"}`}
                    className="h-7 sm:h-9 rounded-md flex items-center justify-center text-[10px] font-semibold tabular-nums"
                    style={style}
                  >
                    <span className="hidden sm:inline">{c > 0 ? c : ""}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <HeatLegend lang={lang} />
          <span className="text-[11px] text-muted-foreground">{en ? "Bills by first-order hour" : "นับบิลตามชั่วโมงที่เริ่มสั่ง"}</span>
        </div>
      </div>

      {/* ─── เมนูขายดี ─── */}
      {items.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <h3 className="font-semibold text-foreground text-sm mb-3">{en ? "Best sellers" : "เมนูขายดี"}</h3>
          <ol className="space-y-3">
            {items.map((m, i) => {
              const photo = photoOf(m.id);
              const share = totalQty > 0 ? Math.round((m.qty / totalQty) * 100) : 0;
              return (
                <li key={m.id} className="flex items-center gap-3">
                  <span className={`w-5 text-center font-display font-bold text-sm flex-shrink-0 ${i < 3 ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>
                  {photo ? (
                    <img src={resolvePhoto(photo, 96, 96)} alt="" className="w-11 h-11 rounded-xl object-cover bg-muted flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
                      <Utensils size={16} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{itemName(m)}</span>
                      <span className="text-sm font-semibold text-foreground tabular-nums flex-shrink-0">{m.qty}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(m.qty / items[0].qty) * 100}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-20 text-right flex-shrink-0">
                        {share}% · {money(m.revenue)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
