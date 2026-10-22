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
import type { Category, Language, Order } from "../types";
import type { ReceiptData } from "./ticket";
import { getSelectedPrinter, type PrintRole } from "./printerStore";
import { layoutTicket, planTickets, type TicketLine } from "./stationTickets";
import { KITCHEN_LINE_WIDTH, LINE_WIDTH, wrapLine } from "./printText";
import { layoutReceipt } from "./receiptLayout";

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

// การตัดบรรทัด/วัดความกว้างข้อความไทย (wrapLine, columns, displayWidth) อยู่ที่ printText.ts

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

// พิมพ์ใบของจุดที่เครื่องนี้รับผิดชอบ (role) — แยกรายการ/จัดหน้าที่ stationTickets.ts ที่นี่แค่แปลง
// TicketLine เป็น ESC/POS คืนจำนวนใบที่พิมพ์ (0 = ออเดอร์นี้ไม่มีอะไรของจุดนี้ ไม่ได้ต่อเครื่องพิมพ์เลย)
// หลายใบ (โหมด "all": เคาน์เตอร์ + ครัว) ส่งเป็นงานพิมพ์เดียว ตัด/feed กระดาษระหว่างใบ
// banner = บรรทัดเด่นใต้เลขโต๊ะ (ใบย้ายโต๊ะ ดู tableMove.ts)
export async function printStationTicketsNative(
  order: Order,
  role: PrintRole,
  categories: Category[],
  lang: Language,
  banner?: string,
): Promise<number> {
  const plans = planTickets(order, role, categories);
  if (plans.length === 0) return 0;
  await ensurePrinterConnected();

  const builder = CapacitorThermalPrinter.begin().raw(selectCodepageCmd(THAI_CODEPAGE_N));
  plans.forEach((plan) => emitTicketLines(builder, layoutTicket(order, plan, lang, banner)));
  await builder.write();
  return plans.length;
}

// ทั้งใบพิมพ์ที่ SIZE_WIDE (GS! 0x10 กว้าง x2) ยกเว้นขอบบนกับเวลาที่ SIZE_NORMAL — เวลา (เช่น
// "22/9/2569 22:28:42" ~19 ตัว) ยาวเกิน KITCHEN_LINE_WIDTH และ wrapLine() ตัดตัวเลข/"/" กระจัด
// กระจาย เส้นคั่นใช้ KITCHEN_LINE_WIDTH (ครึ่งหนึ่งของ LINE_WIDTH) เพราะตัวอักษรกว้าง 2 เท่า
//
// สำคัญ: ทุกบรรทัดส่งเป็น .raw() ครั้งเดียว รวมคำสั่งขนาด (GS!) + ตัวหนา/inverse/ขีดเส้นใต้ + ข้อความ
// + คำสั่งปิด — แต่ละ .raw() ถูกคิวแบบ async แยกกันฝั่ง native (plugin.js: callQueue) การแยกคำสั่ง
// เปลี่ยนขนาดกับข้อความเป็นคนละ call เคยทำให้เส้นคั่นพิมพ์กระจัดกระจายจริงบนเครื่อง
function emitTicketLines(builder: typeof CapacitorThermalPrinter, lines: TicketLine[]) {
  let align: "left" | "center" = "left";
  builder.align("left");
  for (const line of lines) {
    if (line.kind === "cut") {
      builder.feedCutPaper();
      continue;
    }
    if (line.kind === "rule") {
      if (align !== "left") builder.align((align = "left"));
      builder.raw([...SIZE_WIDE, ...thaiRaw("-".repeat(KITCHEN_LINE_WIDTH) + "\n")]);
      continue;
    }
    if (line.align !== align) builder.align((align = line.align));
    const size = line.size === "wide" ? SIZE_WIDE : SIZE_NORMAL;
    const on = [
      ...(line.bold ? boldCmd(true) : []),
      ...(line.emphasis === "group" ? groupEmphasisOnCmd() : line.emphasis === "underline" ? underlineCmd(true) : []),
    ];
    const off = [
      ...(line.emphasis === "group" ? groupEmphasisOffCmd() : line.emphasis === "underline" ? underlineCmd(false) : []),
      ...(line.bold ? boldCmd(false) : []),
    ];
    const texts = line.wrap ? wrapLine(line.text, line.size === "wide" ? KITCHEN_LINE_WIDTH : LINE_WIDTH) : [line.text];
    texts.forEach((text) => builder.raw([...size, ...on, ...thaiRaw(`${text}\n`), ...off]));
  }
}

export async function printReceiptNative(data: ReceiptData, lang: Language): Promise<void> {
  await ensurePrinterConnected();

  // ใบเสร็จทั้งใบใช้ขนาดปกติ GS! 0x00 — ส่ง SIZE_NORMAL ทุกบรรทัดกันขนาดค้างจากใบก่อนหน้า (ตั๋วครัว
  // ตั้ง GS! ไว้บน connection เดิม) จัดหน้า/ตัดบรรทัด/ชิดขวาราคาที่ receiptLayout.ts ที่นี่แค่ส่งทีละบรรทัด
  // บรรทัดละ .raw() ครั้งเดียว (ขนาด + ตัวหนา + ข้อความ) เหตุผลเดียวกับ emitTicketLines
  const builder = CapacitorThermalPrinter.begin().raw(selectCodepageCmd(THAI_CODEPAGE_N));
  let align: "left" | "center" | null = null;
  for (const line of layoutReceipt(data, lang, new Date())) {
    if (line.align !== align) builder.align((align = line.align));
    builder.raw([
      ...SIZE_NORMAL,
      ...(line.bold ? boldCmd(true) : []),
      ...thaiRaw(`${line.text}
`),
      ...(line.bold ? boldCmd(false) : []),
    ]);
  }
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
