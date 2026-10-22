import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { tableTitle } from "../tables";
import { formatClock } from "../utils";
import { fetchTableLink } from "../tableViewStore";
import { decodeTableView, pendingSentOrders, type SentOrder, type TableViewData, type TableViewLine } from "../tableView";

const LOAD_TIMEOUT_MS = 8000;

// "ที่สั่งไปแล้ว" — รายการรวมของโต๊ะ (ทุกเครื่อง + ที่พนักงานสั่งแทน) จากสรุปที่เครื่องพนักงานเขียนไว้ (ดู tableView.ts)
// อ่านใหม่ทุกครั้งที่เปิด + ปุ่มรีเฟรช (1 read ต่อครั้ง) ไม่ฟังค้าง
// baselineClosedAt = เวลาปิดบิลของโต๊ะตอนเริ่มรอบนั่งนี้ — สรุปที่เก่ากว่านั้นเป็นของบิลก่อน (ไม่แสดง)
export function OrderedSheet({
  lang, token, table, baselineClosedAt, sentOrders, onRevoked, onClose,
}: {
  lang: Language;
  token: string;
  table: string;
  baselineClosedAt: number | null;
  sentOrders: SentOrder[];
  onRevoked: () => void;
  onClose: () => void;
}) {
  const t = T[lang];
  const en = lang === "en";
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error" } | { kind: "ok"; view: TableViewData & { updatedAtMs: number } }
  >({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetchTableLink(token, LOAD_TIMEOUT_MS).then(
      (link) => {
        if (!link || link.table !== table) {
          onRevoked();
          return;
        }
        const view = decodeTableView({ version: link.version, data: link.data, updatedAtMs: link.updatedAtMs }, baselineClosedAt);
        setState(view ? { kind: "ok", view } : { kind: "error" });
      },
      () => setState({ kind: "error" }),
    );
  }, [token, table, baselineClosedAt, onRevoked]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const view = state.kind === "ok" ? state.view : null;
  const pending = view ? pendingSentOrders(sentOrders, view, Date.now()) : [];
  const pendingLines = pending.flatMap((s) => s.lines);
  const total = (view?.total ?? 0) + pendingLines.reduce((s, l) => s + l.amount, 0);
  const isEmpty = !!view && view.lines.length === 0 && pendingLines.length === 0;

  const row = (l: TableViewLine, key: string, sending: boolean) => {
    const opt = en ? l.optEn : l.optTh;
    return (
      <div key={key} className={`flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-b-0 ${sending ? "opacity-50" : ""}`}>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{en ? l.en : l.th}</div>
          {opt && <div className="text-xs text-muted-foreground mt-0.5">{opt}</div>}
          {sending && <div className="text-[11px] text-muted-foreground mt-0.5 italic">{t.orderedSending}</div>}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs text-muted-foreground">×{l.qty}</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">{t.thb}{l.amount.toLocaleString()}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-card w-full max-w-md rounded-t-3xl border border-border shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {t.orderedTitle} · {tableTitle(table, lang)}
            </h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1" aria-label={en ? "Close" : "ปิด"}>
              <X size={20} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-muted-foreground">
              {view && view.updatedAtMs > 0 ? t.orderedUpdated(formatClock(new Date(view.updatedAtMs))) : ""}
            </span>
            <button
              onClick={load}
              disabled={state.kind === "loading"}
              className="flex items-center gap-1 text-xs font-medium text-primary px-2 py-1 rounded-lg hover:bg-primary/10 disabled:opacity-40"
            >
              <RefreshCw size={13} className={state.kind === "loading" ? "animate-spin" : ""} />
              {t.orderedRefresh}
            </button>
          </div>
        </div>

        <div className="px-5 overflow-y-auto flex-1">
          {state.kind === "loading" && (
            <div className="py-10 flex justify-center text-muted-foreground"><Loader2 size={22} className="animate-spin" /></div>
          )}
          {state.kind === "error" && (
            <p className="py-10 text-center text-sm text-muted-foreground">{t.orderedLoadFailed}</p>
          )}
          {isEmpty && <p className="py-10 text-center text-sm text-muted-foreground">{t.orderedEmpty}</p>}
          {view && (
            <div className="py-1">
              {view.lines.map((l, i) => row(l, `l${i}`, false))}
              {pendingLines.map((l, i) => row(l, `p${i}`, true))}
            </div>
          )}
        </div>

        {view && !isEmpty && (
          <div className="px-5 pt-3 pb-5 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">{t.orderedTotal}</span>
              <span className="font-display text-xl font-bold text-foreground tabular-nums">{t.thb}{total.toLocaleString()}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{t.orderedNote}</p>
          </div>
        )}
      </div>
    </div>
  );
}
