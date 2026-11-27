// สำรอง "ไฟล์ต้นฉบับ" ของรูปเมนูที่พนักงานอัป (ขนาดเดิม ไม่บีบ) → Cloud Storage
//   photo-originals/{itemId}/{photoVersion}.{ext}   (photoVersion = เลขเวอร์ชันรูปที่ลูกค้าเห็น = เวลาที่อัป ms)
// ใช้สำรองอย่างเดียว ไม่ใช้แสดงผล | storage.rules: สร้างได้เฉพาะบัญชีร้าน, อ่านได้เฉพาะเจ้าของ, ทับ/ลบไม่ได้
// ─────────────────────────────────────────────────────────────────────────────
// ขั้นตอน: เลือกรูป → บันทึกเมนู → ต้นฉบับเข้าคิวใน IndexedDB ของเครื่องนี้ (ก่อน commit — ปิดแอปกลางทางก็ไม่หาย)
//         → ส่งขึ้น Storage ทันที | ส่งไม่ได้ (ออฟไลน์/สิทธิ์) = เก็บไว้ในเครื่อง ลองใหม่ตอนเปิดแอป / กลับมาออนไลน์ / ทุก 10 นาที
//         ส่งสำเร็จแล้วค่อยลบออกจากคิว | จำนวนที่รอ + ปุ่ม "ส่งตอนนี้" อยู่ใน ตั้งค่า → เครื่องนี้
// ไฟล์นี้ไม่ import firebase/storage (ตัวส่งจริงอยู่ใน photoOriginalsUpload.ts โหลดตอนจะส่งเท่านั้น)

export const ORIGINALS_PREFIX = "photo-originals";
export const ORIGINAL_MAX_BYTES = 25 * 1024 * 1024; // ต้องตรงกับ storage.rules
// สิทธิ์ไม่ผ่าน (เช่น ยังไม่ได้วาง storage.rules) — ไม่ลองซ้ำเองถี่ๆ เพราะต้องอัปไฟล์ทั้งก้อนทุกครั้ง (กด "ส่งตอนนี้" ได้เสมอ)
export const UNAUTHORIZED_RETRY_MS = 6 * 60 * 60 * 1000;

export interface QueuedOriginal {
  key: string; // = path ใน Storage (ไม่ซ้ำ: เวอร์ชันรูปไม่ซ้ำกันในเมนูเดียว)
  itemId: string;
  version: number;
  ext: string;
  contentType: string;
  name: string; // ชื่อไฟล์เดิมในเครื่องพนักงาน
  size: number;
  blob: Blob;
  addedAt: number;
  attempts: number;
  lastTryAt?: number;
  lastError?: string; // "unauthorized" | "network" | ข้อความอื่น
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif", "image/gif": "gif", "image/avif": "avif",
};
const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", gif: "image/gif", avif: "image/avif",
};

// นามสกุล + content type จากไฟล์ (มือถือบางรุ่นไม่บอก type → เดาจากชื่อ, ไม่รู้เลย = jpg)
export function originalFileInfo(file: { name?: string; type?: string }): { ext: string; contentType: string } {
  const type = (file.type || "").toLowerCase();
  const nameExt = (file.name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (type.startsWith("image/")) {
    const ext = EXT_BY_TYPE[type] ?? (nameExt && TYPE_BY_EXT[nameExt] === type ? nameExt : type.slice(6).replace(/[^a-z0-9]/g, "") || "img");
    return { ext: ext === "jpeg" ? "jpg" : ext, contentType: type };
  }
  if (nameExt && TYPE_BY_EXT[nameExt]) return { ext: nameExt === "jpeg" ? "jpg" : nameExt, contentType: TYPE_BY_EXT[nameExt] };
  return { ext: "jpg", contentType: "image/jpeg" };
}

export function originalPath(itemId: string, version: number, ext: string) {
  return `${ORIGINALS_PREFIX}/${itemId}/${version}.${ext}`;
}

export type EnqueueResult = "queued" | "too-large" | "empty";
export function checkOriginal(file: { size: number }): EnqueueResult {
  if (!file.size) return "empty";
  if (file.size >= ORIGINAL_MAX_BYTES) return "too-large";
  return "queued";
}

// ─── ที่เก็บคิว ───
export interface OriginalsStore {
  all(): Promise<QueuedOriginal[]>;
  put(entry: QueuedOriginal): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createIdbOriginalsStore(dbName = "photo-originals-queue"): OriginalsStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("queue", { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { opening = undefined; reject(req.error); };
    });
    return opening;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const idb = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = idb.transaction("queue", mode);
      const req = fn(tx.objectStore("queue"));
      // เขียน: รอ transaction จบจริง (ข้อมูลลงดิสก์) ค่อยถือว่าสำเร็จ
      if (mode === "readwrite") tx.oncomplete = () => resolve(req.result as T);
      else req.onsuccess = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    });
  };
  return {
    all: () => run<QueuedOriginal[]>("readonly", (s) => s.getAll()),
    put: async (e) => { await run("readwrite", (s) => s.put(e)); },
    remove: async (key) => { await run("readwrite", (s) => s.delete(key)); },
  };
}

export function createMemoryOriginalsStore(): OriginalsStore & { map: Map<string, QueuedOriginal> } {
  const map = new Map<string, QueuedOriginal>();
  return {
    map,
    all: async () => [...map.values()],
    put: async (e) => { map.set(e.key, e); },
    remove: async (k) => { map.delete(k); },
  };
}

export function errorKind(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "storage/unauthorized" || code === "storage/unauthenticated") return "unauthorized";
  if (code === "storage/retry-limit-exceeded" || code === "storage/canceled" || /network|fetch|offline/i.test(String((err as Error)?.message ?? err))) return "network";
  return code || String((err as Error)?.message ?? err).slice(0, 120);
}

export interface QueueState { waiting: number; bytes: number; lastError: string | null; busy: boolean }

// ─── คิว (ตรรกะล้วน — test ได้ด้วย memory store + ตัวส่งปลอม) ───
export function createOriginalsQueue(
  store: OriginalsStore,
  upload: (e: QueuedOriginal) => Promise<void>,
  now: () => number = Date.now,
) {
  let state: QueueState = { waiting: 0, bytes: 0, lastError: null, busy: false };
  const listeners = new Set<(s: QueueState) => void>();
  const emit = (patch: Partial<QueueState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };
  const refresh = async () => {
    const all = await store.all();
    const failing = all.filter((e) => e.lastError).sort((a, b) => (b.lastTryAt ?? 0) - (a.lastTryAt ?? 0));
    emit({ waiting: all.length, bytes: all.reduce((n, e) => n + e.size, 0), lastError: failing[0]?.lastError ?? null });
    return all;
  };

  const enqueue = async (itemId: string, version: number, file: File | (Blob & { name?: string })): Promise<EnqueueResult> => {
    const check = checkOriginal(file);
    if (check !== "queued") return check;
    const { ext, contentType } = originalFileInfo(file);
    const entry: QueuedOriginal = {
      key: originalPath(itemId, version, ext),
      itemId, version, ext, contentType,
      name: (file as File).name || "",
      size: file.size,
      blob: file,
      addedAt: now(),
      attempts: 0,
    };
    await store.put(entry);
    await refresh();
    return "queued";
  };

  let running: Promise<{ uploaded: number; failed: number }> | null = null;
  // manual = กดปุ่มเอง: ลองทุกไฟล์ รวมที่เพิ่งติดสิทธิ์
  const flush = (opts: { manual?: boolean } = {}) => {
    if (running) return running;
    running = (async () => {
      emit({ busy: true });
      let uploaded = 0, failed = 0;
      try {
        const all = (await store.all()).sort((a, b) => a.addedAt - b.addedAt);
        for (const e of all) {
          if (!opts.manual && e.lastError === "unauthorized" && e.lastTryAt && now() - e.lastTryAt < UNAUTHORIZED_RETRY_MS) continue;
          try {
            await upload(e);
            await store.remove(e.key);
            uploaded++;
          } catch (err) {
            failed++;
            const kind = errorKind(err);
            await store.put({ ...e, attempts: e.attempts + 1, lastTryAt: now(), lastError: kind });
            if (kind === "network") break; // ออฟไลน์ — ไฟล์ที่เหลือก็ไม่ผ่าน รอรอบหน้า
          }
        }
      } finally {
        await refresh().catch(() => undefined);
        emit({ busy: false });
        running = null;
      }
      return { uploaded, failed };
    })();
    return running;
  };

  const subscribe = (fn: (s: QueueState) => void) => {
    listeners.add(fn);
    fn(state);
    return () => { listeners.delete(fn); };
  };

  return { enqueue, flush, refresh, subscribe, getState: () => state };
}

// ─── ตัวจริงของแอป ───
let _queue: ReturnType<typeof createOriginalsQueue> | undefined;
export function photoOriginalsQueue() {
  _queue ??= createOriginalsQueue(
    createIdbOriginalsStore(),
    async (e) => (await import("./photoOriginalsUpload")).uploadOriginal(e),
  );
  return _queue;
}
