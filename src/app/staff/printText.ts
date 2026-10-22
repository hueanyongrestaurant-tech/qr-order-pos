// ─── จัดข้อความสำหรับเครื่องพิมพ์ความร้อน (ฟังก์ชันล้วน — ไม่แตะ Capacitor) ─────────────
//
// ย้ายมาจาก nativePrinter.ts เพื่อให้ทดสอบได้ใน node (test จำลองข้อความที่ส่งไปเครื่องพิมพ์)
//
// ความกว้างบนกระดาษ ≠ String.length: สระบน/ล่างและวรรณยุกต์ไทย (ั ิ ี ึ ื ุ ู ฺ ็ ่ ้ ๊ ๋ ์ ํ ๎) เครื่องพิมพ์
// วางซ้อนบน/ใต้ตัวก่อนหน้า ไม่กินช่อง — เดิมนับด้วย .length ทำให้บรรทัดที่มีสระบน/ล่างมากเติมช่องว่าง
// น้อยไป ราคาเลยไม่ชิดขวาตรงกัน (เบี้ยวซ้าย) ทุกการวัดในไฟล์นี้ใช้ displayWidth()

// characters per printed line at Font A, normal (1x) width, on 58mm paper.
// Reduced from an initial guess of 32 after real hardware testing showed both
// dashed separator lines and long price lines wrapping their tail characters
// onto a second physical line — 30 leaves a safety margin against that.
export const LINE_WIDTH = 30;
// ตั๋วครัวทั้งใบพิมพ์ที่ GS! 0x10 (กว้าง x2) ตัวอักษรแต่ละตัวเลยกว้างเป็น 2 เท่า จำนวนตัวอักษร
// ที่พอดีความกว้างกระดาษจริงต่อบรรทัดจึงลดลงครึ่งหนึ่ง — ใช้ค่านี้เฉพาะกับเส้นคั่นของตั๋วครัว
// ไม่งั้นเส้นคั่นที่คำนวณความยาวไว้สำหรับตัวอักษรขนาดปกติจะกว้างเกินกระดาษจริงเท่าตัว แล้ว wrap
// ไปพิมพ์ต่อบรรทัดใหม่ ทำให้ดูเหมือนมีเส้นคั่นซ้ำกันสองบรรทัดติดกัน
export const KITCHEN_LINE_WIDTH = Math.floor(LINE_WIDTH / 2);

// U+0E31 ไม้หันอากาศ, U+0E34–U+0E3A สระบน/ล่าง + พินทุ, U+0E47–U+0E4E ไม้ไต่คู้ วรรณยุกต์ การันต์ ฯลฯ
// (ำ U+0E33 กินช่องปกติ — ไม่อยู่ในนี้)
const isZeroWidth = (cp: number) => cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e);

// จำนวนช่องที่ข้อความกินบนกระดาษ (ฟอนต์ความกว้างคงที่ ขนาดปกติ)
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) if (!isZeroWidth(ch.codePointAt(0) ?? 0)) w++;
  return w;
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

// Fallback: splits a single overlong "word" into chunks no wider than the line,
// breaking only between grapheme units (leading-vowel-glued, see above).
// widthAt(i) = ความกว้างของบรรทัดที่ i (บรรทัดแรกกับบรรทัดต่อไปกว้างไม่เท่ากันได้)
function wrapByGrapheme(text: string, widthAt: (i: number) => number, startLine: number): string[] {
  const units = graphemeUnitsGluingLeadingVowels(text);
  const lines: string[] = [];
  let current = "";
  for (const unit of units) {
    const max = widthAt(startLine + lines.length);
    if (current.length > 0 && displayWidth(current) + displayWidth(unit) > max) {
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
// restWidth = ความกว้างของบรรทัดที่ 2 เป็นต้นไป (เช่นบรรทัดต่อของชื่อเมนูที่เยื้องเข้ามา)
export function wrapLine(text: string, maxWidth: number, restWidth = maxWidth): string[] {
  const widthAt = (i: number) => (i === 0 ? maxWidth : restWidth);
  const words = wordSegments(text);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const max = widthAt(lines.length);
    if (displayWidth(word) > max) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      const pieces = wrapByGrapheme(word, widthAt, lines.length);
      for (let i = 0; i < pieces.length - 1; i++) lines.push(pieces[i]);
      current = pieces[pieces.length - 1] ?? "";
      continue;
    }
    if (displayWidth(current) + displayWidth(word) > max) {
      lines.push(current);
      // เริ่มบรรทัดใหม่ — ถ้าคำที่ล้นมาเป็นแค่ช่องว่างเฉยๆ (จาก word segmenter ที่แยก
      // space เป็น token ของตัวเอง) ก็ตัดทิ้งไปเลย กันบรรทัดใหม่ขึ้นต้นด้วยช่องว่าง
      current = word.trim().length === 0 ? "" : word;
      continue;
    }
    current += word;
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines.map((l) => l.trimEnd());
}

// ซ้าย/ขวาในบรรทัดเดียวกัน (เทียบเท่า flex justify-between) — ตัวขวา (ราคา) ชิดขวาสุดที่ช่อง width
// เสมอ ข้อความซ้ายที่ยาวเกินคอลัมน์ตัดขึ้นบรรทัดใหม่ (ไม่ตัดทิ้ง) บรรทัดต่อเยื้องด้วย indent และไม่ล้ำเข้า
// คอลัมน์ราคา — ราคาอยู่บรรทัดแรกตำแหน่งเดิม
export function columns(left: string, right: string, width = LINE_WIDTH, indent = ""): string[] {
  const leftWidth = Math.max(1, width - displayWidth(right) - 1);
  const rest = Math.max(1, leftWidth - displayWidth(indent));
  const lines = wrapLine(left, leftWidth, rest);
  const first = lines[0];
  return [
    first + " ".repeat(Math.max(1, width - displayWidth(first) - displayWidth(right))) + right,
    ...lines.slice(1).map((l) => indent + l),
  ];
}
