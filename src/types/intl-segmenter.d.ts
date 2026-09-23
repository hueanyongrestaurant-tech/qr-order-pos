// Ambient declaration for Intl.Segmenter — this project's TypeScript build
// (typescript@7.x, the Go-based "tsgo" preview) doesn't ship any Intl.*
// extension typings (Segmenter, ListFormat, etc.) yet, even with "lib"
// compiler options that would normally pull them in on mainline TypeScript.
// The runtime API itself is standard and available in all modern JS engines
// (Chrome/Android WebView, Node), only the type declarations are missing —
// hence this minimal ambient shape covering just what nativePrinter.ts uses.
declare namespace Intl {
  interface SegmenterOptions {
    granularity?: "grapheme" | "word" | "sentence";
    localeMatcher?: "lookup" | "best fit";
  }

  interface SegmentData {
    segment: string;
    index: number;
    input: string;
    isWordLike?: boolean;
  }

  class Segmenter {
    constructor(locales?: string | string[], options?: SegmenterOptions);
    segment(input: string): Iterable<SegmentData>;
  }
}
