// ─── Native Bluetooth Printing (Capacitor Android app only) ───────────────────
//
// Renders the same content as the old KitchenTicket/ReceiptTicket JSX (since
// removed from ticket.tsx — see git history) but as
// ESC/POS builder commands sent straight to the paired thermal printer, instead
// of window.print() + the OS print dialog. Only usable inside the Capacitor
// Android build — isNativePrintAvailable() must be checked before calling
// anything else here, since on the plain web build (gh-pages) the underlying
// plugin has no web implementation and every call would reject.
//
// REAL-HARDWARE TEST RESULTS (POS-5890U-L):
// - Bluetooth connect + print: CONFIRMED WORKING, including the bundled Rongta
//   RTPrinter SDK against this non-Rongta (ZJiang-family) printer over Classic
//   Bluetooth SPP.
// - Thai text: initially came out as accented Latin characters — fixed, see
//   THAI_CODEPAGE_N below. Confirmed correct via printThaiCodepageSweep().
// - bold()/doubleWidth()/doubleHeight() (2026-09-22): confirmed dead for our
//   content. Root cause (read straight from the plugin's Java source,
//   CapacitorThermalPrinterPlugin.java): those builder methods only set flags
//   on a `textSetting` object, and that object is ONLY ever read inside
//   `text()`'s call to `cmd.getTextCmd(textSetting, text, "UTF-8")`. Since we
//   bypass `.text()` entirely for Thai content (it hardcodes UTF-8 — see
//   below) and send everything through `.raw()` instead, `textSetting` is
//   never consulted and every one of those formatting calls is a silent no-op
//   for us — text always prints at normal size/weight regardless of what we
//   called. `.align()`/`.cutPaper()`/`.feedCutPaper()` are NOT affected: they
//   append their own ESC/POS bytes immediately when called, independent of
//   text()/raw(), which is exactly why alignment worked fine while size/bold
//   silently didn't. Fix: stop relying on the builder's flag methods for
//   formatting entirely — send the raw ESC/POS bytes for size (GS ! n) and
//   bold (ESC E n) ourselves, in the same byte stream as the text, the same
//   way THAI_CODEPAGE_N's ESC t n already has to be.
// - Size command (2026-09-22): confirmed via printSizeCommandSweep() that
//   GS ! n works on this printer — ESC ! turned out unnecessary. Design
//   settled on uniform sizing per ticket rather than a size hierarchy: the
//   whole kitchen ticket prints at GS ! 0x11 (width+height x2, SIZE_DOUBLE)
//   so it's legible from across the kitchen, the whole receipt stays at
//   normal size (SIZE_NORMAL). Content/wording/line order in both functions
//   match the old KitchenTicket/ReceiptTicket JSX exactly — only bold
//   (matching each JSX block's fontWeight) and this uniform size differ from
//   plain text.

import { Capacitor } from "@capacitor/core";
import { CapacitorThermalPrinter } from "capacitor-thermal-printer";
import type { CartItem, Language, Order } from "../types";
import { T } from "../translations";
import { liveItems, cartItemTotal, formatOptionDetails } from "../utils";
import { kitchenOptionSummary, type ReceiptData } from "./ticket";
import { getSelectedPrinter } from "./printerStore";

// characters per printed line at Font A, normal (1x) width, on 58mm paper.
// Reduced from an initial guess of 32 after real hardware testing showed both
// dashed separator lines and long price lines wrapping their tail characters
// onto a second physical line — 30 leaves a safety margin against that.
const LINE_WIDTH = 30;
// ตั๋วครัวทั้งใบพิมพ์ที่ GS! 0x10 (กว้าง x2) ตัวอักษรแต่ละตัวเลยกว้างเป็น 2 เท่า จำนวนตัวอักษร
// ที่พอดีความกว้างกระดาษจริงต่อบรรทัดจึงลดลงครึ่งหนึ่ง — ใช้ค่านี้เฉพาะกับเส้นคั่นของตั๋วครัว
// ไม่งั้นเส้นคั่นที่คำนวณความยาวไว้สำหรับตัวอักษรขนาดปกติจะกว้างเกินกระดาษจริงเท่าตัว แล้ว wrap
// ไปพิมพ์ต่อบรรทัดใหม่ ทำให้ดูเหมือนมีเส้นคั่นซ้ำกันสองบรรทัดติดกัน
const KITCHEN_LINE_WIDTH = Math.floor(LINE_WIDTH / 2);

export function isNativePrintAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

// ─── Thai (TIS-620) text encoding ──────────────────────────────────────────
//
// capacitor-thermal-printer's .text() hardcodes UTF-8 on the Android side
// (CapacitorThermalPrinterPlugin.text(): cmd.getTextCmd(textSetting, text,
// "UTF-8") — no way to override through the builder API). This printer
// expects a single-byte codepage table (TIS-620-style), not UTF-8 multi-byte
// sequences, which is exactly why Thai text came out as accented Latin
// characters on the real hardware test: each UTF-8 continuation byte got
// rendered as its own glyph from whatever Western table the printer defaults
// to. Fix: never call .text() with anything that might contain Thai — encode
// to TIS-620 ourselves and send raw bytes preceded by an ESC t codepage-select
// command instead.

// Confirmed on real hardware via printThaiCodepageSweep() — n=255 is the
// ESC t table this POS-5890U-L firmware reads as Thai/TIS-620.
const THAI_CODEPAGE_N = 255;

// TIS-620 mirrors Unicode's Thai block (U+0E01–U+0E5B) shifted down by a fixed
// offset — this is the same relationship for every character in the block,
// including tone marks, vowels, digits and the baht sign (฿ U+0E3F → 0xDF).
// Anything below U+0080 (ASCII: digits, Latin letters, punctuation, "\n") is
// identical in TIS-620 and UTF-8/ASCII, so it round-trips unchanged.
function encodeTis620(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp >= 0x0e01 && cp <= 0x0e5b) {
      bytes.push(cp - 0x0d60);
    } else {
      bytes.push(0x3f); // '?' — anything unmappable (shouldn't happen for our ticket content)
    }
  }
  return bytes;
}

function selectCodepageCmd(n: number): number[] {
  return [0x1b, 0x74, n & 0xff]; // ESC t n — select character code table
}

function thaiRaw(text: string): number[] {
  return encodeTis620(text);
}

// Drop-in replacement for `builder.text(str)` that survives Thai content.
// Callers still get the same chainable builder back.
function thaiText(builder: typeof CapacitorThermalPrinter, text: string): typeof CapacitorThermalPrinter {
  return builder.raw(thaiRaw(text));
}

// ─── Text size / weight — sent as raw ESC/POS bytes, not via the builder's
// bold()/doubleWidth()/doubleHeight() (see the top-of-file note: those are
// dead for anything sent through .raw()). Both commands are near-universal
// across ESC/POS-compatible firmware (Epson standard), unlike the Thai
// codepage table which is vendor-specific — no sweep result needed to trust
// these, but printSizeCommandSweep() exists below to double check on this
// exact printer if either turns out not to be honored.
//
// GS ! n (0x1D 0x21 n) — select character size. Low nibble = height
// multiplier - 1, high nibble = width multiplier - 1 (each 1-8x). Confirmed
// working on the real POS-5890U-L via printSizeCommandSweep() — ESC ! (the
// other candidate family) turned out unnecessary, GS ! alone is enough.
function sizeCmd(widthMult: number, heightMult: number): number[] {
  const w = Math.min(Math.max(Math.round(widthMult), 1), 8) - 1;
  const h = Math.min(Math.max(Math.round(heightMult), 1), 8) - 1;
  return [0x1d, 0x21, (w << 4) | h];
}
const SIZE_NORMAL = sizeCmd(1, 1);
const SIZE_WIDE = sizeCmd(2, 1); // width x2 only — GS ! 0x10, used uniformly on the kitchen ticket

// ESC E n (0x1B 0x45 n) — select/cancel emphasized (bold) mode.
function boldCmd(on: boolean): number[] {
  return [0x1b, 0x45, on ? 1 : 0];
}

// GS B n (0x1D 0x42 n) — select/cancel white-on-black reverse (inverse video).
function inverseCmd(on: boolean): number[] {
  return [0x1d, 0x42, on ? 1 : 0];
}

// ESC - n (0x1B 0x2D n) — select/cancel underline mode (n=1: 1-dot, we only use on/off).
function underlineCmd(on: boolean): number[] {
  return [0x1b, 0x2d, on ? 1 : 0];
}

// UNCONFIRMED — inverse video (GS B) has never been tested on the real
// POS-5890U-L. printInverseTest() below prints both this and the bold
// fallback side by side so it can be confirmed on real hardware; flip this
// to false if inverse turns out not to render correctly.
//
// Applies to the "selectable options" group only — kitchenOptionSummary()
// and ci.customNote (a menu-specific add-on, distinct from the standalone
// Add-on line item). ci.note gets its own dedicated plain underline instead
// (see underlineCmd() below, used directly where ci.note prints) — the
// fallback here is bold-only, deliberately NOT bold+underline, so it can
// never visually collide with ci.note's underline and become ambiguous
// about which line is which.
const USE_INVERSE_FOR_NOTES = true;

function groupEmphasisOnCmd(): number[] {
  return USE_INVERSE_FOR_NOTES ? inverseCmd(true) : boldCmd(true);
}
function groupEmphasisOffCmd(): number[] {
  return USE_INVERSE_FOR_NOTES ? inverseCmd(false) : boldCmd(false);
}

// ─── Word-aware line wrapping (with a grapheme-safe fallback) ──────────────
//
// Real hardware tests found two distinct classes of Thai wrapping bugs, from
// worse to less bad:
// 1. A leading vowel (เ/แ/โ/ใ/ไ — these precede the consonant they belong to
//    in both storage and print order) got separated from its consonant onto
//    a different line — happened twice, with โ in "โครงหมู" and separately
//    with เ in "เงี้ยว". A pure grapheme-cluster split (Unicode UAX#29) does
//    NOT protect against this: a leading vowel is its own independent
//    grapheme cluster, not bound to the following consonant, so splitting at
//    cluster boundaries alone still allows this exact failure.
// 2. Even with no character actually lost, splitting mid-word ("โคร" / "งหมู"
//    instead of keeping "โครง" together) reads wrong to a Thai reader.
//
// Both are fixed by wrapping at WORD boundaries first — Intl.Segmenter's
// "word" granularity uses ICU's dictionary-based Thai segmentation (built
// into Android WebView/Chrome/Node, same engine, no dependency needed) to
// find real lexical words ("ขนมจีน", "น้ำ", "เงี้ยว", "ซี่โครง", "หมู", ...),
// where a leading vowel is already glued to its consonant as one word. We
// then lay words onto lines the same way normal English word-wrap does:
// keep adding whole words while they fit, start a new line when one doesn't.
//
// The one remaining edge case: a single "word" that's on its own longer than
// an entire empty line (a very long compound name, or non-Thai text with no
// spaces). For that — and only that — we fall back to splitting mid-word at
// grapheme-cluster boundaries, still gluing any leading vowel to the cluster
// right after it before measuring, so even the fallback can't strand one.
function wordSegments(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function graphemeClusters(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

const LEADING_VOWELS = new Set(["เ", "แ", "โ", "ใ", "ไ"]);

// Grapheme clusters, but with any leading vowel merged into a single unit
// with the cluster right after it — used only by the mid-word fallback below,
// so even that last resort can never split a leading vowel from its consonant.
function graphemeUnitsGluingLeadingVowels(text: string): string[] {
  const clusters = graphemeClusters(text);
  const units: string[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (LEADING_VOWELS.has(clusters[i]) && i + 1 < clusters.length) {
      units.push(clusters[i] + clusters[i + 1]);
      i++;
    } else {
      units.push(clusters[i]);
    }
  }
  return units;
}

// Fallback: splits a single overlong "word" into <=maxWidth-character chunks,
// breaking only between grapheme units (leading-vowel-glued, see above).
function wrapByGrapheme(text: string, maxWidth: number): string[] {
  const units = graphemeUnitsGluingLeadingVowels(text);
  const lines: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current.length > 0 && current.length + unit.length > maxWidth) {
      lines.push(current);
      current = unit;
    } else {
      current += unit;
    }
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

// Main entry point: word-wrap first, mid-word grapheme fallback only when a
// single word can't fit an empty line by itself.
function wrapLine(text: string, maxWidth: number): string[] {
  const words = wordSegments(text);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxWidth) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      const pieces = wrapByGrapheme(word, maxWidth);
      for (let i = 0; i < pieces.length - 1; i++) lines.push(pieces[i]);
      current = pieces[pieces.length - 1] ?? "";
      continue;
    }
    if (current.length + word.length > maxWidth) {
      lines.push(current);
      // เริ่มบรรทัดใหม่ — ถ้าคำที่ล้นมาเป็นแค่ช่องว่างเฉยๆ (จาก word segmenter ที่แยก
      // space เป็น token ของตัวเอง) ก็ตัดทิ้งไปเลย กันบรรทัดใหม่ขึ้นต้นด้วยช่องว่าง
      current = word.trim().length === 0 ? "" : word;
      continue;
    }
    current += word;
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

// Grapheme-cluster-safety for padLine()'s truncation below — a plain .slice()
// there would reintroduce the identical "split mid-cluster" bug for a long
// item name on the receipt (2-column layout truncates the name to make room
// for the price). Uses the same leading-vowel-glued units as the fallback
// above so a truncated name can't end on a stranded leading vowel either.
function truncateGraphemes(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const units = graphemeUnitsGluingLeadingVowels(text);
  let result = "";
  for (const unit of units) {
    if (result.length + unit.length > maxLen) break;
    result += unit;
  }
  return result;
}

function padLine(left: string, right: string, width = LINE_WIDTH): string {
  const rightStr = right;
  const maxLeft = Math.max(1, width - rightStr.length - 1);
  const leftStr = left.length > maxLeft ? truncateGraphemes(left, maxLeft) : left;
  const gap = Math.max(1, width - leftStr.length - rightStr.length);
  return leftStr + " ".repeat(gap) + rightStr;
}

async function ensurePrinterConnected(): Promise<void> {
  const printer = getSelectedPrinter();
  if (!printer) {
    throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์สำหรับเครื่องนี้ (ตั้งค่าได้ที่ปุ่มเครื่องพิมพ์ในหัวข้อ)");
  }
  const connected = await CapacitorThermalPrinter.isConnected();
  if (connected) return;

  const device = await CapacitorThermalPrinter.connect({ address: printer.address });
  if (!device) {
    throw new Error(`เชื่อมต่อเครื่องพิมพ์ "${printer.name}" ไม่สำเร็จ — ตรวจสอบว่าเปิดเครื่องพิมพ์และจับคู่ Bluetooth ไว้แล้ว`);
  }
}

export async function printKitchenTicketNative(order: Order, lang: Language): Promise<void> {
  const t = T[lang];
  await ensurePrinterConnected();

  // เลิกพิมพ์คำว่า "โต๊ะ" นำหน้าแล้ว (เคยพยายามแก้ปัญหาบรรทัดนี้แตก/จัดวางไม่สวยหลายรอบ
  // ไม่คุ้ม) เหลือแค่เลขโต๊ะเดี่ยวๆ ที่ SIZE_WIDE เหมือนเดิม — ออเดอร์ takeaway ไม่กระทบ
  // เพราะ takeawayLabel (เช่น "T-3") ไม่มีคำว่า "โต๊ะ" นำหน้าอยู่แล้วตั้งแต่ต้น
  const label = order.isTakeaway
    ? order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน")
    : order.tableNumber;

  // ตั๋วครัวทั้งใบขยาย GS! 0x10 (กว้าง x2 อย่างเดียว ไม่ขยายความสูง) เท่ากันหมด ไม่มีบรรทัดไหน
  // ใหญ่กว่ากัน — ยืนยันจาก printSizeCommandSweep() ว่า GS! ใช้ได้จริงบนเครื่องนี้ ตัวหนา/ไม่หนา
  // ยังคงตามต้นฉบับ (bold เฉพาะ label/ชื่อรายการ/customNote — ตรงกับ fontWeight:700 ใน
  // KitchenTicket JSX เดิม) ไม่พิมพ์ชื่อร้านที่หัวใบแล้ว เนื้อหา/ลำดับ/ข้อความส่วนที่เหลือ
  // ให้ตรงกับ JSX เดิมเป๊ะ — เส้นคั่นใช้ KITCHEN_LINE_WIDTH (ครึ่งหนึ่งของ LINE_WIDTH) เพราะ
  // ตัวอักษรกว้างเป็น 2 เท่า ถ้าใช้ LINE_WIDTH เต็มจะยาวเกินกระดาษจริงแล้ว wrap ไปอีกบรรทัด
  // ดูเหมือนมีเส้นคั่นซ้ำสองบรรทัด
  const builder = CapacitorThermalPrinter.begin().raw(selectCodepageCmd(THAI_CODEPAGE_N));
  // ขอบบนก่อนเนื้อหาบรรทัดแรก — ต้นฉบับ KitchenTicket JSX เดิม (ลบไปแล้ว) เว้นไว้
  // <div style={{ height: "30mm" }} /> ก่อนเริ่มเนื้อหา ไม่มีสูตรแปลง mm เป็นจำนวนบรรทัด
  // กระดาษความร้อนตรงเป๊ะ (ขึ้นกับ DPI/font ของเครื่องพิมพ์) — ปรับเพิ่มเป็น 5 บรรทัดว่าง
  // ตามที่แจ้งว่า 2 บรรทัดยังน้อยเกินไป — เว้นตอนขนาดปกติ (ก่อนสั่ง SIZE_WIDE)
  thaiText(builder, "\n\n\n\n\n");
  builder.raw(SIZE_WIDE).align("center").raw(boldCmd(true));
  thaiText(builder, `${label}\n`);
  builder.raw(boldCmd(false));
  // วันที่/เวลา (เช่น "22/9/2569 22:28:42" ~19 ตัวอักษร) ยาวเกิน KITCHEN_LINE_WIDTH (~15
  // ตัว) ที่ SIZE_WIDE — wrapLine() ตัดคำแบบไทยไม่เหมาะกับตัวเลข/เครื่องหมาย "/" เลย ตัด
  // กระจัดกระจาย เปลี่ยนไปพิมพ์ที่ SIZE_NORMAL แทน สั้นพออยู่บรรทัดเดียวได้สบาย ไม่ต้องผ่าน
  // wrapLine() เลย
  //
  // สำคัญ: รวมคำสั่งเปลี่ยนขนาด (GS!) กับ byte ข้อความที่ตามมาเป็น .raw() ครั้งเดียวเสมอ
  // แทนที่จะแยกเรียก .raw(SIZE_X) แล้วค่อย .raw(ข้อความ) เป็นคนละ call — แต่ละ .raw() ถูก
  // คิวแบบ async แยกกันฝั่ง native (ดู plugin.js: callQueue) การเรียกติดกันหลายครั้งตรงจุด
  // เปลี่ยนขนาดพอดีเป็นจุดที่เจอเส้นคั่นกระจัดกระจายจริง — รวมเป็น byte array เดียวส่งทีเดียว
  // ตัดความเป็นไปได้ที่จะมีอะไรมาแทรกกลางระหว่างคำสั่งเปลี่ยนขนาดกับเนื้อหาที่ต้องใช้ขนาดนั้น
  builder.raw([...SIZE_NORMAL, ...thaiRaw(`${order.timestamp.toLocaleString(lang === "th" ? "th-TH" : "en-US")}\n`)]);
  builder.align("left");
  builder.raw([...SIZE_WIDE, ...thaiRaw("-".repeat(KITCHEN_LINE_WIDTH) + "\n")]);

  const items = liveItems(order.items);
  items.forEach((ci: CartItem, idx: number) => {
    const name = lang === "en" ? ci.item.name.en : ci.item.name.th;
    // ระดับ 1 — item.name (รวม "(หมู/ไก่/แหนม)" ถ้ามีในชื่อเมนู เป็น string เดียวแยกไม่ได้
    // ตามที่ยืนยันโครงสร้างข้อมูลแล้ว): ตัวหนา เด่นสุด
    builder.raw(boldCmd(true));
    wrapLine(`${ci.quantity}x ${name}`, KITCHEN_LINE_WIDTH).forEach((line) => {
      thaiText(builder, `${line}\n`);
    });
    builder.raw(boldCmd(false));

    // ระดับ 2 — kitchenOptionSummary() (ตัวเลือกที่ต้องกด: meat/portion/spiceLevel/
    // addEgg/customSelections) กับ ci.customNote (custom add-on ที่ผูกกับเมนูนี้โดยเฉพาะ —
    // คนละอันกับจุดสั่ง Add-on แยกที่ไม่ผูกกับเมนูไหนเลย) จัดเป็นกลุ่มเดียวกัน ครอบด้วย
    // inverse video เท่ากันทั้งคู่
    const opt = kitchenOptionSummary(ci, lang);
    if (opt) {
      builder.raw(groupEmphasisOnCmd());
      wrapLine(`  ${opt}`, KITCHEN_LINE_WIDTH).forEach((line) => thaiText(builder, `${line}\n`));
      builder.raw(groupEmphasisOffCmd());
    }

    // ระดับ 3 — ci.note (หมายเหตุจากลูกค้า): ขีดเส้นใต้แยกเป็นของตัวเอง ไม่ใช้ inverse
    if (ci.note) {
      builder.raw(underlineCmd(true));
      wrapLine(`"${ci.note}"`, KITCHEN_LINE_WIDTH).forEach((line) => thaiText(builder, `${line}\n`));
      builder.raw(underlineCmd(false));
    }

    if (ci.customNote) {
      builder.raw(groupEmphasisOnCmd());
      wrapLine(`+ ${ci.customNote} (+${t.thb}${ci.customAddOnPrice || 0})`, KITCHEN_LINE_WIDTH).forEach((line) => thaiText(builder, `${line}\n`));
      builder.raw(groupEmphasisOffCmd());
    }

    // เว้นบรรทัดว่างระหว่างรายการ กันสับสนว่ารายการไหนจบ/เริ่มใหม่ — ไม่เว้นหลังรายการ
    // สุดท้ายเพราะมีเส้นคั่นปิดท้ายอยู่แล้ว
    if (idx < items.length - 1) thaiText(builder, "\n");
  });

  thaiText(builder, "-".repeat(KITCHEN_LINE_WIDTH) + "\n");
  builder.feedCutPaper();

  await builder.write();
}

export async function printReceiptNative(data: ReceiptData, lang: Language): Promise<void> {
  const t = T[lang];
  await ensurePrinterConnected();
  const now = new Date();
  const change = data.paymentMethod === "cash" && data.cashReceived != null ? data.cashReceived - data.total : undefined;

  // ใบเสร็จทั้งใบใช้ขนาดปกติ GS! 0x00 เท่ากันหมด ไม่ขยายเลยแม้แต่บรรทัดเดียว — ส่ง SIZE_NORMAL
  // ไว้ตอนต้นเผื่อ session ก่อนหน้า (เช่นพิมพ์ตั๋วครัวที่ตั้ง GS!0x11 ไว้บนการเชื่อมต่อเดิม)
  // ยังไม่ reset กลับมา เนื้อหา/ลำดับ/ข้อความให้ตรงกับ ReceiptTicket JSX เดิมใน ticket.tsx เป๊ะ
  const builder = CapacitorThermalPrinter.begin()
    .raw(selectCodepageCmd(THAI_CODEPAGE_N))
    .raw(SIZE_NORMAL)
    .align("center")
    .raw(boldCmd(true));
  thaiText(builder, `${t.appName}\n`);
  builder.raw(boldCmd(false));
  thaiText(builder, `${data.label}\n`);
  thaiText(builder, `${now.toLocaleString(lang === "th" ? "th-TH" : "en-US")}\n`);
  builder.align("left");
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  data.items.forEach((ci) => {
    const name = lang === "en" ? ci.item.name.en : ci.item.name.th;
    // ชื่อรายการชิดซ้าย/ราคาชิดขวาในบรรทัดเดียวกัน — เทียบเท่า flex justify-between บนเว็บ
    // (padLine เติม space ให้ราคาไปสุดขวาที่ความกว้างบรรทัดจริงของกระดาษ ไม่ล้นแม้ราคาหลายหลัก)
    // ฿ อยู่ "หลัง" ตัวเลขตามที่ขอ (เช่น "210฿")
    thaiText(builder, padLine(`${ci.quantity}x ${name}`, `${cartItemTotal(ci)}${t.thb}`) + "\n");
    const opt = formatOptionDetails(ci, lang);
    if (opt) thaiText(builder, `  ${opt}\n`);
    if (ci.customNote) {
      thaiText(builder, `  + ${ci.customNote} (+${ci.customAddOnPrice || 0}${t.thb})\n`);
    }
  });

  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  // ยอดรวม — ชิดซ้าย/ขวาแบบเดียวกับรายการ ตัวหนา ขนาดปกติ ตรงกับ flex justify-between +
  // fontWeight:700 ใน ReceiptTicket JSX เดิม (ไม่ขยายขนาดแล้ว ทั้งใบใช้ขนาดปกติเท่ากันหมด)
  builder.raw(boldCmd(true));
  thaiText(builder, padLine(lang === "en" ? "Total" : "รวมทั้งหมด", `${data.total}${t.thb}`) + "\n");
  builder.raw(boldCmd(false));

  const paymentLabel = data.paymentMethod === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน");
  thaiText(builder, `${lang === "en" ? "Payment" : "ชำระโดย"}: ${paymentLabel}\n`);

  if (data.paymentMethod === "cash" && data.cashReceived != null) {
    thaiText(builder, `${lang === "en" ? "Received" : "รับเงิน"}: ${data.cashReceived}${t.thb}\n`);
    thaiText(builder, `${lang === "en" ? "Change" : "เงินทอน"}: ${change}${t.thb}\n`);
  }

  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");
  builder.align("center");
  thaiText(builder, `${lang === "en" ? "Thank you for your visit" : "ขอบคุณที่ใช้บริการค่ะ"}\n`);
  builder.feedCutPaper();

  await builder.write();
}

export async function testPrintSelectedPrinter(): Promise<void> {
  await ensurePrinterConnected();
  const builder = CapacitorThermalPrinter.begin()
    .raw(selectCodepageCmd(THAI_CODEPAGE_N))
    .raw(SIZE_NORMAL) // กันขนาดค้างจากใบก่อนหน้า (เช่นตั๋วครัวที่ตั้ง GS!0x11 ไว้บน connection เดิม)
    .align("center")
    .raw(boldCmd(true));
  thaiText(builder, "ทดสอบพิมพ์\n");
  builder.raw(boldCmd(false));
  thaiText(builder, new Date().toLocaleString("th-TH") + "\n");
  builder.feedCutPaper();
  await builder.write();
}

// ─── Inverse-video diagnostic (kept as a utility, not wired into the UI) ───
//
// Already run on the real POS-5890U-L and the result confirmed (2026-09), so
// its button was removed from PrinterSettingsModal. Kept here in case the
// printer model changes and USE_INVERSE_FOR_NOTES needs re-checking.
//
// GS B (inverse video) has never been tested on the POS-5890U-L. Prints both
// candidates side by side, labeled in plain ASCII, so one printout settles
// which to keep: if the "inverse" block doesn't actually show white-on-black
// (stays plain, or garbles), set USE_INVERSE_FOR_NOTES = false above to fall
// back to bold-only permanently (deliberately not bold+underline — that
// would visually collide with ci.note's own dedicated underline) — same
// confirm-once-then-hardcode pattern as THAI_CODEPAGE_N and the GS! size
// commands. Also prints a plain underline sample (C) since that's now
// ci.note's permanent format regardless of this switch, not a fallback.
export async function printInverseTest(): Promise<void> {
  await ensurePrinterConnected();
  const builder = CapacitorThermalPrinter.begin()
    .raw(selectCodepageCmd(THAI_CODEPAGE_N))
    .raw(SIZE_NORMAL)
    .align("left");

  thaiText(builder, "A: inverse video (GS B)\n");
  builder.raw(inverseCmd(true));
  thaiText(builder, "ตัวอย่างข้อความกลับสี ABC 123\n");
  builder.raw(inverseCmd(false));
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  thaiText(builder, "B: bold only (fallback if A fails)\n");
  builder.raw(boldCmd(true));
  thaiText(builder, "ตัวอย่างตัวหนาอย่างเดียว ABC 123\n");
  builder.raw(boldCmd(false));
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  thaiText(builder, "C: underline (ci.note, always)\n");
  builder.raw(underlineCmd(true));
  thaiText(builder, "ตัวอย่างขีดเส้นใต้ ABC 123\n");
  builder.raw(underlineCmd(false));

  builder.feedCutPaper();
  await builder.write();
}

// ─── Thai codepage diagnostic sweep (kept as a utility, not wired into the UI) ─
//
// Already did its job: confirmed THAI_CODEPAGE_N = 255 above for the
// POS-5890U-L. Kept here (unused by any screen right now) in case the shop
// adds a different printer model later and needs to re-run the same
// one-printout-instead-of-rebuild-per-guess diagnosis. To use it again, wire
// a button to this the same way PrinterSettingsModal.tsx used to.
//
// Prints the SAME TIS-620-encoded test line under many different ESC t n
// values in one job, each labeled with its n in plain ASCII (which renders
// identically under any codepage, so the label itself is never garbled).
//
// 0–19 are the Epson-standard ESC/POS table (almost certainly NOT Thai, but
// included so a "none of these obviously look right" result is conclusive
// rather than ambiguous). 20–26 are the vendor-specific "Thai Character Code"
// tables documented on many generic ZJiang/Rongta-family 58mm printers. The
// rest are other vendor-extension numbers occasionally seen for Thai/TIS-620
// on similar clone firmware — 255 turned out to be the right one here.
export const THAI_CODEPAGE_CANDIDATES: { n: number; label: string }[] = [
  { n: 0, label: "PC437 (USA) - ESC/POS standard" },
  { n: 1, label: "Katakana - ESC/POS standard" },
  { n: 2, label: "PC850 - ESC/POS standard" },
  { n: 3, label: "PC860 - ESC/POS standard" },
  { n: 4, label: "PC863 - ESC/POS standard" },
  { n: 5, label: "PC865 - ESC/POS standard" },
  { n: 16, label: "WPC1252 - ESC/POS standard" },
  { n: 17, label: "PC866 - ESC/POS standard" },
  { n: 18, label: "PC852 - ESC/POS standard" },
  { n: 19, label: "PC858 - ESC/POS standard" },
  { n: 20, label: "Thai Character Code 42 (vendor)" },
  { n: 21, label: "Thai Character Code 11 (vendor)" },
  { n: 22, label: "Thai Character Code 13 (vendor)" },
  { n: 23, label: "Thai Character Code 14 (vendor)" },
  { n: 24, label: "Thai Character Code 16 (vendor)" },
  { n: 25, label: "Thai Character Code 17 (vendor)" },
  { n: 26, label: "Thai Character Code 18 (vendor)" },
  { n: 30, label: "vendor extra" },
  { n: 32, label: "vendor extra" },
  { n: 42, label: "vendor extra" },
  { n: 53, label: "vendor extra" },
  { n: 255, label: "vendor extra" },
];

const THAI_SWEEP_TEST_LINE = "ทดสอบภาษาไทย กขค ป่า ไก่ ๑๒๓ ฿99";

export async function printThaiCodepageSweep(): Promise<void> {
  await ensurePrinterConnected();
  const builder = CapacitorThermalPrinter.begin().align("left");

  THAI_CODEPAGE_CANDIDATES.forEach(({ n, label }) => {
    builder.raw(selectCodepageCmd(n));
    // ASCII-only line: identical bytes in every codepage, so this label is
    // always readable regardless of whether n itself is a real/Thai table.
    thaiText(builder, `n=${n} ${label}\n`);
    thaiText(builder, `${THAI_SWEEP_TEST_LINE}\n`);
    thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");
  });

  builder.raw(selectCodepageCmd(0)); // leave the printer on a known table
  builder.feedCutPaper();
  await builder.write();
}

// ─── Character-size command diagnostic sweep (kept as a utility, not wired
// into the UI) ───────────────────────────────────────────────────────────────
//
// Already did its job: confirmed GS ! n works on the real POS-5890U-L (ESC !
// turned out unnecessary — see SIZE_NORMAL/SIZE_DOUBLE above). Kept here
// (unused by any screen right now, same as printThaiCodepageSweep() above)
// in case a different printer model needs this re-diagnosed later. To use it
// again, wire a button to this the same way PrinterSettingsModal.tsx used to.
//
// Prints the same short line under several candidate ESC/POS size commands,
// each labeled in plain ASCII, so a single printout shows which one a given
// printer's firmware actually honors instead of guessing per rebuild — same
// pattern as printThaiCodepageSweep() above.
//
// Covers two independent command families since some clone firmware supports
// one but not the other:
// - GS ! n (0x1D 0x21 n): the modern multiplier-based size command (what
//   printKitchenTicketNative/printReceiptNative use above). Low nibble =
//   height multiplier-1, high nibble = width multiplier-1.
// - ESC ! n (0x1B 0x21 n): the older "select print mode" command, where
//   double-height/double-width are separate on/off bits (0x10/0x20) rather
//   than a multiplier scale.
const GS_BANG_SIZE_CANDIDATES: { n: number; label: string }[] = [
  { n: 0x00, label: "GS ! 0x00 normal" },
  { n: 0x01, label: "GS ! 0x01 height x2" },
  { n: 0x10, label: "GS ! 0x10 width x2" },
  { n: 0x11, label: "GS ! 0x11 width+height x2" },
  { n: 0x22, label: "GS ! 0x22 width+height x3" },
  { n: 0x33, label: "GS ! 0x33 width+height x4" },
];

const ESC_BANG_SIZE_CANDIDATES: { n: number; label: string }[] = [
  { n: 0x00, label: "ESC ! 0x00 normal" },
  { n: 0x10, label: "ESC ! 0x10 height x2" },
  { n: 0x20, label: "ESC ! 0x20 width x2" },
  { n: 0x30, label: "ESC ! 0x30 width+height x2" },
];

const SIZE_SWEEP_TEST_LINE = "ทดสอบ ABC 123";

export async function printSizeCommandSweep(): Promise<void> {
  await ensurePrinterConnected();
  const builder = CapacitorThermalPrinter.begin()
    .raw(selectCodepageCmd(THAI_CODEPAGE_N))
    .align("left");

  GS_BANG_SIZE_CANDIDATES.forEach(({ n, label }) => {
    builder.raw([0x1d, 0x21, n]);
    thaiText(builder, `${label}\n`);
    thaiText(builder, `${SIZE_SWEEP_TEST_LINE}\n`);
  });
  builder.raw([0x1d, 0x21, 0x00]); // reset GS ! before switching families

  ESC_BANG_SIZE_CANDIDATES.forEach(({ n, label }) => {
    builder.raw([0x1b, 0x21, n]);
    thaiText(builder, `${label}\n`);
    thaiText(builder, `${SIZE_SWEEP_TEST_LINE}\n`);
  });
  builder.raw([0x1b, 0x21, 0x00]); // reset

  builder.feedCutPaper();
  await builder.write();
}

// ─── Wrapping/vowel-loss diagnostic (kept as a utility, not wired into the
// UI) ───────────────────────────────────────────────────────────────────────
//
// Built after a real-print report that didn't match anything the current
// wrapLine()/encodeTis620() code could produce: simulating the exact reported
// string ("1x ขนมจีนน้ำเงี้ยวซี่โครงหมู") through the current source byte-by-byte
// gives a DIFFERENT wrap point than what was observed, and proves โ (U+0E42 ->
// 0xE2) is computed and transported correctly (Blob -> base64 -> Java
// Base64.getDecoder().decode() -> raw bytes, no UTF-8 decoding step anywhere
// that could drop a lone 0xE2). Since the JS-side pipeline is proven correct
// by simulation, the mismatch points at one of three things outside pure JS
// logic — this sweep isolates all three in one printout instead of guessing:
//
// A) Does codepage 255 even have a working glyph for leading Thai vowels
//    (เ/โ/ไ/ใ/แ)? Never tested before — printThaiCodepageSweep()'s test line
//    happened to contain ไ but not โ or เ.
// B) The exact reported dish name at NORMAL size, one single .raw() call per
//    line (sanity baseline — should be perfect if the transport is sound).
// C) The same name at SIZE_WIDE with NO manual wrapLine() at all — lets the
//    PRINTER'S OWN hardware auto-wrap kick in, to see whether it (still)
//    corrupts text and where its true physical limit actually falls.
// D) The table label alone at SIZE_WIDE with no mode-switching around it.
// E) The table label with the exact SIZE_WIDE/SIZE_NORMAL/bold toggle
//    sequence printKitchenTicketNative() actually uses — isolates whether
//    that specific toggle sequence is what corrupts it.
export async function printWrapDiagnostic(): Promise<void> {
  await ensurePrinterConnected();
  const builder = CapacitorThermalPrinter.begin().raw(selectCodepageCmd(THAI_CODEPAGE_N)).align("left").raw(SIZE_NORMAL);

  thaiText(builder, "A: leading vowel glyphs\n");
  thaiText(builder, "e=เ o=โ ai=ไ ai2=ใ ae=แ\n");
  thaiText(builder, "with base: เก โก ไก ใก แก\n");
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  thaiText(builder, "B: full name, normal, 1 call\n");
  thaiText(builder, "1x ขนมจีนน้ำเงี้ยวซี่โครงหมู\n");
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  thaiText(builder, "C: full name, SIZE_WIDE, no wrapLine\n");
  builder.raw(SIZE_WIDE);
  thaiText(builder, "1x ขนมจีนน้ำเงี้ยวซี่โครงหมู\n");
  builder.raw(SIZE_NORMAL);
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  thaiText(builder, "D: label, SIZE_WIDE only\n");
  builder.raw(SIZE_WIDE);
  thaiText(builder, "โต๊ะ 1-1\n");
  builder.raw(SIZE_NORMAL);
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  thaiText(builder, "E: label, toggled like production\n");
  builder.raw(SIZE_WIDE).raw(boldCmd(true)).raw(SIZE_NORMAL);
  thaiText(builder, "โต๊ะ 1-1\n");
  builder.raw(SIZE_WIDE).raw(boldCmd(false)).raw(SIZE_NORMAL);
  thaiText(builder, "-".repeat(LINE_WIDTH) + "\n");

  builder.feedCutPaper();
  await builder.write();
}
