import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCw, X } from "lucide-react";
import { getDoc } from "firebase/firestore";
import type { Language } from "../types";
import { CUSTOMER_SITE_URL } from "../constants";
import { ZONES, tableTitle, zoneTitle } from "../tables";
import { createTableLink, emptyTableView, QR_CONFIG_REF, setLegacyTableUrlEnabled } from "../tableViewStore";
import { refreshTableLinks, useTableLinks } from "./tableLinkStore";

// ลิงก์ของทุกโต๊ะ (?t=รหัสสุ่ม) — ร้านเอาลิงก์ไปทำ QR เองใน template ของร้าน
// สร้างลิงก์ใหม่ = ลิงก์/QR เดิมของโต๊ะนั้นใช้ไม่ได้ทันที (ลูกค้าที่เปิดค้างอยู่จะส่งออเดอร์ไม่ได้ ต้องสแกนใหม่)
// สวิตช์ลิงก์แบบเดิม (?table=1-3): ปิดแล้ว QR เก่าขึ้นว่า "QR นี้ใช้ไม่ได้" — ปิดหลังติด QR ใหม่ครบทุกโต๊ะแล้วเท่านั้น
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

export function TableLinksModal({ lang, onClose }: { lang: Language; onClose: () => void }) {
  const en = lang === "en";
  const links = useTableLinks();
  const [loadError, setLoadError] = useState(false);
  const [busyTable, setBusyTable] = useState<string | null>(null); // กำลังสร้าง ("*" = ทุกโต๊ะ)
  const [confirmTable, setConfirmTable] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legacyOn, setLegacyOn] = useState<boolean | null>(null);

  useEffect(() => {
    refreshTableLinks().catch(() => setLoadError(true));
    getDoc(QR_CONFIG_REF())
      .then((snap) => setLegacyOn(snap.data()?.legacyTableUrl !== false))
      .catch(() => setLegacyOn(null));
  }, []);

  const flashCopied = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };

  // อ่านรหัสล่าสุดจาก server ก่อนสร้างทุกครั้ง — กันสองเครื่องสร้างซ้อนกันจนโต๊ะเดียวมีหลายรหัส
  const create = async (tables: string[], key: string) => {
    setBusyTable(key);
    setConfirmTable(null);
    setError(null);
    try {
      const fresh = await refreshTableLinks();
      for (const table of tables) {
        await createTableLink(table, fresh.get(table)?.token ?? null, emptyTableView());
      }
      await refreshTableLinks();
    } catch (err: any) {
      setError((en ? "Could not create link: " : "สร้างลิงก์ไม่สำเร็จ: ") + (err?.message || String(err)));
    } finally {
      setBusyTable(null);
    }
  };

  const toggleLegacy = async () => {
    if (legacyOn === null) return;
    const next = !legacyOn;
    setError(null);
    try {
      await setLegacyTableUrlEnabled(next);
      setLegacyOn(next);
    } catch (err: any) {
      setError((en ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err)));
    }
  };

  const allTables = ZONES.flatMap((z) => z.tables.map((tb) => tb.id));
  const missing = links ? allTables.filter((id) => !links.has(id)) : [];
  const allText = links
    ? allTables.filter((id) => links.has(id)).map((id) => `${tableTitle(id, lang)}\t${tableLinkUrl(links.get(id)!.token)}`).join("\n")
    : "";

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl p-5 max-w-lg w-full border border-border shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-foreground font-semibold flex items-center gap-2"><Link2 size={18} />{en ? "Table links" : "ลิงก์โต๊ะ"}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {en
            ? "Make each link into a QR code for that table. Customers who open these links can see what their table has ordered."
            : "นำลิงก์ไปทำ QR ของแต่ละโต๊ะ ลูกค้าที่เข้าด้วยลิงก์นี้จะเห็น \"ที่สั่งไปแล้ว\" ของโต๊ะตัวเอง"}
        </p>

        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        {loadError && !links && <p className="text-sm text-destructive mb-3">{en ? "Could not load links." : "โหลดลิงก์ไม่สำเร็จ"}</p>}
        {!links && !loadError && (
          <div className="py-8 flex justify-center text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
        )}

        {links && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {missing.length > 0 && (
                <button
                  onClick={() => create(missing, "*")}
                  disabled={busyTable !== null}
                  className="px-3 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {busyTable === "*" ? <Loader2 size={14} className="animate-spin inline" /> : null}{" "}
                  {en ? `Create links for ${missing.length} tables` : `สร้างลิงก์ให้ ${missing.length} โต๊ะที่ยังไม่มี`}
                </button>
              )}
              {allText && (
                <button
                  onClick={() => flashCopied("*", allText)}
                  className="px-3 py-2 rounded-xl text-sm font-medium border border-border hover:bg-muted flex items-center gap-1.5"
                >
                  {copied === "*" ? <Check size={14} /> : <Copy size={14} />}
                  {en ? "Copy all" : "คัดลอกทั้งหมด"}
                </button>
              )}
            </div>

            {ZONES.map((z) => (
              <div key={z.zone} className="mb-4">
                <h3 className="font-semibold text-foreground text-sm mb-2">{zoneTitle(z, lang)}</h3>
                <div className="space-y-2">
                  {z.tables.map((tb) => {
                    const link = links.get(tb.id);
                    const url = link ? tableLinkUrl(link.token) : null;
                    return (
                      <div key={tb.id} className="rounded-xl border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground text-sm">{tableTitle(tb.id, lang)}</span>
                          <div className="flex items-center gap-1">
                            {url && (
                              <button
                                onClick={() => flashCopied(tb.id, url)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted flex items-center gap-1"
                              >
                                {copied === tb.id ? <Check size={13} /> : <Copy size={13} />}
                                {copied === tb.id ? (en ? "Copied" : "คัดลอกแล้ว") : (en ? "Copy" : "คัดลอก")}
                              </button>
                            )}
                            <button
                              onClick={() => (url ? setConfirmTable(tb.id) : create([tb.id], tb.id))}
                              disabled={busyTable !== null}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted flex items-center gap-1 disabled:opacity-40"
                            >
                              {busyTable === tb.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                              {url ? (en ? "New link" : "สร้างลิงก์ใหม่") : (en ? "Create link" : "สร้างลิงก์")}
                            </button>
                          </div>
                        </div>
                        {url ? (
                          <p className="text-[11px] text-muted-foreground font-mono break-all mt-1.5 select-all">{url}</p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground mt-1.5">{en ? "No link yet" : "ยังไม่มีลิงก์"}</p>
                        )}
                        {confirmTable === tb.id && (
                          <div className="mt-2 rounded-lg bg-destructive/10 p-2.5">
                            <p className="text-xs text-foreground mb-2">
                              {en
                                ? `The current link and QR of ${tableTitle(tb.id, lang)} will stop working right away. Customers there must scan the new QR.`
                                : `ลิงก์และ QR เดิมของ${tableTitle(tb.id, lang)}จะใช้ไม่ได้ทันที ลูกค้าที่นั่งอยู่ต้องสแกน QR ใหม่`}
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => create([tb.id], tb.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-destructive-foreground"
                              >
                                {en ? "Create new link" : "ยืนยัน สร้างลิงก์ใหม่"}
                              </button>
                              <button onClick={() => setConfirmTable(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted">
                                {en ? "Cancel" : "ยกเลิก"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        <div className="mt-2 pt-4 border-t border-border flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">{en ? "Old QR codes (?table=)" : "QR แบบเดิม (?table=)"}</p>
            <p className="text-[11px] text-muted-foreground">
              {en ? "Turn off after the new QR codes are on every table." : "ปิดหลังติด QR ใหม่ครบทุกโต๊ะแล้ว"}
            </p>
          </div>
          <button
            onClick={toggleLegacy}
            disabled={legacyOn === null}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold min-w-[64px] disabled:opacity-40 ${
              legacyOn ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {legacyOn === null ? "…" : legacyOn ? (en ? "On" : "เปิด") : (en ? "Off" : "ปิด")}
          </button>
        </div>
      </div>
    </div>
  );
}
