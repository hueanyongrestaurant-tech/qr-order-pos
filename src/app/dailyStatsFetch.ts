// ─── โหลดยอดของแท็บยอดขายเป็นสรุปรายวัน (ดู dailyStats.ts) ───
// วันที่ปิดแล้ว (≤ lastPersistableDay): หน่วยความจำ → บนเครื่อง (IndexedDB) → dailyStats ใน Firestore → ไม่มี/ใช้ไม่ได้
//   = อ่านออเดอร์ของวันนั้นครั้งเดียว คำนวณ แล้วเขียน doc ให้ทุกเครื่องใช้ต่อ (วันที่ยังมีออเดอร์ค้าง = คำนวณใช้ แต่ไม่บันทึก)
// เมื่อวาน + วันนี้: อ่านสดจาก orders ทุกครั้ง (cache 5 นาทีเดิมของ fetchPaidOrdersCached) ไม่บันทึก — โต๊ะที่เปิดก่อน
//   เที่ยงคืนจ่ายหลังเที่ยงคืนได้ เมื่อวานจึงยังเปลี่ยนได้
// สรุปที่อาจเก่า: บิลย้อนหลังที่บันทึก/ยกเลิก (จากเครื่องไหนก็ได้) → syncPaidOrdersDisk ตีว่า dirty → คำนวณวันนั้นใหม่ 1 ครั้ง
//   + เครื่องที่แก้ตีธง stale บน server ให้ด้วย (invalidatePaidOrdersDay)
// ถ้า dailyStats อ่าน/เขียนไม่ได้ (ยังไม่ได้วาง rules) → คำนวณจากออเดอร์ทุกครั้งเหมือนก่อนมีสรุป (ช้ากว่า แต่ตัวเลขเหมือนกัน)

import { db } from "../lib/firebase";
import {
  buildDaySummary, fetchOrdersForDays, isBangkokTime, isUsableSummary, readServerSummaries, writeServerSummary, type DaySummary,
} from "./dailyStats";
import { readDiskSummaries, writeDiskSummaries } from "./paidOrdersDiskCache";
import { countReads } from "./readMeter";
import {
  clearStatsDirty, contiguousRuns, dayKeysInRange, fetchPaidOrdersCached, lastPersistableDay, readStatsDirty, syncPaidOrdersDisk,
} from "./utils";

const memSummaries = new Map<string, DaySummary>();
let serverBlocked = false; // permission-denied ครั้งแรก = ยังไม่มี rules → ไม่ลองอ่าน/เขียน dailyStats อีกในรอบนี้

// ล้างหน่วยความจำ (ใช้ในเทสต์ — จำลองเปิดแอปใหม่)
export function resetSalesMemory(): void {
  memSummaries.clear();
  serverBlocked = false;
}

const isDenied = (err: unknown) => (err as { code?: string })?.code === "permission-denied";

let queue: Promise<unknown> = Promise.resolve();
export function fetchSalesDays(startKey: string, endKey: string, force = false): Promise<{ days: DaySummary[]; fetchedAt: number }> {
  const run = queue.then(() => fetchSalesDaysNow(startKey, endKey, force));
  queue = run.catch(() => {});
  return run;
}

async function fetchSalesDaysNow(startKey: string, endKey: string, force: boolean): Promise<{ days: DaySummary[]; fetchedAt: number }> {
  const all = dayKeysInRange(startKey, endKey);
  const diskUntil = lastPersistableDay(new Date());
  const past = all.filter((k) => k <= diskUntil);
  const live = all.filter((k) => k > diskUntil);
  const out = new Map<string, DaySummary>();

  if (past.length > 0) {
    try {
      await syncPaidOrdersDisk(force);
    } catch (err) {
      console.error("paid orders sync failed — using saved summaries as they are", err);
    }
    const dirty = await readStatsDirty();
    dirty.forEach((k) => memSummaries.delete(k));

    // 1) หน่วยความจำ + บนเครื่อง
    const notInMem = past.filter((k) => !memSummaries.has(k) && !dirty.has(k));
    if (notInMem.length > 0) {
      const disk = await readDiskSummaries<DaySummary>(notInMem[0], notInMem[notInMem.length - 1]);
      disk.forEach((s, k) => { if (!dirty.has(k) && isUsableSummary(s)) memSummaries.set(k, s); });
    }
    past.forEach((k) => { const s = memSummaries.get(k); if (s) out.set(k, s); });

    // 2) Firestore — query เดียวต่อช่วงที่ขาดติดกัน
    let missing = past.filter((k) => !out.has(k));
    const fromServer = new Map<string, DaySummary>();
    if (missing.length > 0 && !serverBlocked) {
      try {
        for (const [first, last] of contiguousRuns(missing)) {
          const { map, reads } = await readServerSummaries(db, first, last);
          countReads("summaries", reads);
          map.forEach((s, k) => { if (!dirty.has(k) && isUsableSummary(s)) fromServer.set(k, s); });
        }
      } catch (err) {
        if (isDenied(err)) serverBlocked = true;
        console.warn("dailyStats read failed — computing from orders", (err as { code?: string })?.code || err);
      }
    }
    fromServer.forEach((s, k) => { out.set(k, s); memSummaries.set(k, s); });
    await writeDiskSummaries(fromServer);

    // 3) ยังขาด = อ่านออเดอร์ของวันนั้น คำนวณ แล้วบันทึก (เฉพาะวันที่ไม่มีออเดอร์ค้าง)
    missing = past.filter((k) => !out.has(k));
    const built = new Map<string, DaySummary>();
    for (const [first, last] of contiguousRuns(missing)) {
      const { orders, reads } = await fetchOrdersForDays(db, first, last);
      countReads("orders", reads);
      dayKeysInRange(first, last).forEach((k) => {
        const s = buildDaySummary(k, orders);
        out.set(k, s);
        if (s.open === 0) built.set(k, s);
      });
    }
    if (built.size > 0) {
      const saved: string[] = [];
      if (!serverBlocked && isBangkokTime()) {
        for (const s of built.values()) {
          try {
            await writeServerSummary(db, s);
            saved.push(s.day);
          } catch (err) {
            if (isDenied(err)) { serverBlocked = true; console.warn("dailyStats write denied — summaries stay on this device only"); break; }
            console.warn("dailyStats write failed", s.day, err);
          }
        }
      }
      built.forEach((s, k) => memSummaries.set(k, s));
      await writeDiskSummaries(built);
      // dirty ล้างได้เมื่อคำนวณใหม่แล้ว — ถ้าเขียน server ไม่ได้ เครื่องอื่นยังรู้เองจากธง stale/บิลย้อนหลัง
      await clearStatsDirty([...built.keys()].filter((k) => dirty.has(k) && (saved.includes(k) || serverBlocked || !isBangkokTime())));
    }
  }

  // เมื่อวาน + วันนี้ สดจาก orders
  let fetchedAt = Date.now();
  if (live.length > 0) {
    const res = await fetchPaidOrdersCached(live[0], live[live.length - 1], force);
    fetchedAt = res.fetchedAt;
    live.forEach((k) => out.set(k, buildDaySummary(k, res.orders)));
  }

  return { days: all.map((k) => out.get(k)!).filter(Boolean), fetchedAt };
}
