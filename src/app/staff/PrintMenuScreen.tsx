import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer } from "lucide-react";
import logoImg from "../../assets/logo-black.png";
import type { Category, Language, MenuItem } from "../types";
import { buildPrintMenu, packMenu, type PackPage, type PrintItem, type PrintSection, type PrintSet } from "../printMenu";

// ─── หน้า "พิมพ์เมนู" — เมนูกระดาษ A4 สำหรับลูกค้าที่สั่งกับพนักงาน (ดู printMenu.ts) ───
// แสดงตัวอย่างบนจอ = หน้าที่จะพิมพ์จริง (portal ไปที่ body: ตอนพิมพ์ซ่อนแอปทั้งหมด เหลือแค่หน้ากระดาษ)
// จัดหน้า: วัดความสูงหัวหมวด/แต่ละเมนูจากหน้ากระดาษจำลองที่ซ่อนไว้ (ฟอนต์โหลดเสร็จแล้ว) แล้วให้ packMenu แบ่งคอลัมน์/หน้า
// แอป Android (WebView) สั่งพิมพ์ไม่ได้ — ดูตัวอย่างได้ ปุ่มพิมพ์ให้ไปใช้เบราว์เซอร์แทน
const IS_APP = import.meta.env.MODE === "capacitor";
const COLUMNS = 2;
const PAGE_PX = 794; // 210mm ที่ 96dpi — ใช้ย่อตัวอย่างให้พอดีจอ
// แบบจัดหน้าที่ลอง (เรียงจากโปร่งสุด) — เลือกแบบแรกที่ได้จำนวนหน้าน้อยสุด เช่น อาหาร 3 → 2 หน้า (พิมพ์หน้า-หลังแผ่นเดียว)
// ชื่ออังกฤษ "ถ้าพอที่" = ลองทั้งมีและไม่มี (ตัดเฉพาะตอนที่ช่วยลดหน้า) | "แสดงเสมอ" / "ไม่แสดง" = ลองแค่แบบนั้น
type EnMode = "auto" | "on" | "off";
interface Variant { density: string; en: boolean }
const variantsFor = (mode: EnMode): Variant[] => [
  ...(mode !== "off" ? [{ density: "", en: true }, { density: "pm-dense", en: true }] : []),
  ...(mode !== "on" ? [{ density: "", en: false }, { density: "pm-dense", en: false }] : []),
];

const SET_TITLES: Record<PrintSet, { th: string; en: string }> = {
  food: { th: "เมนูอาหาร", en: "Food Menu" },
  drinks: { th: "เครื่องดื่ม", en: "Drinks" },
};

const CSS = `
.pm-root { position: fixed; inset: 0; z-index: 100; background: #E6D5BA; overflow-y: auto; color: #3C2414; font-family: 'Sarabun', sans-serif; }
.pm-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
.pm-stack { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 8px 40px; }
.pm-page { width: 210mm; height: 296mm; background: #fff; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 2px 12px rgba(60,36,20,.25); flex-shrink: 0; }
.pm-band { height: 2.2mm; flex-shrink: 0; background: linear-gradient(90deg, #C05A25 0%, #D07E35 30%, #4A6741 50%, #D07E35 70%, #C05A25 100%); }
.pm-inner { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8mm 13mm 5mm; }
.pm-hero { display: flex; align-items: center; gap: 5mm; padding-bottom: 4mm; margin-bottom: 4mm; border-bottom: 0.6mm solid #3C2414; }
.pm-hero img { width: 25mm; height: auto; }
.pm-hero .pm-store { font-size: 15px; font-weight: 600; color: #8B6A4A; letter-spacing: .02em; }
.pm-hero .pm-title { font-size: 34px; font-weight: 700; line-height: 1.4; color: #3C2414; }
.pm-hero .pm-title-en { font-family: 'Fraunces', serif; font-size: 16px; font-style: italic; color: #C05A25; }
.pm-hero .pm-unit { margin-left: auto; align-self: flex-end; font-size: 12px; color: #8B6A4A; text-align: right; }
.pm-mini { display: flex; align-items: baseline; gap: 3mm; padding-bottom: 2.5mm; margin-bottom: 4mm; border-bottom: 0.4mm solid #3C2414; }
.pm-mini b { font-size: 18px; }
.pm-mini span { font-size: 12px; color: #8B6A4A; }
.pm-cols { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(${COLUMNS}, minmax(0, 1fr)); column-gap: 10mm; align-items: start; }
.pm-head { padding-top: 4.5mm; padding-bottom: 1.2mm; border-bottom: 0.35mm solid #D07E35; display: flex; align-items: baseline; gap: 2.5mm; }
.pm-col > .pm-piece:first-child .pm-head { padding-top: 0; }
.pm-head b { font-size: 21px; font-weight: 700; color: #C05A25; line-height: 1.3; }
.pm-head span { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8B6A4A; }
.pm-head i { font-style: normal; font-size: 12px; color: #8B6A4A; }
.pm-item { display: flex; align-items: flex-start; gap: 3mm; padding: 1.7mm 0; border-bottom: 0.25mm dotted rgba(60,36,20,.3); }
.pm-name { flex: 1; min-width: 0; }
.pm-th { font-size: 17px; font-weight: 600; line-height: 1.3; }
.pm-en { font-size: 11px; line-height: 1.3; color: #8B6A4A; }
.pm-extra { font-size: 12.5px; line-height: 1.35; color: #4A6741; font-weight: 500; margin-top: .3mm; }
.pm-price { flex-shrink: 0; max-width: 46%; text-align: right; font-size: 18px; font-weight: 700; color: #C05A25; line-height: 1.3; font-variant-numeric: tabular-nums; }
.pm-var { font-size: 14px; line-height: 1.45; }
.pm-var span { font-weight: 500; color: #3C2414; margin-right: 1.5mm; }
.pm-var b { font-size: 16px; font-weight: 700; color: #C05A25; }
.pm-foot { flex-shrink: 0; padding-top: 3mm; display: flex; justify-content: space-between; font-size: 10.5px; color: #8B6A4A; }
/* แบบแน่น — ใช้เมื่อช่วยให้จำนวนหน้าลดลงเท่านั้น (ดู DENSITIES) */
.pm-dense .pm-hero { padding-bottom: 3mm; margin-bottom: 3mm; }
.pm-dense .pm-hero img { width: 20mm; }
.pm-dense .pm-hero .pm-title { font-size: 30px; line-height: 1.35; }
.pm-dense .pm-head { padding-top: 3.2mm; padding-bottom: 1mm; }
.pm-dense .pm-head b { font-size: 19px; }
.pm-dense .pm-item { padding: 1.05mm 0; }
.pm-dense .pm-th { font-size: 16px; line-height: 1.25; }
.pm-dense .pm-en { font-size: 10.5px; line-height: 1.25; }
.pm-dense .pm-extra { font-size: 12px; line-height: 1.3; }
.pm-dense .pm-price { font-size: 17px; line-height: 1.25; }
.pm-dense .pm-var { font-size: 13.5px; line-height: 1.35; }
.pm-dense .pm-var b { font-size: 15px; }
.pm-measure { position: fixed; left: -10000px; top: 0; visibility: hidden; pointer-events: none; }
.pm-bar { position: sticky; top: 0; z-index: 2; background: #3C2414; color: #FFF8F0; padding: 10px 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
@media print {
  @page { size: A4; margin: 0; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.pm-root) { display: none !important; }
  .pm-root { position: static !important; overflow: visible !important; background: none !important; }
  .pm-noprint, .pm-measure { display: none !important; }
  .pm-zoom { zoom: 1 !important; }
  .pm-stack { display: block !important; padding: 0 !important; }
  .pm-page { box-shadow: none !important; break-after: page; page-break-after: always; }
  .pm-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

function SectionHead({ s, cont }: { s: PrintSection; cont: boolean }) {
  return (
    <div className="pm-head">
      <b>{s.nameTh}</b>
      {s.nameEn && <span>{s.nameEn}</span>}
      {cont && <i>(ต่อ)</i>}
    </div>
  );
}

function ItemRow({ item, showEn }: { item: PrintItem; showEn: boolean }) {
  return (
    <div className="pm-item">
      <div className="pm-name">
        <div className="pm-th">{item.nameTh}</div>
        {showEn && item.nameEn && <div className="pm-en">{item.nameEn}</div>}
        {item.extras.length > 0 && <div className="pm-extra">เพิ่ม: {item.extras.join(" · ")}</div>}
      </div>
      <div className="pm-price">
        {item.price !== null
          ? item.price
          : item.variants.map((v) => <div key={v.label} className="pm-var"><span>{v.label}</span><b>{v.price}</b></div>)}
      </div>
    </div>
  );
}

function PageFrame({ first, title, foot, children }: {
  first: boolean;
  title: { th: string; en: string };
  foot?: { left: string; right: string };
  children: React.ReactNode;
}) {
  return (
    <div className="pm-page">
      <div className="pm-band" />
      <div className="pm-inner">
        {first ? (
          <div className="pm-hero">
            <img src={logoImg} alt="" />
            <div>
              <div className="pm-store">ครัวเฮือนยอง · Hueanyong Kitchen</div>
              <div className="pm-title">{title.th}</div>
              <div className="pm-title-en">{title.en}</div>
            </div>
            <div className="pm-unit">ราคาเป็นบาท<br />Prices in THB</div>
          </div>
        ) : (
          <div className="pm-mini"><b>{title.th}</b><span>{title.en} · ครัวเฮือนยอง</span></div>
        )}
        <div className="pm-cols">{children}</div>
        <div className="pm-foot"><span>{foot?.left ?? " "}</span><span>{foot?.right ?? ""}</span></div>
      </div>
      <div className="pm-band" />
    </div>
  );
}

export function PrintMenuScreen({ lang, categories, items, onClose }: {
  lang: Language;
  categories: Category[];
  items: MenuItem[]; // ผ่าน normalizeMenuItem แล้ว (รวมที่ซ่อน — printMenu ตัดออกเอง)
  onClose: () => void;
}) {
  const en = lang === "en";
  const [set, setSet] = useState<PrintSet>("food");
  const [enMode, setEnMode] = useState<EnMode>("auto");
  const variants = useMemo(() => variantsFor(enMode), [enMode]);
  const [fontsReady, setFontsReady] = useState(false);
  const [layout, setLayout] = useState<{ pages: PackPage[]; density: string; en: boolean } | null>(null);
  const pages = layout?.pages ?? null;
  const [zoom, setZoom] = useState(1);
  const measureRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const menu = useMemo(() => buildPrintMenu(categories, items), [categories, items]);
  const sections = menu[set];
  const title = set === "drinks" && sections.some((s) => s.nameTh.startsWith("ของฝาก"))
    ? { th: "เครื่องดื่ม & ของฝาก", en: "Drinks & Souvenirs" }
    : SET_TITLES[set];
  const printedOn = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

  useEffect(() => {
    let cancelled = false;
    (document.fonts?.ready ?? Promise.resolve()).then(() => { if (!cancelled) setFontsReady(true); });
    return () => { cancelled = true; };
  }, []);

  // วัดจากหน้ากระดาษจำลอง: ความจุคอลัมน์หน้าแรก/หน้าถัดไป + ความสูงหัวหมวดและแต่ละเมนู → แบ่งหน้า
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root || !fontsReady) return;
    const h = (el: Element | null) => (el ? el.getBoundingClientRect().height : 0);
    const options = variants.map((v, vi) => {
      const box = root.querySelector(`[data-variant="${vi}"]`);
      if (!box) return { ...v, pages: [] as PackPage[] };
      const capFirst = h(box.querySelector("[data-cap=first] .pm-cols"));
      const capNext = h(box.querySelector("[data-cap=next] .pm-cols"));
      const packed = sections.map((_, si) => ({
        heading: h(box.querySelector(`[data-sec="${si}"] .pm-head`)),
        items: [...box.querySelectorAll(`[data-sec="${si}"] .pm-item`)].map(h),
      }));
      return { ...v, pages: packMenu(packed, (p) => Math.floor((p === 0 ? capFirst : capNext) - 2), COLUMNS) };
    });
    setLayout(options.reduce((best, o) => (o.pages.length < best.pages.length ? o : best)));
  }, [sections, variants, fontsReady]);

  // ย่อตัวอย่างให้พอดีความกว้างจอ (ตอนพิมพ์ CSS ตั้ง zoom กลับเป็น 1)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - 16) / PAGE_PX));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const print = () => window.print();

  return createPortal(
    <div className="pm-root" ref={rootRef}>
      <style>{CSS}</style>
      <div className="pm-bar pm-noprint">
        <button onClick={onClose} className="flex items-center gap-1 text-sm font-semibold text-[#E6D5BA] hover:text-white">
          <ArrowLeft size={18} />{en ? "Back" : "กลับ"}
        </button>
        <div className="flex gap-1 bg-white/10 p-1 rounded-xl" role="tablist">
          {(["food", "drinks"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={set === k}
              onClick={() => setSet(k)}
              className={`px-3 min-h-[36px] rounded-lg text-sm font-semibold ${set === k ? "bg-[#FFF8F0] text-[#3C2414]" : "text-[#E6D5BA]"}`}
            >
              {k === "food" ? (en ? "Food" : "อาหาร") : (en ? "Drinks & souvenirs" : "เครื่องดื่ม/ของฝาก")}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-[#E6D5BA]">
          {en ? "English names" : "ชื่ออังกฤษ"}
          <select
            value={enMode}
            onChange={(e) => setEnMode(e.target.value as EnMode)}
            className="bg-white/10 text-[#FFF8F0] rounded-lg px-2 min-h-[36px] text-sm outline-none [&>option]:text-[#3C2414]"
          >
            <option value="auto">{en ? "If there's room" : "ถ้าพอที่"}</option>
            <option value="on">{en ? "Always" : "แสดงเสมอ"}</option>
            <option value="off">{en ? "Off" : "ไม่แสดง"}</option>
          </select>
        </label>
        <button
          onClick={print}
          disabled={IS_APP || !pages}
          className="ml-auto flex items-center gap-1.5 bg-[#C05A25] hover:bg-[#C05A25]/90 disabled:opacity-50 text-white px-4 min-h-[40px] rounded-xl text-sm font-semibold"
        >
          <Printer size={16} />
          {en ? `Print (${pages?.length ?? "–"} pages)` : `พิมพ์ (${pages?.length ?? "–"} หน้า)`}
        </button>
        <p className="w-full text-xs text-[#E6D5BA]/80 leading-snug">
          {IS_APP
            ? (en ? "The Android app can't print A4 — open the staff page in a browser (computer/iPad) to print. Preview only."
              : "แอป Android พิมพ์ A4 ไม่ได้ — เปิดหน้าพนักงานในเบราว์เซอร์ (คอม/iPad) แล้วกดพิมพ์ ตรงนี้ดูตัวอย่างได้อย่างเดียว")
            : (en ? "In the print dialog: paper A4 · scale 100% (not “fit”) · turn off headers & footers"
              : "ตอนสั่งพิมพ์: กระดาษ A4 · ขนาด 100% (ไม่ย่อให้พอดี) · ปิดหัว/ท้ายกระดาษ")}
          {" · "}
          {en ? "Prices come from the menu in the app; hidden items are left out." : "ราคาดึงจากเมนูในระบบ เมนูที่ซ่อนไม่แสดง"}
        </p>
      </div>

      {/* หน้ากระดาษจำลองสำหรับวัด (ไม่แสดง/ไม่พิมพ์) */}
      <div className="pm-measure" ref={measureRef} aria-hidden>
        {variants.map((v, vi) => (
          <div key={vi} data-variant={vi} className={v.density}>
            <div data-cap="first"><PageFrame first title={title}><div /></PageFrame></div>
            <div data-cap="next"><PageFrame first={false} title={title}><div /></PageFrame></div>
            <PageFrame first title={title}>
              <div className="pm-col">
                {sections.map((s, si) => (
                  <div key={s.id} data-sec={si} className="pm-piece">
                    <SectionHead s={s} cont={false} />
                    {s.items.map((it) => <ItemRow key={it.id} item={it} showEn={v.en} />)}
                  </div>
                ))}
              </div>
            </PageFrame>
          </div>
        ))}
      </div>

      <div className={`pm-stack pm-zoom ${layout?.density ?? ""}`} style={{ zoom }}>
        {sections.length === 0 && (
          <p className="pm-noprint text-sm text-[#3C2414] py-10">{en ? "No menu items in this set" : "ไม่มีเมนูในชุดนี้"}</p>
        )}
        {pages?.map((page, pi) => (
          <PageFrame
            key={pi}
            first={pi === 0}
            title={title}
            foot={{ left: `ราคา ณ ${printedOn}`, right: pages.length > 1 ? `หน้า ${pi + 1}/${pages.length}` : "" }}
          >
            {page.map((col, ci) => (
              <div key={ci} className="pm-col">
                {col.map((piece) => {
                  const s = sections[piece.section];
                  return (
                    <div key={`${piece.section}-${piece.from}`} className="pm-piece">
                      <SectionHead s={s} cont={piece.cont} />
                      {s.items.slice(piece.from, piece.to).map((it) => <ItemRow key={it.id} item={it} showEn={layout?.en ?? true} />)}
                    </div>
                  );
                })}
              </div>
            ))}
          </PageFrame>
        ))}
      </div>
    </div>,
    document.body,
  );
}
