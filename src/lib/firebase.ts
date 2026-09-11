import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
    authDomain: "hueanyong-restaurant.firebaseapp.com",
    projectId: "hueanyong-restaurant",
    storageBucket: "hueanyong-restaurant.firebasestorage.app",
    messagingSenderId: "250543301933",
    appId: "1:250543301933:web:0a5f7e9960421b1d035fa4",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// เรียก getAuth() แบบ lazy — เฉพาะตอนโค้ดฝั่งพนักงานเรียกใช้จริง (login/logout/onAuthStateChanged)
// ไม่ใช่ตอนโหลดไฟล์ทันที เพราะ getAuth() เองทำให้ Auth SDK เริ่มเช็ค session ที่ค้างใน
// IndexedDB + ยิง accounts:lookup/getProjectConfig ไปหา Firebase ทันที ซึ่งฝั่งลูกค้า
// (สแกน QR สั่งอาหาร) ไม่เกี่ยวกับ auth เลยแม้แต่น้อย
let _auth: Auth | undefined;
export function getAuthInstance(): Auth {
    if (!_auth) _auth = getAuth(app);
    return _auth;
}
