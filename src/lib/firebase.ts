import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import {
    browserLocalPersistence,
    connectAuthEmulator,
    getAuth,
    indexedDBLocalPersistence,
    initializeAuth,
    type Auth,
} from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
    authDomain: "hueanyong-restaurant.firebaseapp.com",
    projectId: "hueanyong-restaurant",
    storageBucket: "hueanyong-restaurant.firebasestorage.app",
    messagingSenderId: "250543301933",
    appId: "1:250543301933:web:0a5f7e9960421b1d035fa4",
};

// พรีวิวบนเครื่อง (npx vite --mode emulator → .env.emulator) ใช้ Firestore/Auth emulator ล้วน ไม่แตะ production
// เฉพาะ dev server (import.meta.env.DEV) — build จริง/APK ไม่มีทางเข้าโหมดนี้ | project "demo-*" = emulator เท่านั้นตาม Firebase
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATOR === "1";
const app = initializeApp(useEmulator ? { ...firebaseConfig, projectId: "demo-hueanyong" } : firebaseConfig);
export const db = getFirestore(app);
if (useEmulator) connectFirestoreEmulator(db, "127.0.0.1", 8080);

// เรียก getAuth() แบบ lazy — เฉพาะตอนโค้ดฝั่งพนักงานเรียกใช้จริง (login/logout/onAuthStateChanged)
// ไม่ใช่ตอนโหลดไฟล์ทันที เพราะ getAuth() เองทำให้ Auth SDK เริ่มเช็ค session ที่ค้างใน
// IndexedDB + ยิง accounts:lookup/getProjectConfig ไปหา Firebase ทันที ซึ่งฝั่งลูกค้า
// (สแกน QR สั่งอาหาร) ไม่เกี่ยวกับ auth เลยแม้แต่น้อย
//
// แอป Android (build mode capacitor) ใช้ initializeAuth แทน getAuth: getAuth() พ่วง popupRedirectResolver
// มาด้วย ซึ่งบน WebView มือถือจะเปิด iframe ไปที่ authDomain ทันทีตอนเริ่ม — ถ้า iframe ช้า/ค้าง
// การกู้ session จาก IndexedDB ก็ช้าตาม พนักงานเลยเห็นหน้า login แล้วพิมพ์รหัสซ้ำทั้งที่ session ยังอยู่
// ร้านนี้ล็อกอินด้วย email/password อย่างเดียว ไม่ใช้ popup/redirect เลย จึงตัด resolver ทิ้งได้
// persistence ลอง IndexedDB ก่อน ถ้าใช้ไม่ได้ค่อยตกไป localStorage — ทั้งสองแบบอยู่ข้ามการปิด/เปิดแอป
// เว็บใช้ getAuth() เหมือนเดิม
let _auth: Auth | undefined;
export function getAuthInstance(): Auth {
    if (!_auth) {
        _auth = import.meta.env.MODE === "capacitor"
            ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
            : getAuth(app);
        if (useEmulator) connectAuthEmulator(_auth, "http://127.0.0.1:9099", { disableWarnings: true });
    }
    return _auth;
}
