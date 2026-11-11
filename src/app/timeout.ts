// โหลดอะไรก็ตามที่ต้องรอ server ห้ามรอตลอดไป — ครบเวลาแล้วโยน TimeoutError ให้หน้าจอขึ้นข้อความ + ปุ่มลองใหม่
export const LOAD_TIMEOUT_MS = 10_000;

export class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => reject(new TimeoutError()), ms);
    }),
  ]).finally(() => globalThis.clearTimeout(timer));
}
