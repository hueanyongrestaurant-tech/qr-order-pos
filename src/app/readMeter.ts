// นับ Firestore reads ของหน้าสถิติ (query = จำนวน doc ที่ได้ อย่างน้อย 1) — ไว้วัดต้นทุนตอนพรีวิว/ทดสอบเท่านั้น
// ไม่ส่งไปไหน | เปิดดูได้ใน dev server: window.__statsReads (build จริงไม่ผูกกับ window)
export type ReadKind = "orders" | "summaries" | "sync" | "firstDay";
const totals: Record<ReadKind, number> = { orders: 0, summaries: 0, sync: 0, firstDay: 0 };

export function countReads(kind: ReadKind, docs: number): void {
  totals[kind] += Math.max(1, docs);
}
export function readTotals(): Record<ReadKind, number> & { all: number } {
  return { ...totals, all: totals.orders + totals.summaries + totals.sync + totals.firstDay };
}
export function resetReadTotals(): void {
  (Object.keys(totals) as ReadKind[]).forEach((k) => { totals[k] = 0; });
}

if (typeof window !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as Record<string, unknown>).__statsReads = { readTotals, resetReadTotals };
}
