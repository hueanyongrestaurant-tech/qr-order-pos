import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// เก็บ URL/key แบบ hardcode เหมือน firebase.ts — anon key ของ Supabase ออกแบบมาให้ฝังใน
// โค้ดฝั่ง client ได้อยู่แล้ว (เหมือน Firebase apiKey) สิ่งที่ป้องกันข้อมูลจริงคือ Storage
// policy ที่ตั้งไว้ใน Supabase Dashboard ไม่ใช่การซ่อนค่านี้ — โปรเจกต์นี้ deploy เป็น
// static site (gh-pages) จึงไม่มีประโยชน์เพิ่มจากการย้ายไปเก็บใน env var
const SUPABASE_URL = "https://ayfwvhgvnbixwfaovlzk.supabase.co";
const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5Znd2aGd2bmJpeHdmYW92bHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNDE2OTcsImV4cCI6MjEwNDcxNzY5N30.5uPmdfn1At3TcEsZREAR5A3mHJSUoTfkxlaB0KenY-Y";

export const MENU_PHOTOS_BUCKET = "menu-photos";

// เช่นเดียวกับ getAuthInstance()/getStorageInstance() ใน firebase.ts — เรียก createClient()
// แบบ lazy เฉพาะตอนโค้ดฝั่งพนักงานอัปโหลด/ลบรูปเมนูจริง ลูกค้าไม่เคยต้องใช้ Supabase SDK เลย
// (ดูรูปเมนูผ่าน <img src={publicUrl}> ธรรมดา ไม่ผ่าน SDK)
let _supabase: SupabaseClient | undefined;
export function getSupabaseClient(): SupabaseClient {
    if (!_supabase) _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabase;
}
