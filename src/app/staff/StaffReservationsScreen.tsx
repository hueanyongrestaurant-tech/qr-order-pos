import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2, Pencil, Phone, RefreshCw, Trash2, Users, X } from "lucide-react";
import type { Language, StaffTab } from "../types";
import { StaffHeader } from "./StaffHeader";
import { FloorPlan, type FloorTableView } from "./FloorPlan";
import { TABLE_GROUPS, tableShort, tableTitle } from "../tables";
import {
  RESERVATION_LIMITS, addDays, bangkokDate, reservationConflicts, reservationError, type Reservation, type ReservationConflict,
  type ReservationDraft,
} from "../reservations";
import {
  deleteReservation, fetchReservationsOn, newReservationId, saveReservation, useReservationsOn,
} from "./reservationStore";

// ─── จองโต๊ะ — เลือกวัน → ผังร้านของวันนั้น → แตะโต๊ะ (ได้หลายตัว) → กรอกฟอร์ม | รายการจองของวันอยู่ใต้ผัง ───
// จองโต๊ะเดียวกันห่างกันไม่ถึง 2 ชม. = เตือน (ยังบันทึกได้) | พนักงานและเจ้าของใช้ได้เหมือนกัน

const tableOrder = new Map(TABLE_GROUPS.flatMap((g) => g.tables.map((t) => t.id)).map((id, i) => [id, i]));
const sortTables = (ids: string[]) => [...ids].sort((a, b) => (tableOrder.get(a) ?? 99) - (tableOrder.get(b) ?? 99));

function dateLabel(date: string, lang: Language): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "th-TH", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
const tablesLabel = (ids: string[], lang: Language) => sortTables(ids).map((id) => tableShort(id, lang)).join(", ");

export function StaffReservationsScreen({
  lang, date, onDateChange, onTabChange, onLogout, onLangToggle,
}: {
  lang: Language;
  date: string;
  onDateChange: (date: string) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}) {
  const en = lang === "en";
  const today = bangkokDate();
  const { list, state, retry } = useReservationsOn(date);
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState<{ draft: ReservationDraft & { id: string }; isNew: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSelected([]); setConfirmDelete(null); setError(null); }, [date]);

  const byTable = useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const r of list) for (const t of r.tables) m.set(t, [...(m.get(t) ?? []), r]);
    return m;
  }, [list]);
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of list) if (reservationConflicts(r, list).length > 0) ids.add(r.id);
    return ids;
  }, [list]);

  const view = (id: string): FloorTableView => {
    const rs = byTable.get(id) ?? [];
    const isSel = selected.includes(id);
    const first = rs[0];
    return {
      tone: isSel ? "selected" : first ? "reserved" : "default",
      ...(first ? { lines: [first.time + (rs.length > 1 ? ` +${rs.length - 1}` : ""), first.name] } : {}),
      ...(first ? { title: rs.map((r) => `${r.time} ${r.name}`).join("\n") } : {}),
    };
  };
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const openNew = () => {
    setForm({ isNew: true, draft: { id: newReservationId(), date, time: "", tables: sortTables(selected), name: "", phone: "", note: "" } });
  };
  const openEdit = (r: Reservation) => setForm({ isNew: false, draft: { ...r, phone: r.phone ?? "", note: r.note ?? "" } });

  const remove = async (id: string) => {
    setDeleting(id);
    setError(null);
    try {
      await deleteReservation(id);
      setConfirmDelete(null);
    } catch (err: any) {
      setError((en ? "Could not delete: " : "ลบไม่สำเร็จ: ") + (err?.name === "TimeoutError" ? (en ? "no response from the server" : "เซิร์ฟเวอร์ไม่ตอบ") : err?.message || String(err)));
    } finally {
      setDeleting(null);
    }
  };

  const dayWord = date === today ? (en ? "Today" : "วันนี้") : date === addDays(today, 1) ? (en ? "Tomorrow" : "พรุ่งนี้") : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="reservations" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className={`flex-1 px-4 py-5 w-full max-w-xl mx-auto ${selected.length > 0 ? "pb-28" : ""}`}>
        {/* ─── เลือกวัน ─── */}
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => onDateChange(addDays(date, -1))} className="p-2 rounded-xl border border-border bg-card hover:bg-muted" aria-label={en ? "Previous day" : "วันก่อน"}>
            <ChevronLeft size={18} />
          </button>
          <label className="flex-1 min-w-0 relative">
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && onDateChange(e.target.value)}
              className="w-full h-10 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
              aria-label={en ? "Date" : "วันที่"}
            />
          </label>
          <button onClick={() => onDateChange(addDays(date, 1))} className="p-2 rounded-xl border border-border bg-card hover:bg-muted" aria-label={en ? "Next day" : "วันถัดไป"}>
            <ChevronRight size={18} />
          </button>
          {date !== today && (
            <button onClick={() => onDateChange(today)} className="px-3 h-10 rounded-xl text-xs font-semibold border border-border bg-card hover:bg-muted whitespace-nowrap">
              {en ? "Today" : "วันนี้"}
            </button>
          )}
        </div>
        <p className="text-sm text-foreground mb-4 flex items-center gap-1.5">
          <CalendarDays size={14} className="text-primary flex-shrink-0" />
          <span className="font-semibold">{dateLabel(date, lang)}</span>
          {dayWord && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">{dayWord}</span>}
        </p>

        {state === "error" && (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 mb-3 flex items-center gap-3">
            <p className="flex-1 text-xs text-foreground">{en ? "Could not load reservations. Check the internet and try again." : "โหลดการจองไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่"}</p>
            <button onClick={retry} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted flex items-center gap-1.5">
              <RefreshCw size={13} />
              {en ? "Retry" : "ลองใหม่"}
            </button>
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-2">
          {en ? "Tap tables to pick them, then tap Reserve." : "แตะโต๊ะเพื่อเลือก (ได้หลายโต๊ะ) แล้วกด \"จอง\""}
        </p>
        <FloorPlan lang={lang} onSelect={toggle} view={view} />

        {/* ─── รายการจองของวัน ─── */}
        <div className="mt-6">
          <h3 className="font-semibold text-foreground text-sm mb-2 flex items-center gap-2">
            {en ? "Reservations" : "รายการจอง"}
            {state === "loading" ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : <span className="text-muted-foreground font-normal">({list.length})</span>}
          </h3>
          {error && <p role="alert" className="text-xs text-destructive mb-2">{error}</p>}
          {state === "ok" && list.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">{en ? "No reservations on this day" : "ยังไม่มีการจองวันนี้"}</p>
          )}
          <div className="space-y-2">
            {list.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-start gap-3">
                  <div className="text-lg font-bold text-primary tabular-nums leading-tight">{r.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground break-words">{r.name}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      <span>{(en ? "Table " : "โต๊ะ ") + tablesLabel(r.tables, lang)}</span>
                      {r.partySize && <span className="flex items-center gap-1"><Users size={11} />{r.partySize}{en ? "" : " คน"}</span>}
                      {r.phone && (
                        <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                          <Phone size={11} />{r.phone}
                        </a>
                      )}
                    </div>
                    {r.note && <p className="text-xs text-foreground mt-1 whitespace-pre-wrap break-words">{r.note}</p>}
                    {conflictIds.has(r.id) && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        {en ? "Another booking on the same table within 2 h" : "มีจองโต๊ะเดียวกันห่างไม่ถึง 2 ชม."}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(r)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={en ? "Edit" : "แก้ไข"}>
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setConfirmDelete(r.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label={en ? "Delete" : "ลบ"}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {confirmDelete === r.id && (
                  <div role="alertdialog" className="mt-2 rounded-lg p-2.5 bg-destructive/10">
                    <p className="text-xs text-foreground mb-2">{en ? `Delete the reservation of ${r.name}?` : `ลบการจองของ ${r.name}?`}</p>
                    <div className="flex gap-2">
                      <button onClick={() => remove(r.id)} disabled={deleting === r.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-destructive-foreground disabled:opacity-50 flex items-center gap-1">
                        {deleting === r.id && <Loader2 size={12} className="animate-spin" />}
                        {en ? "Delete" : "ยืนยัน ลบ"}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border">
                        {en ? "Cancel" : "ยกเลิก"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── แถบล่าง: โต๊ะที่เลือก → จอง ─── */}
      {selected.length > 0 && !form && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-2">
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-semibold text-foreground truncate">{(en ? "Table " : "โต๊ะ ") + tablesLabel(selected, lang)}</div>
              <div className="text-xs text-muted-foreground">{en ? `${selected.length} selected` : `เลือก ${selected.length} โต๊ะ`}</div>
            </div>
            <button onClick={() => setSelected([])} className="px-3 py-2.5 rounded-xl text-sm font-medium border border-border hover:bg-muted">
              {en ? "Clear" : "ล้าง"}
            </button>
            <button onClick={openNew} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
              {en ? "Reserve" : "จอง"}
            </button>
          </div>
        </div>
      )}

      {form && (
        <ReservationForm
          lang={lang}
          initial={form.draft}
          isNew={form.isNew}
          pageDate={date}
          pageList={list}
          onClose={() => setForm(null)}
          onSaved={(savedDate) => {
            setForm(null);
            setSelected([]);
            if (savedDate !== date) onDateChange(savedDate);
          }}
        />
      )}
    </div>
  );
}

function ReservationForm({
  lang, initial, isNew, pageDate, pageList, onClose, onSaved,
}: {
  lang: Language;
  initial: ReservationDraft & { id: string };
  isNew: boolean;
  pageDate: string;
  pageList: Reservation[];
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const en = lang === "en";
  const [d, setD] = useState(initial);
  const [party, setParty] = useState(initial.partySize ? String(initial.partySize) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  // ฟอร์มย้ายไปวันอื่น → อ่านการจองของวันนั้นครั้งเดียวไว้เช็คชน
  const [otherDay, setOtherDay] = useState<{ date: string; list: Reservation[] } | null>(null);
  useEffect(() => {
    if (d.date === pageDate || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || otherDay?.date === d.date) return;
    let alive = true;
    fetchReservationsOn(d.date).then((list) => { if (alive) setOtherDay({ date: d.date, list }); }, () => {});
    return () => { alive = false; };
  }, [d.date, pageDate, otherDay?.date]);
  const others = d.date === pageDate ? pageList : otherDay?.date === d.date ? otherDay.list : [];

  const draft: ReservationDraft & { id: string } = { ...d, partySize: party.trim() === "" ? undefined : Number(party) };
  const invalid = reservationError(draft);
  const conflicts: ReservationConflict[] = reservationConflicts(draft, others);
  const set = (patch: Partial<ReservationDraft>) => setD((x) => ({ ...x, ...patch }));
  const toggleTable = (id: string) => set({ tables: d.tables.includes(id) ? d.tables.filter((t) => t !== id) : sortTables([...d.tables, id]) });

  const save = async () => {
    setTried(true);
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await saveReservation(draft, isNew);
      onSaved(draft.date);
    } catch (err: any) {
      setError(err?.name === "TimeoutError"
        ? (en ? "No response from the server. It is saved on this device and will be sent when the internet is back. Tap Save again to check." : "เซิร์ฟเวอร์ไม่ตอบ บันทึกไว้ในเครื่องแล้ว จะส่งเองเมื่อเน็ตกลับมา กดบันทึกอีกครั้งเพื่อเช็ค")
        : (en ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full h-11 bg-background border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary";
  const L = RESERVATION_LIMITS;
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end sm:items-center justify-center sm:px-4" onClick={onClose}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md border border-border shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-foreground font-semibold">{isNew ? (en ? "New reservation" : "จองโต๊ะ") : (en ? "Edit reservation" : "แก้ไขการจอง")}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-foreground mb-1">{en ? "Name *" : "ชื่อผู้จอง *"}</span>
            <input value={d.name} maxLength={L.name} onChange={(e) => set({ name: e.target.value })} className={input} autoFocus={isNew} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1">{en ? "Date *" : "วันที่ *"}</span>
              <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className={input} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1">{en ? "Start time *" : "เวลาเริ่ม *"}</span>
              <input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} className={input} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1">{en ? "Phone" : "เบอร์โทร"}</span>
              <input type="tel" inputMode="tel" value={d.phone ?? ""} maxLength={L.phone} onChange={(e) => set({ phone: e.target.value })} className={input} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1">{en ? "Party size" : "จำนวนคน"}</span>
              <input type="number" inputMode="numeric" min={1} max={L.partySize} value={party} onChange={(e) => setParty(e.target.value)} className={input} />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-foreground mb-1">{en ? "Note" : "หมายเหตุ"}</span>
            <textarea value={d.note ?? ""} maxLength={L.note} rows={2} onChange={(e) => set({ note: e.target.value })} className={`${input} h-auto py-2 resize-none`} />
          </label>

          <div>
            <span className="block text-xs font-medium text-foreground mb-1.5">{en ? "Tables *" : "โต๊ะ *"}</span>
            <div className="flex flex-wrap gap-1.5">
              {TABLE_GROUPS.flatMap((g) => g.tables).map((tb) => {
                const on = d.tables.includes(tb.id);
                return (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => toggleTable(tb.id)}
                    aria-pressed={on}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:bg-muted"}`}
                  >
                    {tableShort(tb.id, lang)}
                  </button>
                );
              })}
            </div>
          </div>

          {conflicts.length > 0 && (
            <div role="status" className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-500/15 px-3 py-2.5 text-xs text-foreground">
              <p className="font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle size={14} className="text-amber-600" />{en ? "Close to another booking (under 2 h)" : "ใกล้กับการจองอื่น (ห่างไม่ถึง 2 ชม.)"}</p>
              <ul className="space-y-0.5">
                {conflicts.map((c) => (
                  <li key={`${c.table}-${c.other.id}`}>
                    {tableTitle(c.table, lang)}: {c.other.time} {c.other.name}
                    <span className="text-muted-foreground"> · {en ? `${c.gapMinutes} min apart` : `ห่าง ${c.gapMinutes} นาที`}</span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1">{en ? "You can still save." : "ยังบันทึกได้ตามปกติ"}</p>
            </div>
          )}

          {tried && invalid && <p role="alert" className="text-xs text-destructive">{en ? invalid.en : invalid.th}</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border hover:bg-muted">{en ? "Cancel" : "ยกเลิก"}</button>
            <button onClick={save} disabled={saving} className="flex-[2] py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 size={15} className="animate-spin" />}
              {en ? "Save" : "บันทึก"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
