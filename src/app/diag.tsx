// ─── TEMP DIAGNOSTICS (หาสาเหตุ "หมุนโหลดนานหลังเปิดทิ้งไว้") ─────────────────────
// ชั่วคราวเท่านั้น — หาสาเหตุเจอแล้วให้ลบไฟล์นี้ทิ้ง แล้ว grep "diag" ลบจุดเรียกใช้ทั้งหมด
// (main.tsx, App.tsx, utils.ts, StaffActivityScreen.tsx)
//
// เปิด: เข้า URL ที่มี ?diag=1 หนึ่งครั้ง (จำไว้ใน localStorage ของเครื่องนั้น)   ปิด: ?diag=0
// ตอนปิดอยู่ ทุกฟังก์ชันในไฟล์นี้เป็น no-op ไม่ยิง Firestore เพิ่มเลย
// log เก็บใน localStorage (ล่าสุด 300 บรรทัด) — รอด full reload จึงเห็นได้ว่าหน้าถูกโหลดใหม่ทั้งหน้าหรือเปล่า
// ดูได้ 2 ทาง: ปุ่มเล็กมุมซ้ายล่าง (แตะเพื่อขยาย) หรือ console ของ remote debugging (ขึ้นต้นด้วย [diag])

import { useEffect } from "react";
import { onSnapshot, getDocFromServer, doc, type Query, type DocumentReference } from "firebase/firestore";
import { db, getAuthInstance } from "../lib/firebase";

const ENABLED_KEY = "diagEnabled";
const LOG_KEY = "diagLog";
const ALIVE_KEY = "diagLastAlive";
const MAX_LINES = 300;
// หลังกลับมา active นานเท่านี้ ยังนับว่า snapshot/โหลด chunk เป็นผลของการ resume (แสดง "+Xs หลัง resume")
const RESUME_WINDOW_MS = 120_000;

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage เต็ม/ถูกบล็อก — ช่างมัน */ }
}

let enabled = false;
let lines: string[] = [];
let hiddenAt: number | null = null;
let resumedAt: number | null = null;
let resumeSeq = 0;
let lastSummary = "diag";
const loadAt = Date.now();

function secs(ms: number) {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}
function dur(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}
function clock(t = Date.now()) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
// "+1.23s หลัง resume" ถ้ายังอยู่ในช่วงหลัง resume ไม่งั้น "+Xs หลังโหลดหน้า"
function sinceMark(now = Date.now()) {
  if (resumedAt !== null && now - resumedAt < RESUME_WINDOW_MS) return `+${secs(now - resumedAt)} after resume#${resumeSeq}`;
  if (now - loadAt < RESUME_WINDOW_MS) return `+${secs(now - loadAt)} after load`;
  return "";
}

export function diagLog(msg: string) {
  if (!enabled) return;
  const line = `${clock()} ${msg}`;
  console.log(`[diag] ${line}`);
  lines.push(line);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  lsSet(LOG_KEY, JSON.stringify(lines));
  renderOverlay();
}

function setSummary(s: string) {
  lastSummary = s;
  renderOverlay();
}

// ─── Firestore: ฟังคู่ขนาน (probe) บน query เดียวกับ listener จริง ────────────────
// Firestore SDK รวม listener ที่ query เหมือนกันเป็น target เดียว — probe จึงไม่เพิ่ม read และเวลาที่วัดได้
// = เวลาของ listener จริงพอดี ใช้ includeMetadataChanges เพื่อเห็นจังหวะสลับ cache ↔ server
// (listener จริงไม่ได้ถูกแก้ไขอะไรเลย พฤติกรรม auto-print ฯลฯ จึงเหมือนเดิม 100%)
export function diagWatch(name: string, target: Query | DocumentReference): () => void {
  if (!enabled) return () => { };
  const startedAt = Date.now();
  let first = true;
  let lastFromCache: boolean | null = null;
  const onNext = (snap: { metadata: { fromCache: boolean; hasPendingWrites: boolean } }, size: number) => {
    const fromCache = snap.metadata.fromCache;
    if (first) {
      first = false;
      diagLog(`LISTEN ${name}: first snapshot ${fromCache ? "FROM CACHE" : "from server"} in ${secs(Date.now() - startedAt)} (${size} docs) ${sinceMark()}`);
    } else if (fromCache !== lastFromCache) {
      diagLog(`LISTEN ${name}: now ${fromCache ? "FROM CACHE (lost server)" : "SYNCED with server"} ${sinceMark()}`);
    }
    lastFromCache = fromCache;
  };
  const onError = (err: Error) => diagLog(`LISTEN ${name}: ERROR ${err.message}`);
  // onSnapshot มี overload แยก Query/DocumentReference — แยกเรียกเพื่อให้ type ถูก
  if (target.type === "document") {
    return onSnapshot(target as DocumentReference, { includeMetadataChanges: true }, (s) => onNext(s, s.exists() ? 1 : 0), onError);
  }
  return onSnapshot(target as Query, { includeMetadataChanges: true }, (s) => onNext(s, s.size), onError);
}

// จับเวลางาน async (getDocs ของ History/Stats ฯลฯ)
export async function diagTime<T>(name: string, fn: () => Promise<T>, describe?: (r: T) => string): Promise<T> {
  if (!enabled) return fn();
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    diagLog(`${ms > 2000 ? "SLOW " : ""}${name}: ${secs(ms)}${describe ? ` (${describe(r)})` : ""} — done ${sinceMark()}`);
    return r;
  } catch (err) {
    diagLog(`${name}: FAILED after ${secs(Date.now() - t0)} — ${(err as Error)?.message} — ${sinceMark()}`);
    throw err;
  }
}

// ครอบ dynamic import ของ React.lazy — ดูว่าการโหลด JS chunk ของหน้าจอพนักงานช้าไหม
export function diagImport<T>(name: string, load: () => Promise<T>): () => Promise<T> {
  return () => diagTime(`CHUNK ${name}`, load);
}

// วางไว้ใน fallback ของ Suspense — log ว่าวงหมุน "กำลังโหลด..." เต็มจอค้างอยู่กี่วินาที
export function DiagSpinnerSpy({ where }: { where: string }) {
  useEffect(() => {
    if (!enabled) return;
    const t0 = Date.now();
    diagLog(`SPINNER shown (${where}) ${sinceMark(t0)}`);
    return () => diagLog(`SPINNER hidden (${where}) after ${secs(Date.now() - t0)}`);
  }, [where]);
  return null;
}

// ─── กลับมา active: ยิง probe วัดว่า Firestore/Auth คุยกับ server ได้เร็วแค่ไหน ───────────
async function probeAfterResume(seq: number) {
  // Auth: ถ้า ID token หมดอายุ (>1 ชม.) Firestore ต้องรอ refresh token ก่อนถึงจะ listen ต่อได้
  const user = getTableFromUrlSafe() === null ? getAuthInstance().currentUser : null;
  if (user) {
    // getIdTokenResult(false) คืนทันทีถ้า token ยังไม่หมดอายุ — ถ้าใช้เวลานาน (>~0.2s) = ต้องไป refresh กับ server
    await diagTime(`AUTH token check #${seq}`, () => user.getIdTokenResult(false),
      (res) => `valid until ${clock(Date.parse(res.expirationTime))}`).catch(() => { });
  }
  // 1 read ต่อการ resume — บังคับไปถาม server จริง ต้องเป็น doc ที่ "ไม่มี listener ตัวไหนฟังอยู่"
  // (ถ้าใช้ status/live SDK จะตอบจาก listener ที่ active อยู่ทันที 0.00s วัดอะไรไม่ได้) — doc นี้ไม่มีอยู่จริง
  // rules ของ status/* อ่านได้ทุกคนอยู่แล้ว
  await diagTime(`PROBE server round-trip #${seq}`, () => getDocFromServer(doc(db, "status", "diagProbe")))
    .then(() => { if (seq === resumeSeq && resumedAt !== null) setSummary(`resume#${seq} ok ${secs(Date.now() - resumedAt)}`); })
    .catch(() => setSummary(`resume#${seq} FAILED`));
}

function getTableFromUrlSafe(): string | null {
  try { return new URLSearchParams(window.location.search).get("table"); } catch { return null; }
}

function onVisibility() {
  const now = Date.now();
  if (document.visibilityState === "hidden") {
    hiddenAt = now;
    lsSet(ALIVE_KEY, String(now));
    diagLog("HIDDEN");
  } else {
    if (hiddenAt === null) return; // visible ซ้ำโดยไม่เคย hidden (เช่นตอนเปิดหน้าครั้งแรก) — ไม่ใช่การ resume
    const away = now - hiddenAt;
    resumedAt = now;
    resumeSeq += 1;
    diagLog(`RESUME #${resumeSeq} (tab resume, NOT reload) — hidden for ${dur(away)}; online=${navigator.onLine}`);
    setSummary(`resume#${resumeSeq} …`);
    hiddenAt = null;
    void probeAfterResume(resumeSeq);
  }
}

// ─── Overlay (DOM ล้วน ไม่ผูกกับ React — ลบง่าย) ─────────────────────────────────
let pill: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let pre: HTMLPreElement | null = null;

function renderOverlay() {
  if (!pill) return;
  pill.textContent = `🩺 ${lastSummary}`;
  if (pre && panel && panel.style.display !== "none") {
    pre.textContent = lines.slice().reverse().join("\n");
  }
}

function mountOverlay() {
  pill = document.createElement("button");
  Object.assign(pill.style, {
    position: "fixed", left: "4px", bottom: "4px", zIndex: "2147483647",
    font: "11px/1.2 monospace", padding: "3px 6px", borderRadius: "6px",
    background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", opacity: "0.8",
  } as Partial<CSSStyleDeclaration>);

  panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed", left: "4px", right: "4px", bottom: "30px", maxHeight: "60vh",
    zIndex: "2147483647", background: "rgba(0,0,0,0.88)", color: "#eee", borderRadius: "8px",
    display: "none", flexDirection: "column", font: "11px/1.35 monospace",
  } as Partial<CSSStyleDeclaration>);

  const bar = document.createElement("div");
  Object.assign(bar.style, { display: "flex", gap: "6px", padding: "6px", borderBottom: "1px solid #444" });
  const mkBtn = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, { background: "#333", color: "#fff", border: "1px solid #666", borderRadius: "4px", padding: "4px 8px", font: "12px sans-serif" });
    b.onclick = onClick;
    bar.appendChild(b);
    return b;
  };
  const copyBtn = mkBtn("Copy", () => {
    const text = lines.join("\n");
    const done = () => { copyBtn.textContent = "Copied ✓"; setTimeout(() => (copyBtn.textContent = "Copy"), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  });
  mkBtn("Clear", () => { lines = []; lsSet(LOG_KEY, null); diagLog("(cleared)"); });
  mkBtn("Close", () => { panel!.style.display = "none"; });

  pre = document.createElement("pre");
  Object.assign(pre.style, { margin: "0", padding: "6px", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text" });

  panel.append(bar, pre);
  pill.onclick = () => {
    panel!.style.display = panel!.style.display === "none" ? "flex" : "none";
    renderOverlay();
  };
  document.body.append(panel, pill);
  renderOverlay();
}

// iOS in-app/บางเบราว์เซอร์ไม่มี navigator.clipboard (ต้อง https + user gesture) — ใช้ textarea แทน
function fallbackCopy(text: string, done: () => void) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch { /* ignore */ }
  ta.remove();
}

// เรียกครั้งเดียวใน main.tsx ก่อน render — ต้องมาก่อน listener "pageshow" ของ App เพื่อให้ log ทันก่อนมัน reload
export function initDiag() {
  const param = new URLSearchParams(window.location.search).get("diag");
  if (param === "1") lsSet(ENABLED_KEY, "1");
  if (param === "0") { lsSet(ENABLED_KEY, null); lsSet(LOG_KEY, null); lsSet(ALIVE_KEY, null); }
  enabled = lsGet(ENABLED_KEY) === "1";
  if (!enabled) return;

  try { lines = JSON.parse(lsGet(LOG_KEY) || "[]"); } catch { lines = []; }

  // โหลดหน้าแบบไหน: navigate = เปิดใหม่/พิมพ์ URL, reload = รีเฟรช (รวมถึงตอนเบราว์เซอร์ discard แท็บแล้วโหลดคืน),
  // back_forward = กด back/forward
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  const lastAlive = Number(lsGet(ALIVE_KEY) || 0);
  const wasDiscarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded;
  diagLog("────────────────────────");
  diagLog(`FULL PAGE LOAD type=${nav?.type ?? "?"}${wasDiscarded ? " (BROWSER HAD DISCARDED THIS TAB)" : ""}` +
    `${lastAlive ? `; last seen alive ${dur(Date.now() - lastAlive)} ago` : ""}; ${navigator.userAgent.slice(0, 80)}`);
  setSummary("loaded");

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) diagLog("PAGESHOW from bfcache — App will now force window.location.reload()");
  });
  // Page Lifecycle (Chrome/Android): freeze = เบราว์เซอร์แช่แข็ง JS ของแท็บ, resume = ปลดแช่แข็ง
  document.addEventListener("freeze", () => { lsSet(ALIVE_KEY, String(Date.now())); diagLog("FROZEN by browser"); });
  document.addEventListener("resume", () => diagLog("UNFROZEN by browser"));
  window.addEventListener("online", () => diagLog("NETWORK online"));
  window.addEventListener("offline", () => diagLog("NETWORK offline"));
  // heartbeat — ถ้าโหลดใหม่ทั้งหน้าโดยไม่ได้ผ่าน HIDDEN จะยังรู้ได้ว่าหน้าเดิมตายไปนานแค่ไหน
  window.setInterval(() => { if (document.visibilityState === "visible") lsSet(ALIVE_KEY, String(Date.now())); }, 15_000);

  if (document.body) mountOverlay();
  else window.addEventListener("DOMContentLoaded", mountOverlay);
}
