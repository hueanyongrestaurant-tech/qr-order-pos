import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Plus, RefreshCw } from "lucide-react";
import type { Language } from "../types";
import { CUSTOMER_SITE_URL } from "../constants";
import { TABLE_GROUPS, allTableIds, tableTitle, zoneTitle } from "../tables";
import {
  LinkChangedError, createMissingTableLinks, readLegacyTableUrlForStaff, regenerateTableLink, setLegacyTableUrlEnabled,
} from "../tableViewStore";
import { LOAD_TIMEOUT_MS } from "../timeout";
import { refreshTableLinks, useTableLinks } from "./tableLinkStore";

// ลิงก์ของทุกโต๊ะ (?t=รหัสสุ่ม) — อยู่ในหน้าตั้งค่า แท็บ "ร้าน" (ไม่มีหน้าต่างซ้อน) ร้านเอาลิงก์ไปทำ QR เอง
// • สร้างลิงก์ = เฉพาะโต๊ะที่ยังไม่มี (เช็คบน server ใน transaction — createMissingTableLinks) ถามยืนยันก่อน
//   ไม่มีทางแทน/ลบลิงก์เดิม เพราะ QR ที่พิมพ์ติดโต๊ะผูกกับรหัสเดิม
// • เปลี่ยนลิงก์ = ทางเดียวที่ทำให้รหัสเดิมใช้ไม่ได้ (regenerateTableLink) ต้องยืนยันว่า QR ที่พิมพ์ไว้จะใช้ไม่ได้
// • โหลดทุกอย่างจาก server ไม่เกิน 10 วิ — ไม่ได้ = ข้อความ + ปุ่มลองใหม่ (ไม่หมุนค้าง ไม่แสดง "ยังไม่มีลิงก์" จาก cache ว่าง)
// • สวิตช์ QR รุ่นเก่า (?table=1-3): ปิดแล้ว QR เก่าขึ้นว่า "QR นี้ใช้ไม่ได้" ถามยืนยันก่อนปิด
export const tableLinkUrl = (token: string) => `${CUSTOMER_SITE_URL}?t=${token}`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // WebView บางรุ่นไม่มี clipboard API — ใช้วิธีเก่า
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}

type Confirm =
  | { kind: "create"; tables: string[] }
  | { kind: "replace"; table: string; token: string }
  | { kind: "legacyOff" };

export function TableLinksPanel({ lang }: { lang: Language }) {
  const en = lang === "en";
  const links = useTableLinks();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // โต๊ะที่กำลังสร้าง/เปลี่ยน ("*" = หลายโต๊ะ)
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [legacyOn, setLegacyOn] = useState<boolean | null>(null);
  const [legacyError, setLegacyError] = useState(false);
  const [legacySaving, setLegacySaving] = useState(false);

  const loadLinks = () => {
    setLoading(true);
    setLoadError(false);
    return refreshTableLinks().then(
      () => setLoading(false),
      () => { setLoading(false); setLoadError(true); },
    );
  };
  const loadLegacy = () => {
    setLegacyError(false);
    setLegacyOn(null);
    readLegacyTableUrlForStaff(LOAD_TIMEOUT_MS).then(setLegacyOn, () => setLegacyError(true));
  };
  useEffect(() => {
    loadLinks();
    loadLegacy();
  }, []);

  const flashCopied = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };
  const errText = (err: any) => (err?.name === "TimeoutError" ? (en ? "no response from the server" : "เซิร์ฟเวอร์ไม่ตอบ") : err?.message || String(err));

  // สร้างเฉพาะโต๊ะที่ server บอกว่ายังไม่มีลิงก์ — โต๊ะที่มีแล้วข้าม ไม่แตะ
  const create = async (tables: string[]) => {
    setBusy(tables.length === 1 ? tables[0] : "*");
    setConfirm(null);
    setError(null);
    setNotice(null);
    try {
      const { created, skipped } = await createMissingTableLinks(tables);
      setNotice(
        (en ? `Created ${created.length} link(s)` : `สร้างลิงก์ ${created.length} โต๊ะ`) +
        (skipped.length > 0 ? (en ? ` · skipped ${skipped.length} that already had one` : ` · ข้าม ${skipped.length} โต๊ะที่มีลิงก์อยู่แล้ว`) : ""),
      );
    } catch (err: any) {
      setError((en ? "Could not create links: " : "สร้างลิงก์ไม่สำเร็จ: ") + errText(err));
    } finally {
      setBusy(null);
      loadLinks();
    }
  };

  const replace = async (table: string, token: string) => {
    setBusy(table);
    setConfirm(null);
    setError(null);
    setNotice(null);
    try {
      await regenerateTableLink(table, token);
    } catch (err: any) {
      setError(err instanceof LinkChangedError
        ? (en ? "This table's link was already changed on another device. Nothing was changed." : "ลิงก์ของโต๊ะนี้ถูกเปลี่ยนจากเครื่องอื่นไปแล้ว ไม่ได้เปลี่ยนอะไร")
        : (en ? "Could not change the link: " : "เปลี่ยนลิงก์ไม่สำเร็จ: ") + errText(err));
    } finally {
      setBusy(null);
      loadLinks();
    }
  };

  const saveLegacy = async (next: boolean) => {
    setConfirm(null);
    setError(null);
    setLegacySaving(true);
    try {
      await setLegacyTableUrlEnabled(next);
      setLegacyOn(next);
    } catch (err: any) {
      setError((en ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + errText(err));
    } finally {
      setLegacySaving(false);
    }
  };

  const allTables = allTableIds();
  const missing = links ? allTables.filter((id) => !links.has(id)) : [];
  const allText = links
    ? TABLE_GROUPS.flatMap((g) => g.tables.map((tb) => tb.id)).filter((id) => links.has(id)).map((id) => `${tableTitle(id, lang)}\t${tableLinkUrl(links.get(id)!.token)}`).join("\n")
    : "";
  const retryButton = (onClick: () => void) => (
    <button onClick={onClick} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted flex items-center gap-1.5 flex-shrink-0">
      <RefreshCw size={13} />
      {en ? "Retry" : "ลองใหม่"}
    </button>
  );
  const confirmBox = (text: string, okLabel: string, onOk: () => void, danger: boolean) => (
    <div role="alertdialog" className={`mt-2 rounded-lg p-2.5 ${danger ? "bg-destructive/10" : "bg-muted"}`}>
      <p className="text-xs text-foreground mb-2">{text}</p>
      <div className="flex gap-2">
        <button onClick={onOk} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${danger ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
          {okLabel}
        </button>
        <button onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border">
          {en ? "Cancel" : "ยกเลิก"}
        </button>
      </div>
    </div>
  );
  const createQuestion = (n: number) => (en ? `Create new links for ${n} table(s)?` : `สร้างลิงก์ใหม่ ${n} โต๊ะ?`);

  return (
    <div>
      {/* QR รุ่นเก่า (?table=1-3) — สวิตช์ทั้งร้าน ค่าอ่านจาก server เท่านั้น */}
      <div className="rounded-xl border border-border px-3 py-2.5 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{en ? "Old QR codes (?table=)" : "QR รุ่นเก่า (?table=)"}</div>
            <div className={`text-[11px] ${legacyError ? "text-destructive" : "text-muted-foreground"}`}>
              {legacyError
                ? (en ? "Could not load" : "โหลดไม่สำเร็จ")
                : legacyOn === null
                  ? (en ? "Loading…" : "กำลังโหลด…")
                  : legacyOn
                    ? (en ? "On · old links can still order" : "เปิดอยู่ · ลิงก์เก่ายังสั่งได้")
                    : (en ? "Off · only new QR codes work" : "ปิดอยู่ · ใช้ได้เฉพาะ QR ใหม่")}
            </div>
          </div>
          {legacyError ? retryButton(loadLegacy) : legacyOn === null ? (
            <Loader2 size={16} className="animate-spin text-muted-foreground flex-shrink-0" />
          ) : (
            <button
              role="switch"
              aria-checked={legacyOn}
              aria-label={en ? "Old QR codes (?table=)" : "QR รุ่นเก่า (?table=)"}
              disabled={legacySaving}
              onClick={() => (legacyOn ? setConfirm({ kind: "legacyOff" }) : saveLegacy(true))}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${legacyOn ? "bg-secondary" : "bg-muted-foreground/30"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${legacyOn ? "left-[22px]" : "left-0.5"}`} />
            </button>
          )}
        </div>
        {confirm?.kind === "legacyOff" && confirmBox(
          en ? "Turn off old QR codes? Customers scanning an old ?table= QR will not be able to order." : "ปิด QR รุ่นเก่า? ลูกค้าที่สแกน QR เก่า (?table=) จะสั่งไม่ได้",
          en ? "Turn off" : "ยืนยัน ปิด",
          () => saveLegacy(false),
          true,
        )}
      </div>

      {error && <p role="alert" className="text-xs text-destructive mb-2">{error}</p>}
      {notice && <p className="text-xs text-foreground mb-2">{notice}</p>}

      {loadError && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 mb-3 flex items-center gap-3">
          <p className="flex-1 text-xs text-foreground">
            {links
              ? (en ? "Could not refresh the links. The list below may be out of date." : "โหลดลิงก์ล่าสุดไม่สำเร็จ รายการด้านล่างอาจไม่ใช่ล่าสุด")
              : (en ? "Could not load the table links. Check the internet and try again." : "โหลดลิงก์โต๊ะไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่")}
          </p>
          {retryButton(loadLinks)}
        </div>
      )}
      {!links && loading && (
        <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          {en ? "Loading links…" : "กำลังโหลดลิงก์…"}
        </div>
      )}

      {links && (
        <>
          <div className="flex flex-wrap gap-2 mb-1">
            {missing.length > 0 && (
              <button
                onClick={() => setConfirm({ kind: "create", tables: missing })}
                disabled={busy !== null}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1.5"
              >
                {busy === "*" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {en ? `Create links for ${missing.length} table(s) without one` : `สร้างลิงก์ให้ ${missing.length} โต๊ะที่ยังไม่มี`}
              </button>
            )}
            {allText && (
              <button
                onClick={() => flashCopied("*", allText)}
                className="px-3 py-2 rounded-xl text-xs font-medium border border-border hover:bg-muted flex items-center gap-1.5"
              >
                {copied === "*" ? <Check size={13} /> : <Copy size={13} />}
                {en ? "Copy all" : "คัดลอกทั้งหมด"}
              </button>
            )}
          </div>
          {confirm?.kind === "create" && confirm.tables.length > 1 && confirmBox(
            createQuestion(confirm.tables.length) + (en ? " Tables that already have a link are left as they are." : " โต๊ะที่มีลิงก์อยู่แล้วไม่ถูกแตะ"),
            en ? "Create" : "ยืนยัน สร้าง",
            () => create(confirm.tables),
            false,
          )}

          {TABLE_GROUPS.map((z) => (
            <div key={z.zone} className="mt-3">
              <h5 className="font-semibold text-foreground text-xs mb-1.5">{zoneTitle(z, lang)}</h5>
              <div className="space-y-1.5">
                {z.tables.map((tb) => {
                  const link = links.get(tb.id);
                  const url = link ? tableLinkUrl(link.token) : null;
                  return (
                    <div key={tb.id} className="rounded-xl border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground text-sm">{tableTitle(tb.id, lang)}</span>
                        <div className="flex items-center gap-1">
                          {busy === tb.id && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
                          {url && link ? (
                            <>
                              <button
                                onClick={() => flashCopied(tb.id, url)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted flex items-center gap-1"
                              >
                                {copied === tb.id ? <Check size={13} /> : <Copy size={13} />}
                                {copied === tb.id ? (en ? "Copied" : "คัดลอกแล้ว") : (en ? "Copy" : "คัดลอก")}
                              </button>
                              <button
                                onClick={() => setConfirm({ kind: "replace", table: tb.id, token: link.token })}
                                disabled={busy !== null}
                                className="px-2 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40"
                              >
                                {en ? "Replace link" : "เปลี่ยนลิงก์"}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirm({ kind: "create", tables: [tb.id] })}
                              disabled={busy !== null}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted flex items-center gap-1 disabled:opacity-40"
                            >
                              <Plus size={13} />
                              {en ? "Create link" : "สร้างลิงก์"}
                            </button>
                          )}
                        </div>
                      </div>
                      {url ? (
                        <p className="text-[11px] text-muted-foreground font-mono break-all mt-1 select-all">{url}</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground mt-1">{en ? "No link yet" : "ยังไม่มีลิงก์"}</p>
                      )}
                      {confirm?.kind === "create" && confirm.tables.length === 1 && confirm.tables[0] === tb.id && confirmBox(
                        createQuestion(1),
                        en ? "Create" : "ยืนยัน สร้าง",
                        () => create([tb.id]),
                        false,
                      )}
                      {confirm?.kind === "replace" && confirm.table === tb.id && confirmBox(
                        en
                          ? `Replace the link of ${tableTitle(tb.id, lang)}? The QR code printed for this table will STOP WORKING right away. You must print and place a new QR.`
                          : `เปลี่ยนลิงก์ของ${tableTitle(tb.id, lang)}? QR ที่พิมพ์ติดโต๊ะนี้จะใช้ไม่ได้ทันที ต้องพิมพ์ QR ใหม่มาติดแทน`,
                        en ? "Replace, old QR stops working" : "ยืนยัน เปลี่ยน (QR เดิมใช้ไม่ได้)",
                        () => replace(tb.id, confirm.token),
                        true,
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
