// ยอดสรุปรายวัน (src/app/dailyStats.ts + dailyStatsFetch.ts) กับ emulator + firestore.rules ของจริง (ไม่แตะ production)
// หัวใจ: ตัวเลขจากสรุปรายวัน ต้องตรงกับที่หน้าสถิติเดิมคิดจากออเดอร์ทุกตัว (oldStats = โค้ดเดิมของ StaffStatsScreen คัดลอกมาตรงๆ)
// บนข้อมูลชุดเดียวกับพรีวิว (seedData.mjs) ทุกช่วง (วัน/สัปดาห์/เดือน/ปี) ทั้งไทย/อังกฤษ
process.env.TZ = "Asia/Bangkok";
import { readFileSync } from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, Timestamp } from "firebase/firestore";
import { setTestDb } from "./shim/firebase.mjs";
import { seedOrders, CURRENT_MENU } from "./seedData.mjs";
import { buildDaySummary, mergeDaySummaries, summaryBytes } from "../../src/app/dailyStats";
import { fetchSalesDays, resetSalesMemory } from "../../src/app/dailyStatsFetch";
import { menuLookup, selectionKey, selectionLabels } from "../../src/app/statsInsights";
import { periodRange, revenueBuckets } from "../../src/app/statsPeriods";
import { readTotals, resetReadTotals } from "../../src/app/readMeter";
import {
  cartItemTotal, clearStatsDirty, dayAfter, fetchPaidOrders, formatDateInput, invalidatePaidOrdersDay, lastPersistableDay,
  orderPaymentBreakdown, orderTotal,
} from "../../src/app/utils";

const now = new Date();
const daysAgo = (n) => formatDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
const today = daysAgo(0);
const menus = menuLookup(Object.values(CURRENT_MENU));
const seed = seedOrders(Timestamp, now);
const firstDay = daysAgo(420);

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") /* รันจาก out/ หลัง bundle */ },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const ids = Object.keys(seed);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => batch.set(doc(db, "orders", id), seed[id]));
      await batch.commit();
    }
  });
  setTestDb(env.authenticatedContext("staff").firestore());
});
after(async () => { await env?.cleanup(); });

// ─── โค้ดเดิมของหน้าสถิติ (ก่อนมี dailyStats) — ห้ามแก้ให้ตรงกับของใหม่ นี่คือคำตอบที่ถูก ───
function oldStats(paidOrders, salesStart, salesEnd, period, lang) {
  const rangeStart = new Date(`${salesStart}T00:00:00`);
  const rangeEnd = new Date(`${salesEnd}T23:59:59`);
  const filtered = paidOrders.filter((o) => o.timestamp >= rangeStart && o.timestamp <= rangeEnd);
  const totalRevenue = filtered.reduce((s, o) => s + orderTotal(o), 0);
  const breakdowns = filtered.map(orderPaymentBreakdown);
  const cashRevenue = breakdowns.reduce((s, b) => s + b.cash, 0);
  const transferRevenue = breakdowns.reduce((s, b) => s + b.transfer, 0);
  const uniqueGroups = new Set(filtered.filter((o) => !o.isTakeaway).map((o) => o.paymentBatchId || o.id)).size;
  const menuCounts = {};
  [...filtered].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).forEach((o) => {
    o.items.forEach((ci) => {
      if (ci.voided) return;
      const key = `${ci.item.id}|${selectionKey(ci)}`;
      const current = menus.get(ci.item.id);
      const name = current?.name ?? ci.item.name;
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
  let chart;
  if (period !== "day") {
    chart = revenueBuckets(period, filtered.map((o) => ({ at: o.timestamp, amount: orderTotal(o) })), salesStart, salesEnd, lang)
      .map((b) => ({ date: b.key, label: b.label, revenue: b.revenue }));
  } else {
    const revByDay = {};
    filtered.forEach((o) => { const key = formatDateInput(o.timestamp); revByDay[key] = (revByDay[key] || 0) + orderTotal(o); });
    chart = dayChart(salesStart, salesEnd, revByDay);
  }
  return { totalRevenue, cashRevenue, transferRevenue, uniqueGroups, topMenus: Object.values(menuCounts).sort((a, b) => b.qty - a.qty), chart };
}
const dayChart = (start, end, revByDay) => {
  const days = [];
  for (const c = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`); c <= last; c.setDate(c.getDate() + 1)) {
    days.push({ date: formatDateInput(c), revenue: revByDay[formatDateInput(c)] || 0 });
  }
  return days;
};

// ─── ของใหม่ (เหมือนในหน้าสถิติหลังแก้) ───
function newStats(days, salesStart, salesEnd, period, lang) {
  const inRange = days.filter((d) => d.day >= salesStart && d.day <= salesEnd);
  const m = mergeDaySummaries(inRange, menus, lang);
  const chart = period !== "day"
    ? revenueBuckets(period, inRange.map((d) => ({ at: new Date(`${d.day}T00:00:00`), amount: d.revenue })), salesStart, salesEnd, lang)
        .map((b) => ({ date: b.key, label: b.label, revenue: b.revenue }))
    : dayChart(salesStart, salesEnd, m.revenueByDay);
  return {
    totalRevenue: m.totalRevenue, cashRevenue: m.cashRevenue, transferRevenue: m.transferRevenue, uniqueGroups: m.uniqueGroups,
    topMenus: [...m.menuRows].sort((a, b) => b.qty - a.qty), chart,
  };
}

const RANGES = [
  ["day", today, today],
  ["day", daysAgo(1), today],
  ["day", daysAgo(40), daysAgo(3)],
  ["day", daysAgo(16), daysAgo(15)], // บิลข้ามเที่ยงคืน = 1 โต๊ะ
  ["day", daysAgo(12), daysAgo(9)],  // void / กลับบ้าน / ยกเลิก / ลำดับตัวเลือก
  ...["week", "month", "year"].map((p) => { const r = periodRange(p, now, firstDay); return [p, r.start, r.end]; }),
];

async function compareAll(label) {
  for (const [period, start, end] of RANGES) {
    const reference = await fetchPaidOrders(new Date(`${start}T00:00:00`), dayAfter(end));
    // เหมือนหน้าสถิติ: ดึงตั้งแต่วันแรกที่มีออเดอร์ (ปุ่มปีเริ่ม 1 ม.ค.)
    const { days } = await fetchSalesDays(firstDay > start ? firstDay : start, end);
    for (const lang of ["th", "en"]) {
      assert.deepEqual(newStats(days, start, end, period, lang), oldStats(reference, start, end, period, lang), `${label}: ${period} ${start}..${end} ${lang}`);
    }
  }
}

const readSummaryDoc = async (day) => {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), "dailyStats", day))).data(); });
  return data;
};
const allSummaryIds = async () => {
  let ids = [];
  await env.withSecurityRulesDisabled(async (ctx) => { ids = (await getDocs(collection(ctx.firestore(), "dailyStats"))).docs.map((d) => d.id); });
  return ids.sort();
};

test("first open (no summaries yet): numbers equal the old per-order code; past closed days saved, today/yesterday/open day not", async () => {
  resetSalesMemory();
  await compareAll("build");
  const ids = await allSummaryIds();
  assert.ok(ids.length > 300, `saved ${ids.length}`);
  assert.equal(ids.at(-1), lastPersistableDay(now)); // วันล่าสุดที่บันทึก = เก่ากว่าเมื่อวาน
  assert.ok(!ids.includes(today) && !ids.includes(daysAgo(1)));
  assert.ok(!ids.includes(daysAgo(6)), "day with an awaiting-payment order must not be saved");
  const midnight = await readSummaryDoc(daysAgo(16));
  assert.ok(midnight.groups.includes("pb-midnight"));
  assert.equal(midnight.v, 1);
  assert.ok(midnight.builtAt);
});

test("second open on another device: reads summaries, same numbers, orders read only for live days (+ the open day)", async () => {
  resetSalesMemory();
  resetReadTotals();
  const r = periodRange("year", now, firstDay);
  await fetchSalesDays(firstDay, r.end);
  const reads = readTotals();
  // 1 query สรุป = จำนวนวันที่มี doc (วันแรกที่มีออเดอร์ → 2 วันก่อน, ไม่รวมวันค้าง) | ออเดอร์: วันค้าง (6 วันก่อน)
  // + เมื่อวาน/วันนี้ (ใน cache 5 นาทีแล้ว = 0)
  console.log("year view, summaries already built:", JSON.stringify(reads));
  assert.equal(reads.summaries, 420 - 2 + 1 - 1, JSON.stringify(reads));
  assert.ok(reads.orders <= 3, JSON.stringify(reads));
  resetSalesMemory();
  await compareAll("from server");
});

test("doc size: seed days and a heavy synthetic day stay far below 1 MiB", async () => {
  let max = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    (await getDocs(collection(ctx.firestore(), "dailyStats"))).docs.forEach((d) => { max = Math.max(max, summaryBytes(d.data())); });
  });
  // วันหนัก: 400 บิล, 250 เมนู×ตัวเลือกไม่ซ้ำ ชื่อยาว
  const heavy = [];
  for (let i = 0; i < 400; i++) {
    heavy.push({
      id: `h${i}`, status: "paid", tableNumber: "1-1", paymentMethod: "cash", paymentBatchId: `batch-${i}-xxxxxxxxxx`,
      timestamp: new Date(`${daysAgo(5)}T12:00:00`),
      items: [{
        cartId: `c${i}`, quantity: 1, spiceLevel: 0, addEgg: false, addOns: [],
        customSelections: { meat: [`m${i % 5}`], extras: [`e${i % 50}`] },
        item: {
          id: `menu-${i % 250}`, categoryId: "food", price: 99, name: { th: "เมนูชื่อยาวมากๆ สำหรับทดสอบขนาดเอกสาร ".repeat(2), en: "A very long menu name for size test ".repeat(2) },
          customGroups: [
            { id: "meat", nameTh: "เนื้อ", nameEn: "Meat", type: "single", choices: [0, 1, 2, 3, 4].map((k) => ({ id: `m${k}`, labelTh: `เนื้อแบบที่ ${k} ชื่อยาว`, labelEn: `Meat option ${k}`, priceDelta: 0 })) },
            { id: "extras", nameTh: "เพิ่ม", nameEn: "Extras", type: "multi", choices: Array.from({ length: 50 }, (_, k) => ({ id: `e${k}`, labelTh: `ของเพิ่มที่ ${k}`, labelEn: `Extra ${k}`, priceDelta: 5 })) },
          ],
        },
      }],
    });
  }
  const heavyBytes = summaryBytes(buildDaySummary(daysAgo(5), heavy));
  console.log(`dailyStats size: biggest seed day ${max} B, heavy synthetic day (400 bills, 250 rows) ${heavyBytes} B`);
  assert.ok(max < 20_000);
  assert.ok(heavyBytes < 300_000);
});

test("backfilled bill cancelled on an old day: summary marked stale, recomputed on next open (also on a device that never saw the cancel)", async () => {
  const day = daysAgo(4);
  const before = await readSummaryDoc(day);
  assert.ok(before && !before.stale);
  await updateDoc(doc(env.authenticatedContext("staff").firestore(), "orders", "backfill-old"), { status: "cancelled", cancelledAt: new Date() });
  invalidatePaidOrdersDay(day);
  for (let i = 0; i < 50 && !(await readSummaryDoc(day))?.stale; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await readSummaryDoc(day)).stale, true);
  // เครื่องอื่น: ไม่มี dirty ในเครื่อง รู้จากธง stale บน server อย่างเดียว
  resetSalesMemory();
  await clearStatsDirty([day]);
  await compareAll("after backfill cancel");
  const afterDoc = await readSummaryDoc(day);
  assert.equal(afterDoc.stale, undefined);
  assert.equal(afterDoc.revenue, before.revenue - 155);
});

test("old day with an awaiting-payment order: saved once that order is paid", async () => {
  const day = daysAgo(6);
  assert.equal(await readSummaryDoc(day), undefined);
  await updateDoc(doc(env.authenticatedContext("staff").firestore(), "orders", "stuck-open"), { status: "paid", paymentMethod: "cash", paymentBatchId: "pb-stuck" });
  resetSalesMemory();
  await compareAll("after closing the stuck order");
  const saved = await readSummaryDoc(day);
  assert.equal(saved.open, 0);
  assert.ok(saved.groups.includes("pb-stuck"));
});

test("rules: dailyStats is staff-only (read + write), guests get nothing, id must be a date", async () => {
  const guest = env.unauthenticatedContext().firestore();
  const staff = env.authenticatedContext("staff").firestore();
  const day = daysAgo(10);
  await assertFails(getDoc(doc(guest, "dailyStats", day)));
  await assertFails(getDocs(collection(guest, "dailyStats")));
  await assertFails(setDoc(doc(guest, "dailyStats", "2026-01-01"), { revenue: 1 }));
  await assertFails(setDoc(doc(guest, "dailyStats", day), { stale: true }, { merge: true }));
  await assertSucceeds(getDoc(doc(staff, "dailyStats", day)));
  await assertSucceeds(getDocs(collection(staff, "dailyStats")));
  await assertSucceeds(setDoc(doc(staff, "dailyStats", "2026-01-01"), { revenue: 1 }));
  await assertFails(setDoc(doc(staff, "dailyStats", "not-a-day"), { revenue: 1 }));
  await assertFails(setDoc(doc(staff, "dailyStats", "2026-1-1"), { revenue: 1 }));
});
