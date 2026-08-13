import { useState, useEffect } from "react";
import {
  ShoppingCart,
  ChevronLeft,
  Plus,
  Minus,
  X,
  Flame,
  Check,
  Eye,
  EyeOff,
  Leaf,
  CreditCard,
  LogOut,
  Star,
  Lock,
  Utensils,
  Clock,
  CheckCircle,
  Trash2,
} from "lucide-react";

import { db, auth } from "../lib/firebase";
import { collection, addDoc, setDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

// ─── Types ───────────────────────────────────────────────────────────────────

type Language = "en" | "th";
type View =
  | "menu"
  | "item-detail"
  | "cart"
  | "order-sent"
  | "staff-login"
  | "staff-orders"
  | "staff-payment"
  | "staff-menu"
  | "staff-menu-edit"
  | "staff-history"
  | "staff-takeaway-menu"
  | "staff-takeaway-cart";
type MeatChoice = "pork" | "chicken" | "beef";
type SpiceLevel = 0 | 1 | 2 | 3;
type Portion = "regular" | "special";
interface CustomChoice {
  id: string;
  labelTh: string;
  labelEn: string;
  priceDelta: number;
}
interface CustomGroup {
  id: string;
  nameTh: string;
  nameEn: string;
  type: "single" | "multi"; // single = เลือกได้ 1, multi = เลือกได้หลายอย่าง
  choices: CustomChoice[];
}
type OrderStatus = "in-progress" | "awaiting-payment" | "paid";
type PaymentMethod = "cash" | "transfer";

interface MenuItem {
  id: string;
  categoryId: string;
  name: { en: string; th: string };
  description: { en: string; th: string };
  price: number;
  photo: string;
  hasMeatChoice?: boolean;
  meatPriceDeltas?: Partial<Record<MeatChoice, number>>;
  hasSpice?: boolean;
  hasPortion?: boolean;
  portionPriceDelta?: number;
  hasEggAddon?: boolean;   // ปิดตัวเลือกไข่ดาวสำหรับเมนูนี้ได้
  hasPlainAddOns?: boolean; // ปิดตัวเลือกจาน/ช้อนส้อม/แก้วน้ำสำหรับเมนูนี้ได้
  customGroups?: CustomGroup[];
  popular?: boolean;
}

interface CartItem {
  cartId: string;
  item: MenuItem;
  meat?: MeatChoice;
  portion?: Portion;
  customSelections?: Record<string, string[]>;
  note?: string;
  spiceLevel: SpiceLevel;
  addEgg: boolean;
  addOns: string[];
  quantity: number;
}

interface Order {
  id: string;
  tableNumber: number;
  timestamp: Date;
  items: CartItem[];
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
  isTakeaway?: boolean;
  takeawayLabel?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ADD_ONS = [
  { id: "extra-plate", label: { en: "Extra Plate", th: "จานเปล่าเพิ่ม" }, price: 10 },
  { id: "cutlery", label: { en: "Cutlery Set", th: "ช้อนส้อมชุด" }, price: 0 },
  { id: "water-glass", label: { en: "Water Glass", th: "แก้วน้ำ" }, price: 0 },
];

const CATEGORIES = [
  { id: "northern", name: { en: "Northern Specialties", th: "อาหารเหนือ" }, icon: "⭐" },
  { id: "appetizers", name: { en: "Appetizers", th: "ของว่าง" }, icon: "🥢" },
  { id: "noodles", name: { en: "Noodles", th: "ก๋วยเตี๋ยว" }, icon: "🍜" },
  { id: "curries", name: { en: "Curries", th: "แกง" }, icon: "🍛" },
  { id: "salads", name: { en: "Salads & Larb", th: "ยำ / ลาบ" }, icon: "🥗" },
  { id: "rice", name: { en: "Rice Dishes", th: "ข้าว" }, icon: "🍚" },
  { id: "drinks", name: { en: "Drinks", th: "เครื่องดื่ม" }, icon: "🥤" },
  { id: "desserts", name: { en: "Desserts", th: "ของหวาน" }, icon: "🍮" },
];

const SEED_MENU_ITEMS: MenuItem[] = [
  // Northern Specialties
  {
    id: "n1", categoryId: "northern",
    name: { en: "Khao Soi", th: "ข้าวซอย" },
    description: {
      en: "Iconic Northern Thai coconut curry noodle soup with crispy egg noodles, pickled mustard greens, and shallots. A Lanna classic.",
      th: "ข้าวซอยต้นตำรับล้านนา แกงกะทิเส้นก๋วยเตี๋ยวทอดกรอบ ผักดอง และหอมแดง",
    },
    price: 150, photo: "1569050467447-ce54b3bbc37d",
    hasMeatChoice: true, meatPriceDeltas: { beef: 20 },
    hasSpice: true, hasPortion: true, portionPriceDelta: 50,
    customGroups: [
      {
        id: "noodle-type", nameTh: "ชนิดเส้น", nameEn: "Noodle Type", type: "single",
        choices: [
          { id: "egg-noodle", labelTh: "เส้นไข่กรอบ", labelEn: "Crispy Egg Noodle", priceDelta: 0 },
          { id: "extra-noodle", labelTh: "เส้นเพิ่ม", labelEn: "Extra Noodles", priceDelta: 15 },
        ],
      },
    ],
    popular: true,
  },
  {
    id: "n2", categoryId: "northern",
    name: { en: "Gaeng Hang Lay", th: "แกงฮังเล" },
    description: {
      en: "Slow-cooked Burmese-style pork belly curry with ginger, tamarind, and whole shallots. Rich, deep, and warming.",
      th: "แกงฮังเลหมูสามชั้นตุ๋นนาน รสชาติลึก กลิ่นขิง น้ำมะขาม และหอมแดงทั้งลูก",
    },
    price: 165, photo: "1455619452474-d2be8b1e70cd",
    hasMeatChoice: false, hasSpice: false, popular: true,
  },
  {
    id: "n3", categoryId: "northern",
    name: { en: "Larb Khua", th: "ลาบคั่ว" },
    description: {
      en: "Dry-roasted spiced minced meat with toasted rice powder, dried chili, and aromatic herbs. Intensely flavored.",
      th: "ลาบคั่วเนื้อสับคั่วแห้ง รสเข้มข้น ข้าวคั่ว พริกแห้ง และสมุนไพรหอม",
    },
    price: 130, photo: "1546069901-ba9599a7e63c",
    hasMeatChoice: true, hasSpice: true, popular: true,
  },
  {
    id: "n4", categoryId: "northern",
    name: { en: "Nam Prik Noom", th: "น้ำพริกหนุ่ม" },
    description: {
      en: "Roasted young green chili paste with garlic and shallots. Served with blanched seasonal vegetables and sticky rice.",
      th: "น้ำพริกหนุ่มพริกเขียวหนุ่มปิ้ง เสิร์ฟกับผักลวก แคปหมู และข้าวเหนียว",
    },
    price: 95, photo: "1484980972926-edee96e0960d",
    hasMeatChoice: false, hasSpice: true, popular: false,
  },
  // Appetizers
  {
    id: "a1", categoryId: "appetizers",
    name: { en: "Sai Oua", th: "ไส้อั่ว" },
    description: {
      en: "Northern Thai herbal sausage grilled over charcoal, fragrant with lemongrass, galangal, and kaffir lime. Crispy and aromatic.",
      th: "ไส้อั่วสมุนไพรเหนือย่างถ่านหอมกลิ่นตะไคร้ ข่า และมะกรูด กรอบนอกนุ่มใน",
    },
    price: 120, photo: "1555939594-58d7cb561ad1",
    hasMeatChoice: false, hasSpice: true, popular: true,
  },
  {
    id: "a2", categoryId: "appetizers",
    name: { en: "Nam Prik Ong", th: "น้ำพริกอ่อง" },
    description: {
      en: "Northern Thai tomato chili dip with minced pork. Served with fresh seasonal vegetables and crispy pork rinds.",
      th: "น้ำพริกอ่องหมูสับมะเขือเทศ เสิร์ฟกับผักสดและแคปหมูกรอบ",
    },
    price: 95, photo: "1512058564366-18510be2db19",
    hasMeatChoice: false, hasSpice: false, popular: false,
  },
  {
    id: "a3", categoryId: "appetizers",
    name: { en: "Tod Mun Pla", th: "ทอดมันปลา" },
    description: {
      en: "Golden fish cakes with red curry paste and kaffir lime leaves. Served with sweet chili dipping sauce and cucumber relish.",
      th: "ทอดมันปลากรอบทอง ปรุงพริกแกงแดงและใบมะกรูด เสิร์ฟกับน้ำจิ้มหวาน",
    },
    price: 110, photo: "1540189549336-e6e99eb3ad99",
    hasMeatChoice: false, hasSpice: false, popular: false,
  },
  // Noodles
  {
    id: "nd1", categoryId: "noodles",
    name: { en: "Pad See Ew", th: "ผัดซีอิ๊ว" },
    description: {
      en: "Wide rice noodles stir-fried with dark soy sauce, Chinese broccoli, and egg in a blazing hot wok. Smoky and satisfying.",
      th: "เส้นใหญ่ผัดซีอิ๊วกับคะน้าและไข่ในกระทะเหล็กร้อน รสควันหอม",
    },
    price: 90, photo: "1562802378-063ec186a863",
    hasMeatChoice: true, hasSpice: false, popular: false,
  },
  {
    id: "nd2", categoryId: "noodles",
    name: { en: "Tom Yum Noodles", th: "ก๋วยเตี๋ยวต้มยำ" },
    description: {
      en: "Rice noodles in a bright and spiced tom yum broth with bean sprouts, ground pork, and fresh herbs.",
      th: "ก๋วยเตี๋ยวในน้ำต้มยำรสจัด กับถั่วงอก หมูสับ และสมุนไพรสด",
    },
    price: 80, photo: "1601924994987-69e26d50dc26",
    hasMeatChoice: true, hasSpice: true, popular: false,
  },
  // Curries
  {
    id: "c1", categoryId: "curries",
    name: { en: "Green Curry", th: "แกงเขียวหวาน" },
    description: {
      en: "Fragrant Thai green curry with coconut milk, Thai eggplant, bamboo shoots, and fresh basil. Herbaceous and rich.",
      th: "แกงเขียวหวานกะทิสด มะเขือพวง หน่อไม้ และใบโหระพาหอม",
    },
    price: 140, photo: "1585032226651-759b368d7246",
    hasMeatChoice: true, hasSpice: true, popular: false,
  },
  {
    id: "c2", categoryId: "curries",
    name: { en: "Massaman Curry", th: "แกงมัสมั่น" },
    description: {
      en: "Rich slow-simmered curry with peanuts, potatoes, and warming spices of cardamom, cinnamon, and star anise.",
      th: "แกงมัสมั่นรสเข้มข้น กับถั่วลิสง มันฝรั่ง และเครื่องเทศหอมอบอุ่น",
    },
    price: 145, photo: "1476224203421-9ac39bcb3327",
    hasMeatChoice: true, hasSpice: false, popular: false,
  },
  // Salads
  {
    id: "s1", categoryId: "salads",
    name: { en: "Larb Moo", th: "ลาบหมู" },
    description: {
      en: "Minced pork salad with toasted rice powder, lime juice, fish sauce, mint, and chili flakes. Bright and herbaceous.",
      th: "ลาบหมูบด ข้าวคั่ว น้ำมะนาว น้ำปลา ใบสะระแหน่ และพริกป่น",
    },
    price: 110, photo: "1546069901-ba9599a7e63c",
    hasMeatChoice: false, hasSpice: true, popular: false,
  },
  {
    id: "s2", categoryId: "salads",
    name: { en: "Yum Nuea Yang", th: "ยำเนื้อย่าง" },
    description: {
      en: "Grilled beef salad with lemongrass, red onion, tomatoes, cucumber, and a zesty lime and fish sauce dressing.",
      th: "ยำเนื้อย่างกับตะไคร้ หอมแดง มะเขือเทศ และน้ำยำน้ำมะนาวรสจัด",
    },
    price: 130, photo: "1476224203421-9ac39bcb3327",
    hasMeatChoice: false, hasSpice: true, popular: false,
  },
  // Rice
  {
    id: "r1", categoryId: "rice",
    name: { en: "Khao Niew", th: "ข้าวเหนียว" },
    description: {
      en: "Traditional Northern Thai sticky rice steamed in bamboo baskets. The heart and staple of every Lanna meal.",
      th: "ข้าวเหนียวต้นตำรับล้านนา นึ่งในกระติ๊บไม้ไผ่ หัวใจของอาหารเหนือ",
    },
    price: 30, photo: "1536304447766-da0ed4ce1b73",
    hasSpice: false, popular: true,
  },
  {
    id: "r2", categoryId: "rice",
    name: { en: "Khao Pad", th: "ข้าวผัด" },
    description: {
      en: "Classic Thai fried rice with egg, mixed vegetables, and savory sauces, topped with cucumber and lime wedge.",
      th: "ข้าวผัดไทยกับไข่ ผักรวม ซอสรสดี เสิร์ฟกับแตงกวาและมะนาว",
    },
    price: 90, photo: "1536304447766-da0ed4ce1b73",
    hasMeatChoice: true, hasSpice: false, popular: false,
  },
  // Drinks
  {
    id: "d1", categoryId: "drinks",
    name: { en: "Thai Iced Tea", th: "ชาไทย" },
    description: {
      en: "Strong Northern Thai tea with condensed milk served over ice. Sweet, creamy, and perfectly refreshing on a warm day.",
      th: "ชาไทยเข้มข้นกับนมข้นหวาน เสิร์ฟเย็น หวานมันสดชื่น",
    },
    price: 60, photo: "1544145945-f90425340c7e",
    hasSpice: false, popular: true,
  },
  {
    id: "d2", categoryId: "drinks",
    name: { en: "Butterfly Pea Lemonade", th: "น้ำดอกอัญชัน" },
    description: {
      en: "Stunning colour-changing drink made from butterfly pea flowers with honey and fresh lime juice. Naturally beautiful.",
      th: "น้ำดอกอัญชันเปลี่ยนสี ผสมน้ำผึ้งและน้ำมะนาวสด สวยงามตามธรรมชาติ",
    },
    price: 75, photo: "1544145945-f90425340c7e",
    hasSpice: false, popular: false,
  },
  {
    id: "d3", categoryId: "drinks",
    name: { en: "Fresh Coconut Water", th: "น้ำมะพร้าวสด" },
    description: {
      en: "Young coconut water served in the shell, naturally sweet and cooling. The perfect companion to spicy food.",
      th: "น้ำมะพร้าวอ่อนสด เสิร์ฟในลูกมะพร้าว หวานเย็นสดชื่น",
    },
    price: 70, photo: "1507003211169-0a1dd7228f2d",
    hasSpice: false, popular: false,
  },
  // Desserts
  {
    id: "ds1", categoryId: "desserts",
    name: { en: "Mango Sticky Rice", th: "ข้าวเหนียวมะม่วง" },
    description: {
      en: "Sweet glutinous rice with fresh ripe mango slices, drizzled with rich coconut cream and toasted sesame seeds.",
      th: "ข้าวเหนียวหวานมะม่วงสุก ราดกะทิเข้มข้นและงาคั่ว",
    },
    price: 120, photo: "1563379091339-03b21ab4a4f8",
    hasSpice: false, popular: true,
  },
  {
    id: "ds2", categoryId: "desserts",
    name: { en: "Tub Tim Grob", th: "ทับทิมกรอบ" },
    description: {
      en: "Crunchy water chestnuts in fragrant rose syrup with creamy coconut milk and shaved ice. Cool and delicate.",
      th: "ทับทิมกรอบในน้ำกุหลาบ กะทิเข้มข้น และน้ำแข็งไส เย็นสดชื่น",
    },
    price: 85, photo: "1563379091339-03b21ab4a4f8",
    hasSpice: false, popular: false,
  },
];

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  en: {
    appName: "Baan Lanna",
    tagline: "Northern Thai Kitchen",
    tableLabel: "Table",
    selectTable: "Select Your Table",
    selectTableSub: "Scan a QR code or choose your table number below",
    startOrder: "Start Ordering",
    langSwitch: "ภาษาไทย",
    viewCart: "View Order",
    addToCart: "Add to Order",
    cart: "Your Order",
    emptyCart: "Your cart is empty",
    emptyCartSub: "Browse our menu and add something delicious",
    goToMenu: "Browse Menu",
    total: "Total",
    confirmOrder: "Confirm Order",
    meatChoice: "Choose Protein",
    pork: "Pork",
    chicken: "Chicken",
    beef: "Beef",
    spiceLevel: "Spice Level",
    addEgg: "Add Fried Egg",
    eggPrice: "+฿20",
    addOns: "Add-ons",
    quantity: "Quantity",
    orderSent: "Order Sent!",
    orderSentMsg: "Your order is on its way to the kitchen. Sit back, relax, and enjoy the atmosphere.",
    orderMore: "Order More",
    staffLogin: "Staff Login",
    password: "Password",
    loginBtn: "Log In",
    wrongPass: "Incorrect password. Please try again.",
    staffOrders: "Orders",
    staffPayment: "Payment",
    logout: "Log Out",
    inProgress: "In Progress",
    awaitingPayment: "Awaiting Payment",
    markServed: "Mark as Served",
    noActiveOrders: "No active orders right now",
    noTablesWaiting: "No tables awaiting payment",
    paymentTitle: "Payment",
    selectTablePay: "Select a table to process payment",
    tableTotal: "Table Total",
    closeTable: "Close Table — Payment Received",
    cancelOrder: "Cancel Order",
    confirmCancelOrder: "Cancel this whole order?",
    confirmRemoveItem: "Remove this item?",
    portion: "Portion Size",
    regular: "Regular",
    special: "Special",
    staffAccess: "Staff Login",
    thb: "฿",
    popular: "Popular",
    back: "Back",
    eggAdded: "+ Fried Egg",
    freeLabel: "Free",
    rounds: "round",
    roundsPlural: "rounds",
    items: "items",
    spiceLevels: ["No Spice", "Mild 🌶", "Hot 🌶🌶", "Extra Hot 🌶🌶🌶"],
    meats: { pork: "Pork", chicken: "Chicken", beef: "Beef" },
    meatEmoji: { pork: "🐷", chicken: "🐓", beef: "🥩" },
  },
  th: {
    appName: "บ้านล้านนา",
    tagline: "ครัวล้านนา",
    tableLabel: "โต๊ะ",
    selectTable: "เลือกโต๊ะของท่าน",
    selectTableSub: "สแกน QR หรือเลือกหมายเลขโต๊ะด้านล่าง",
    startOrder: "เริ่มสั่งอาหาร",
    langSwitch: "English",
    viewCart: "ดูรายการ",
    addToCart: "เพิ่มในรายการ",
    cart: "รายการสั่งอาหาร",
    emptyCart: "ตะกร้าว่างเปล่า",
    emptyCartSub: "เลือกอาหารจากเมนูได้เลย",
    goToMenu: "ดูเมนู",
    total: "ยอดรวม",
    confirmOrder: "ยืนยันการสั่งอาหาร",
    meatChoice: "เลือกโปรตีน",
    pork: "หมู",
    chicken: "ไก่",
    beef: "เนื้อ",
    spiceLevel: "ระดับความเผ็ด",
    addEgg: "เพิ่มไข่ดาว",
    eggPrice: "+฿20",
    addOns: "เพิ่มเติม",
    quantity: "จำนวน",
    orderSent: "ส่งออเดอร์แล้ว!",
    orderSentMsg: "ครัวได้รับออเดอร์ของท่านแล้ว โปรดนั่งรอสักครู่ เพลิดเพลินกับบรรยากาศ",
    orderMore: "สั่งเพิ่ม",
    staffLogin: "เข้าสู่ระบบพนักงาน",
    password: "รหัสผ่าน",
    loginBtn: "เข้าสู่ระบบ",
    wrongPass: "รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่",
    staffOrders: "ออเดอร์",
    staffPayment: "ชำระเงิน",
    logout: "ออกจากระบบ",
    inProgress: "กำลังเตรียม",
    awaitingPayment: "รอชำระเงิน",
    markServed: "เสิร์ฟแล้ว",
    noActiveOrders: "ไม่มีออเดอร์ที่กำลังดำเนินการ",
    noTablesWaiting: "ไม่มีโต๊ะที่รอชำระเงิน",
    paymentTitle: "ชำระเงิน",
    selectTablePay: "เลือกโต๊ะเพื่อดำเนินการชำระเงิน",
    tableTotal: "ยอดรวมโต๊ะ",
    closeTable: "ปิดโต๊ะ — รับเงินแล้ว",
    cancelOrder: "ยกเลิกออเดอร์",
    confirmCancelOrder: "ยกเลิกออเดอร์นี้ทั้งหมด?",
    confirmRemoveItem: "ลบรายการนี้?",
    portion: "ขนาด",
    regular: "ธรรมดา",
    special: "พิเศษ",
    staffAccess: "พนักงาน",
    thb: "฿",
    popular: "ยอดนิยม",
    back: "ย้อนกลับ",
    eggAdded: "+ ไข่ดาว",
    freeLabel: "ฟรี",
    rounds: "รอบ",
    roundsPlural: "รอบ",
    items: "รายการ",
    spiceLevels: ["ไม่เผ็ด", "เผ็ดน้อย 🌶", "เผ็ด 🌶🌶", "เผ็ดมาก 🌶🌶🌶"],
    meats: { pork: "หมู", chicken: "ไก่", beef: "เนื้อ" },
    meatEmoji: { pork: "🐷", chicken: "🐓", beef: "🥩" },
  },
};

// ─── Utility functions ────────────────────────────────────────────────────────

function resolvePhoto(photo: string, w = 400, h = 300): string {
  if (!photo) return "";
  if (photo.startsWith("data:")) return photo; // อัปโหลดเอง (Base64)
  return `https://images.unsplash.com/photo-${photo}?w=${w}&h=${h}&fit=crop&auto=format`;
}

function itemPrice(
  item: MenuItem,
  meat: MeatChoice | undefined,
  portion: Portion | undefined,
  addEgg: boolean,
  addOns: string[],
  customSelections: Record<string, string[]> = {}
): number {
  let price = item.price;
  if (meat && item.meatPriceDeltas?.[meat]) price += item.meatPriceDeltas[meat]!;
  if (portion === "special" && item.portionPriceDelta) price += item.portionPriceDelta;
  if (addEgg) price += 20;
  addOns.forEach((id) => {
    const found = ADD_ONS.find((a) => a.id === id);
    if (found) price += found.price;
  });
  item.customGroups?.forEach((group) => {
    const selected = customSelections[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) price += choice.priceDelta;
    });
  });
  return price;
}

function cartItemTotal(ci: CartItem): number {
  return itemPrice(ci.item, ci.meat, ci.portion, ci.addEgg, ci.addOns, ci.customSelections) * ci.quantity;
}

function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

function orderTotal(order: Order): number {
  return order.items.reduce((sum, ci) => sum + cartItemTotal(ci), 0);
}

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  return `${mins} min ago`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function compressImage(file: File, maxWidth = 600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function LannaBorder() {
  return (
    <div
      className="h-[3px] w-full flex-shrink-0"
      style={{
        background:
          "linear-gradient(90deg, #C05A25 0%, #D07E35 30%, #4A6741 50%, #D07E35 70%, #C05A25 100%)",
      }}
    />
  );
}

function RestaurantLogo({ dark = true }: { dark?: boolean }) {
  const textColor = dark ? "text-[#FFF8F0]" : "text-foreground";
  const accentColor = dark ? "text-[#D07E35]" : "text-accent";
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center ${dark ? "bg-[#D07E35]/20" : "bg-primary/10"}`}
      >
        <Leaf className={accentColor} size={18} />
      </div>
      <div>
        <div className={`font-display font-semibold text-base leading-tight ${textColor}`}>
          Baan Lanna
        </div>
        <div className={`text-[10px] leading-tight opacity-70 ${textColor}`}>
          Northern Thai Kitchen
        </div>
      </div>
    </div>
  );
}

// ─── Menu Screen ──────────────────────────────────────────────────────────────

interface MenuProps {
  lang: Language;
  tableNumber: number;
  cart: CartItem[];
  menuItems: MenuItem[];
  activeCategory: string;
  onCategoryChange: (id: string) => void;
  onItemClick: (item: MenuItem) => void;
  onViewCart: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean;
}

function MenuScreen({
  lang, tableNumber, cart, menuItems, activeCategory,
  onCategoryChange, onItemClick, onViewCart, onLangToggle, isTakeaway,
}: MenuProps) {
  const t = T[lang];
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);
  const cartSum = cartTotal(cart);
  const filtered = menuItems.filter((item) => item.categoryId === activeCategory);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-50 bg-[#3C2414] shadow-xl">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-2.5">
          <RestaurantLogo dark />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[#4A6741] px-2.5 py-1 rounded-full">
              <Utensils size={11} className="text-[#FFF8F0]" />
              <span className="text-[#FFF8F0] text-xs font-medium">
                {isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`}
              </span></div>
            <button
              onClick={onLangToggle}
              className="text-[#D07E35] text-[11px] font-semibold px-2 py-1 hover:text-[#FFF8F0] transition-colors"
            >
              {t.langSwitch}
            </button>
            <button onClick={onViewCart} className="relative p-1.5 text-[#FFF8F0] hover:text-[#D07E35] transition-colors">
              <ShoppingCart size={22} />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded-full flex items-center justify-center font-bold px-0.5">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div
          className="flex overflow-x-auto px-4 pb-3 gap-2 pt-1"
          style={{ scrollbarWidth: "none" }}
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onCategoryChange(cat.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${activeCategory === cat.id
                ? "bg-primary text-primary-foreground"
                : "bg-white/10 text-[#E6D5BA] hover:bg-white/20"
                }`}
            >
              <span className="text-base leading-none">{cat.icon}</span>
              <span>{lang === "en" ? cat.name.en : cat.name.th}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Menu grid */}
      <div className="flex-1 px-4 py-4 pb-32">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemClick(item)}
              className="bg-card rounded-2xl overflow-hidden text-left border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-150 active:scale-95 group"
            >
              <div className="aspect-[4/3] relative bg-muted overflow-hidden">
                <img
                  src={resolvePhoto(item.photo, 400, 300)}
                  alt={lang === "en" ? item.name.en : item.name.th}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {item.popular && (
                  <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Star size={8} fill="currentColor" />
                    {t.popular}
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <div className="font-semibold text-foreground text-sm leading-snug">
                  {lang === "en" ? item.name.en : item.name.th}
                </div>
                <div className="text-muted-foreground text-[10px] mt-0.5 leading-snug">
                  {lang === "en" ? item.name.th : item.name.en}
                </div>
                <div className="mt-1.5 font-bold text-primary text-sm">
                  {t.thb}{item.price}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
          <button
            onClick={onViewCart}
            className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base flex items-center justify-between px-5 shadow-2xl hover:bg-primary/90 transition-all active:scale-95"
          >
            <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-bold">{cartCount}</span>
            <span>{t.viewCart}</span>
            <span className="font-bold">{t.thb}{cartSum}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Item Detail Screen ───────────────────────────────────────────────────────

interface ItemDetailProps {
  lang: Language;
  tableNumber: number;
  item: MenuItem;
  cart: CartItem[];
  onBack: () => void;
  onAddToCart: (ci: CartItem) => void;
  onViewCart: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean
}

function ItemDetailScreen({
  lang, tableNumber, item, cart, onBack, onAddToCart, onViewCart, onLangToggle, isTakeaway,
}: ItemDetailProps) {
  const t = T[lang];
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);
  const [meat, setMeat] = useState<MeatChoice>("chicken");
  const [portion, setPortion] = useState<Portion>("regular");
  const [spice, setSpice] = useState<SpiceLevel>(1);
  const [addEgg, setAddEgg] = useState(false);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [customSelections, setCustomSelections] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(1);

  const meats: MeatChoice[] = ["pork", "chicken", "beef"];
  const spiceLevels: SpiceLevel[] = [0, 1, 2, 3];
  const totalPrice = itemPrice(item, meat, portion, addEgg, selectedAddOns, customSelections) * quantity;

  const toggleCustomChoice = (groupId: string, choiceId: string, type: "single" | "multi") => {
    setCustomSelections((prev) => {
      const current = prev[groupId] || [];
      if (type === "single") {
        return { ...prev, [groupId]: current.includes(choiceId) ? [] : [choiceId] };
      }
      const next = current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId];
      return { ...prev, [groupId]: next };
    });
  };

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleAdd = () => {
    onAddToCart({
      cartId: uid(),
      item,
      meat: item.hasMeatChoice ? meat : undefined,
      portion: item.hasPortion ? portion : undefined,
      spiceLevel: item.hasSpice ? spice : 0,
      addEgg,
      addOns: selectedAddOns,
      customSelections,
      note: note.trim() || undefined,
      quantity,
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero photo */}
      <div className="relative h-[42vh] bg-muted flex-shrink-0 overflow-hidden">
        <img
          src={resolvePhoto(item.photo, 400, 300)}
          alt={lang === "en" ? item.name.en : item.name.th}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />

        {/* Top controls */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 pt-safe">
          <button
            onClick={onBack}
            className="bg-black/40 backdrop-blur-sm text-white p-2.5 rounded-full hover:bg-black/60 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
              {isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`}
            </div>
            <button
              onClick={onLangToggle}
              className="bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full hover:bg-black/60 transition-colors"
            >
              {t.langSwitch}
            </button>
            <button
              onClick={onViewCart}
              className="relative bg-black/40 backdrop-blur-sm text-white p-2.5 rounded-full hover:bg-black/60 transition-colors"
            >
              <ShoppingCart size={18} />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] min-w-[16px] h-4 rounded-full flex items-center justify-center font-bold px-0.5">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {item.popular && (
          <div className="absolute top-4 left-16 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
            <Star size={10} fill="currentColor" /> {t.popular}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-5 pt-3 pb-32"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Title & price */}
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex-1 mr-3">
            <h1 className="font-display text-2xl font-semibold text-foreground leading-tight">
              {lang === "en" ? item.name.en : item.name.th}
            </h1>
            <div className="text-muted-foreground text-sm mt-0.5">
              {lang === "en" ? item.name.th : item.name.en}
            </div>
          </div>
          <div className="font-display text-2xl font-bold text-primary flex-shrink-0">
            {t.thb}{item.price}
          </div>
        </div>

        <p className="text-foreground/75 text-sm leading-relaxed mb-5">
          {lang === "en" ? item.description.en : item.description.th}
        </p>

        <div className="h-px bg-border mb-5" />

        {/* Meat choice */}
        {item.hasMeatChoice && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">{t.meatChoice}</h3>
            <div className="flex gap-2">
              {meats.map((m) => (
                <button
                  key={m}
                  onClick={() => setMeat(m)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${meat === m
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                    }`}
                >
                  <span className="block text-lg leading-none mb-0.5">{T[lang].meatEmoji[m]}</span>
                  {T[lang].meats[m]}
                  {item.meatPriceDeltas?.[m] ? (
                    <span className="block text-[10px] opacity-70">+{t.thb}{item.meatPriceDeltas[m]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Spice level */}
        {item.hasSpice && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm flex items-center gap-1.5">
              <Flame size={15} className="text-primary" /> {t.spiceLevel}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {spiceLevels.map((level) => (
                <button
                  key={level}
                  onClick={() => setSpice(level)}
                  className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all text-center ${spice === level
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                    }`}
                >
                  {T[lang].spiceLevels[level]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Portion size */}
        {item.hasPortion && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">{t.portion}</h3>
            <div className="flex gap-2">
              {(["regular", "special"] as Portion[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPortion(p)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${portion === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                    }`}
                >
                  {p === "regular" ? t.regular : t.special}
                  {p === "special" && item.portionPriceDelta ? (
                    <span className="block text-[10px] opacity-70">+{t.thb}{item.portionPriceDelta}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add egg toggle */}
        {item.hasEggAddon !== false && (
          <div className="mb-5">
            <button
              onClick={() => setAddEgg(!addEgg)}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${addEgg
                ? "bg-primary/8 border-primary"
                : "bg-card border-border hover:border-primary/30"
                }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">🍳</span>
                <div className="text-left">
                  <div className="font-semibold text-foreground text-sm">{t.addEgg}</div>
                  <div className="text-muted-foreground text-xs">{t.eggPrice}</div>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full relative transition-colors ${addEgg ? "bg-primary" : "bg-muted"}`}>
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${addEgg ? "left-[22px]" : "left-0.5"
                    }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Add-ons */}
        {item.hasPlainAddOns !== false && (
          <div className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">{t.addOns}</h3>
            <div className="space-y-2">
              {ADD_ONS.map((addon) => (
                <button
                  key={addon.id}
                  onClick={() => toggleAddOn(addon.id)}
                  className={`w-full flex items-center justify-between p-3.5 rounded-xl border-2 transition-all ${selectedAddOns.includes(addon.id)
                    ? "bg-primary/8 border-primary"
                    : "bg-card border-border hover:border-primary/30"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${selectedAddOns.includes(addon.id)
                        ? "bg-primary border-primary"
                        : "border-border"
                        }`}
                    >
                      {selectedAddOns.includes(addon.id) && (
                        <Check size={11} className="text-primary-foreground" />
                      )}
                    </div>
                    <span className="text-foreground text-sm font-medium">
                      {lang === "en" ? addon.label.en : addon.label.th}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {addon.price > 0 ? `+${t.thb}${addon.price}` : t.freeLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom option groups — สร้างเองจากหน้าจัดการเมนู */}
        {item.customGroups?.map((group) => (
          <div key={group.id} className="mb-5">
            <h3 className="font-semibold text-foreground mb-3 text-sm">
              {lang === "en" ? group.nameEn : group.nameTh}
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.choices.map((choice) => {
                const selected = (customSelections[group.id] || []).includes(choice.id);
                return (
                  <button
                    key={choice.id}
                    onClick={() => toggleCustomChoice(group.id, choice.id, group.type)}
                    className={`px-3.5 py-2 rounded-xl text-sm font-medium border-2 transition-all ${selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:border-primary/40"
                      }`}
                  >
                    {lang === "en" ? choice.labelEn : choice.labelTh}
                    {choice.priceDelta ? (
                      <span className="ml-1 text-[10px] opacity-70">+{t.thb}{choice.priceDelta}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Note */}
        <div className="mb-5">
          <h3 className="font-semibold text-foreground mb-3 text-sm">
            {lang === "en" ? "Special Requests" : "หมายเหตุเพิ่มเติม"}
          </h3>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={lang === "en" ? "e.g. no cilantro, less oil..." : "เช่น ไม่ใส่ผักชี, น้ำมันน้อย..."}
            className="w-full bg-card border-2 border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-primary transition-all resize-none"
            rows={2}
          />
        </div>

        {/* Quantity */}
        <div className="mb-4">
          <h3 className="font-semibold text-foreground mb-3 text-sm">{t.quantity}</h3>
          <div className="flex items-center gap-5">
            <button
              onClick={() => quantity > 1 && setQuantity((q) => q - 1)}
              disabled={quantity <= 1}
              className="w-11 h-11 rounded-full bg-card border-2 border-border flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-all active:scale-90"
            >
              <Minus size={16} />
            </button>
            <span className="text-2xl font-bold text-foreground w-8 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all active:scale-90 shadow-md"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Add to cart bar */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
        <button
          onClick={handleAdd}
          className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base flex items-center justify-between px-5 shadow-2xl hover:bg-primary/90 transition-all active:scale-95"
        >
          <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-bold">{quantity}</span>
          <span>{t.addToCart}</span>
          <span className="font-bold">{t.thb}{totalPrice}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Cart Screen ──────────────────────────────────────────────────────────────

interface CartProps {
  lang: Language;
  tableNumber: number;
  cart: CartItem[];
  onBack: () => void;
  onUpdateQty: (cartId: string, qty: number) => void;
  onRemove: (cartId: string) => void;
  onConfirm: () => void;
  onLangToggle: () => void;
  isTakeaway?: boolean;
}

function CartScreen({ lang, tableNumber, cart, onBack, onUpdateQty, onRemove, onConfirm, onLangToggle, isTakeaway }: CartProps) {
  const t = T[lang];
  const total = cartTotal(cart);

  function optionSummary(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(`${T[lang].meatEmoji[ci.meat]} ${T[lang].meats[ci.meat]}`);
    if (ci.portion === "special") parts.push(t.special);
    if (ci.item.hasSpice) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(t.eggAdded);
    ci.addOns.forEach((id) => {
      const addon = ADD_ONS.find((a) => a.id === id);
      if (addon) parts.push(lang === "en" ? addon.label.en : addon.label.th);
    });
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(" · ");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-lg text-[#FFF8F0]">{t.cart}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onLangToggle}
              className="text-[#D07E35] text-xs font-semibold hover:text-[#FFF8F0] transition-colors"
            >
              {t.langSwitch}
            </button>
            <div className="bg-[#4A6741] px-2.5 py-1 rounded-full">
              <span className="text-[#FFF8F0] text-xs font-medium">
                {isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex-1 px-4 py-4 pb-36 overflow-y-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
              <ShoppingCart className="text-muted-foreground" size={34} />
            </div>
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">{t.emptyCart}</h2>
            <p className="text-muted-foreground text-sm mb-6">{t.emptyCartSub}</p>
            <button
              onClick={onBack}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-all"
            >
              {t.goToMenu}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((ci) => (
              <div key={ci.cartId} className="bg-card rounded-2xl p-4 border border-border">
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                    <img
                      src={resolvePhoto(ci.item.photo, 128, 128)}
                      alt={lang === "en" ? ci.item.name.en : ci.item.name.th}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-foreground text-sm leading-snug">
                        {lang === "en" ? ci.item.name.en : ci.item.name.th}
                      </div>
                      <button
                        onClick={() => onRemove(ci.cartId)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {optionSummary(ci) && (
                      <div className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
                        {optionSummary(ci)}
                      </div>
                    )}
                    {ci.note && (
                      <div className="text-muted-foreground text-xs mt-0.5 italic">"{ci.note}"</div>
                    )}
                    <div className="flex items-center justify-between mt-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onUpdateQty(ci.cartId, ci.quantity - 1)}
                          className="w-7 h-7 rounded-full bg-muted flex items-center justify-center hover:bg-primary/10 transition-all active:scale-90"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-sm font-bold w-5 text-center">{ci.quantity}</span>
                        <button
                          onClick={() => onUpdateQty(ci.cartId, ci.quantity + 1)}
                          className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all active:scale-90"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="font-bold text-primary">{t.thb}{cartItemTotal(ci)}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border px-4 pb-4 pt-3">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-foreground text-base">{t.total}</span>
            <span className="font-display font-bold text-2xl text-primary">{t.thb}{total}</span>
          </div>
          <button
            onClick={onConfirm}
            className="w-full bg-secondary text-secondary-foreground py-4 rounded-2xl font-semibold text-lg shadow-lg hover:bg-secondary/90 transition-all active:scale-95"
          >
            {t.confirmOrder}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Order Sent Screen ────────────────────────────────────────────────────────

interface OrderSentProps {
  lang: Language;
  tableNumber: number;
  onOrderMore: () => void;
}

function OrderSentScreen({ lang, tableNumber, onOrderMore }: OrderSentProps) {
  const t = T[lang];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center mb-6"
        style={{ background: "linear-gradient(135deg, #4A6741/20, #4A6741/5)" }}
      >
        <div className="w-28 h-28 rounded-full bg-secondary/15 flex items-center justify-center">
          <CheckCircle className="text-secondary" size={56} />
        </div>
      </div>

      <h1 className="font-display text-3xl font-semibold text-foreground mb-3">{t.orderSent}</h1>
      <p className="text-muted-foreground text-base leading-relaxed mb-6 max-w-xs">{t.orderSentMsg}</p>

      <div
        className="rounded-2xl px-6 py-3 mb-8 border"
        style={{
          background: "rgba(74, 103, 65, 0.08)",
          borderColor: "rgba(74, 103, 65, 0.25)",
        }}
      >
        <div className="text-secondary font-semibold text-sm">
          {t.tableLabel} {tableNumber}
        </div>
      </div>

      <div
        className="w-full max-w-xs h-px mb-8"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(60,36,20,0.15), transparent)",
        }}
      />

      <button
        onClick={onOrderMore}
        className="px-10 py-4 bg-primary text-primary-foreground rounded-2xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
      >
        {t.orderMore}
      </button>
    </div>
  );
}

// ─── Staff Login Screen ───────────────────────────────────────────────────────

interface StaffLoginProps {
  lang: Language;
  onLogin: (pw: string) => void;
  onBack: () => void;
  error: boolean;
  onLangToggle: () => void;
}

function StaffLoginScreen({ lang, onLogin, onBack, error, onLangToggle }: StaffLoginProps) {
  const t = T[lang];
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414]">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">{t.staffLogin}</div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">
            {t.langSwitch}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <Lock className="text-primary" size={32} />
            </div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{t.staffLogin}</h1>
            <p className="text-muted-foreground text-sm mt-1">Baan Lanna — Staff Portal</p>
          </div>

          <div className="relative mb-3">
            <input
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLogin(pw)}
              placeholder={t.password}
              className={`w-full bg-card border-2 rounded-xl px-4 py-3.5 text-foreground pr-12 outline-none transition-all ${error ? "border-destructive" : "border-border focus:border-primary"
                }`}
            />
            <button
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <p className="text-destructive text-sm mb-3 flex items-center gap-1.5">
              <span>⚠️</span> {t.wrongPass}
            </p>
          )}

          <button
            onClick={() => onLogin(pw)}
            className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-md"
          >
            {t.loginBtn}
          </button>

          <p className="text-center text-muted-foreground/50 text-xs mt-6">
            Demo password: <span className="font-mono text-muted-foreground">lanna2024</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Staff Header (shared) ────────────────────────────────────────────────────

interface StaffHeaderProps {
  lang: Language;
  activeTab: "orders" | "payment" | "menu" | "history";
  onTabChange: (tab: "orders" | "payment" | "menu" | "history") => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onSeedMenu?: () => void;
}

function StaffHeader({ lang, activeTab, onTabChange, onLogout, onLangToggle, onSeedMenu }: StaffHeaderProps) {
  const t = T[lang];
  return (
    <div className="bg-[#3C2414] sticky top-0 z-50">
      <LannaBorder />
      <div className="px-4 py-2.5 flex items-center justify-between">
        <RestaurantLogo dark />
        <div className="flex items-center gap-1">
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs px-2 py-1 hover:text-[#FFF8F0] transition-colors">
            {t.langSwitch}
          </button>
          {onSeedMenu && (
            <button onClick={onSeedMenu} className="text-[10px] text-[#E6D5BA]/40 hover:text-[#E6D5BA] px-2 border border-[#E6D5BA]/20 rounded-full">
              Import Menu
            </button>
          )}
          <button onClick={onLogout} className="text-[#E6D5BA]/50 hover:text-[#E6D5BA] transition-colors p-1.5">
            <LogOut size={17} />
          </button>
        </div>
      </div>
      <div className="flex px-4 pb-0">
        {(["orders", "payment", "menu", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === tab
              ? "border-[#D07E35] text-[#FFF8F0]"
              : "border-transparent text-[#E6D5BA]/60 hover:text-[#E6D5BA]"
              }`}
          >
            {tab === "orders" ? <Clock size={14} /> : tab === "payment" ? <CreditCard size={14} /> : tab === "menu" ? <Utensils size={14} /> : <CheckCircle size={14} />}
            {tab === "orders" ? t.staffOrders : tab === "payment" ? t.staffPayment : tab === "menu" ? (lang === "en" ? "Menu" : "จัดการเมนู") : (lang === "en" ? "History" : "ประวัติ")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Staff Orders Screen ──────────────────────────────────────────────────────

interface StaffOrdersProps {
  lang: Language;
  orders: Order[];
  onMarkServed: (orderId: string) => void;
  onRemoveItem: (orderId: string, cartId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history") => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onSeedMenu?: () => void;
  onStartTakeaway?: () => void;
}

function StaffOrdersScreen({ lang, orders, onMarkServed, onRemoveItem, onCancelOrder, onTabChange, onLogout, onLangToggle, onSeedMenu, onStartTakeaway }: StaffOrdersProps) {
  const t = T[lang];
  const takeawayOrders = orders.filter((o) => o.isTakeaway && o.status === "in-progress");
  const inProgress = orders.filter((o) => o.status === "in-progress" && !o.isTakeaway);
  const awaitingPayment = orders.filter((o) => o.status === "awaiting-payment" && !o.isTakeaway);

  // Group awaiting orders by table
  const awaitingByTable: Record<number, { orders: Order[]; total: number }> = {};
  awaitingPayment.forEach((o) => {
    if (!awaitingByTable[o.tableNumber]) {
      awaitingByTable[o.tableNumber] = { orders: [], total: 0 };
    }
    awaitingByTable[o.tableNumber].orders.push(o);
    awaitingByTable[o.tableNumber].total += orderTotal(o);
  });
  const awaitingTables = Object.entries(awaitingByTable)
    .sort(([a], [b]) => Number(a) - Number(b));

  function optionSummary(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(T[lang].meats[ci.meat]);
    if (ci.portion === "special") parts.push(t.special);
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(t.eggAdded);
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(", ");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader
        lang={lang}
        activeTab="orders"
        onTabChange={onTabChange}
        onLogout={onLogout}
        onLangToggle={onLangToggle}
        onSeedMenu={onSeedMenu}
      />

      <div
        className="flex-1 px-4 py-5 overflow-y-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {onStartTakeaway && (
          <button
            onClick={onStartTakeaway}
            className="w-full mb-5 bg-secondary text-secondary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {lang === "en" ? "New Takeaway Order" : "สั่งกลับบ้านใหม่"}
          </button>
        )}

        {/* Takeaway orders */}
        {takeawayOrders.length > 0 && (
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-accent" />
              <h2 className="font-semibold text-foreground">{lang === "en" ? "Takeaway" : "กลับบ้าน"}</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                {takeawayOrders.length}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {takeawayOrders.map((order) => (
                <div key={order.id} className="bg-card rounded-2xl border-2 overflow-hidden" style={{ borderColor: "rgba(208, 126, 53, 0.4)" }}>
                  <div className="px-4 py-3 flex items-center justify-between border-b" style={{ background: "rgba(208, 126, 53, 0.08)", borderColor: "rgba(208, 126, 53, 0.15)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-accent text-accent-foreground font-display font-bold text-sm rounded-full flex items-center justify-center flex-shrink-0">
                        {order.takeawayLabel}
                      </div>
                      <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                    </div>
                    <button
                      onClick={() => { if (window.confirm(t.confirmCancelOrder)) onCancelOrder(order.id); }}
                      className="text-destructive/60 hover:text-destructive transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="px-4 py-3 space-y-2.5">
                    {order.items.map((ci) => (
                      <div key={ci.cartId} className="flex items-start gap-2.5">
                        <div className="bg-primary/15 text-primary font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                          {ci.quantity}
                        </div>
                        <div className="text-foreground text-sm font-medium leading-tight">
                          {lang === "en" ? ci.item.name.en : ci.item.name.th}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 pb-4">
                    <button
                      onClick={() => onMarkServed(order.id)}
                      className="w-full bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Check size={15} />
                      {lang === "en" ? "Ready for pickup" : "พร้อมรับแล้ว"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* In Progress */}
        <div className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="font-semibold text-foreground">{t.inProgress}</h2>
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
              {inProgress.length}
            </span>
          </div>

          {inProgress.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
              {t.noActiveOrders}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {inProgress.map((order) => (
                <div
                  key={order.id}
                  className="bg-card rounded-2xl border-2 overflow-hidden"
                  style={{ borderColor: "rgba(217, 119, 6, 0.3)" }}
                >
                  {/* Order header */}
                  <div
                    className="px-4 py-3 flex items-center justify-between border-b"
                    style={{ background: "rgba(251, 191, 36, 0.08)", borderColor: "rgba(217, 119, 6, 0.15)" }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#3C2414] text-[#FFF8F0] font-display font-bold text-lg rounded-full flex items-center justify-center flex-shrink-0">
                        {order.tableNumber}
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t.tableLabel}</div>
                        <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                        <Clock size={12} />
                        <span>{formatClock(order.timestamp)}</span>
                      </div>
                      <button
                        onClick={() => {
                          if (window.confirm(t.confirmCancelOrder)) onCancelOrder(order.id);
                        }}
                        className="text-destructive/60 hover:text-destructive transition-colors"
                        title={t.cancelOrder}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="px-4 py-3 space-y-2.5">
                    {order.items.map((ci) => (
                      <div key={ci.cartId} className="flex items-start gap-2.5">
                        <div className="bg-primary/15 text-primary font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                          {ci.quantity}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-foreground text-sm font-medium leading-tight">
                            {lang === "en" ? ci.item.name.en : ci.item.name.th}
                          </div>
                          {optionSummary(ci) && (
                            <div className="text-muted-foreground text-xs mt-0.5">{optionSummary(ci)}</div>
                          )}
                          {ci.note && (
                            <div className="text-amber-700 text-xs mt-0.5 italic">"{ci.note}"</div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (window.confirm(t.confirmRemoveItem)) onRemoveItem(order.id, ci.cartId);
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 mt-0.5"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Action */}
                  <div className="px-4 pb-4">
                    <button
                      onClick={() => onMarkServed(order.id)}
                      className="w-full bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Check size={15} />
                      {t.markServed}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Awaiting Payment */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
            <h2 className="font-semibold text-foreground">{t.awaitingPayment}</h2>
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
              {awaitingTables.length}
            </span>
          </div>

          {awaitingTables.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
              {t.noTablesWaiting}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {awaitingTables.map(([tableNum, data]) => (
                <div
                  key={tableNum}
                  className="bg-card rounded-2xl border-2 overflow-hidden opacity-80"
                  style={{ borderColor: "rgba(74, 103, 65, 0.3)" }}
                >
                  <div
                    className="px-4 py-3 flex items-center justify-between border-b"
                    style={{ background: "rgba(74, 103, 65, 0.06)", borderColor: "rgba(74, 103, 65, 0.15)" }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-secondary text-secondary-foreground font-display font-bold text-lg rounded-full flex items-center justify-center flex-shrink-0">
                        {tableNum}
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t.tableLabel}</div>
                        <div className="text-muted-foreground text-sm">
                          {data.orders.length} {data.orders.length === 1 ? t.rounds : t.roundsPlural}
                        </div>
                      </div>
                    </div>
                    <div className="font-display font-bold text-xl text-foreground">
                      {t.thb}{data.total}
                    </div>
                  </div>
                  <div className="px-4 py-2.5">
                    <div className="text-xs text-muted-foreground">
                      {data.orders.reduce((s, o) => s + o.items.length, 0)} {t.items} · {t.awaitingPayment}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Staff Payment Screen ─────────────────────────────────────────────────────

interface StaffPaymentProps {
  lang: Language;
  orders: Order[];
  selectedTable: number | null;
  onSelectTable: (n: number) => void;
  onCloseTable: (n: number, paymentMethod: PaymentMethod, cashReceived?: number) => void;
  onCloseTakeaway: (orderId: string, paymentMethod: PaymentMethod, cashReceived?: number) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

function StaffPaymentScreen({
  lang, orders, selectedTable, onSelectTable, onCloseTable, onCloseTakeaway, onTabChange, onLogout, onLangToggle,
}: StaffPaymentProps) {
  const t = T[lang];
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [selectedTakeawayId, setSelectedTakeawayId] = useState<string | null>(null);
  const awaitingPayment = orders.filter((o) => o.status === "awaiting-payment" && !o.isTakeaway);
  const takeawayAwaiting = orders.filter((o) => o.status === "awaiting-payment" && o.isTakeaway);
  const selectedTakeawayOrder = takeawayAwaiting.find((o) => o.id === selectedTakeawayId) || null;
  const tableNumbers = [...new Set(awaitingPayment.map((o) => o.tableNumber))].sort((a, b) => a - b);

  const tableOrders = selectedTable
    ? awaitingPayment.filter((o) => o.tableNumber === selectedTable)
    : [];
  const tableSum = tableOrders.reduce((sum, o) => sum + orderTotal(o), 0);
  const allItems = tableOrders.flatMap((o) => o.items);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader
        lang={lang}
        activeTab="payment"
        onTabChange={onTabChange}
        onLogout={onLogout}
        onLangToggle={onLangToggle}
      />

      <div
        className="flex-1 px-4 py-5 overflow-y-auto"
        style={{ scrollbarWidth: "none" }}
      >

        {takeawayAwaiting.length > 0 && (
          <div className="mb-6">
            <h3 className="font-semibold text-foreground text-sm mb-3">
              {lang === "en" ? "Takeaway — Awaiting Payment" : "กลับบ้าน — รอชำระเงิน"}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {takeawayAwaiting.map((order) => {
                const isSelected = selectedTakeawayId === order.id;
                const orderSum = orderTotal(order);
                return (
                  <div key={order.id} className="bg-card rounded-2xl border-2 overflow-hidden" style={{ borderColor: isSelected ? "rgba(192,90,37,0.6)" : "rgba(208,126,53,0.3)" }}>
                    <button
                      onClick={() => { setSelectedTakeawayId(isSelected ? null : order.id); setPaymentMethod("cash"); setCashInput(""); }}
                      className="w-full px-4 py-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-accent text-accent-foreground font-display font-bold text-sm rounded-full flex items-center justify-center flex-shrink-0">
                          {order.takeawayLabel}
                        </div>
                        <div className="text-foreground text-sm font-medium">
                          {order.items.reduce((s, ci) => s + ci.quantity, 0)} {t.items}
                        </div>
                      </div>
                      <div className="font-display font-bold text-lg text-primary">{t.thb}{orderSum}</div>
                    </button>

                    {isSelected && (
                      <div className="px-4 pb-4 border-t border-border pt-3">
                        <div className="flex gap-2 mb-3">
                          {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
                            <button
                              key={m}
                              onClick={() => { setPaymentMethod(m); setCashInput(""); }}
                              className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all ${paymentMethod === m
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-card border-border text-foreground"
                                }`}
                            >
                              {m === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน")}
                            </button>
                          ))}
                        </div>
                        {paymentMethod === "cash" && (
                          <div className="mb-3">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={cashInput}
                              onChange={(e) => setCashInput(e.target.value.replace(/[^0-9]/g, ""))}
                              placeholder={lang === "en" ? "Cash received" : "รับเงินมา"}
                              className="w-full bg-background border-2 border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                            {cashInput !== "" && (
                              <div className={`text-sm font-semibold mt-1.5 ${Number(cashInput) >= orderSum ? "text-secondary" : "text-destructive"}`}>
                                {Number(cashInput) >= orderSum
                                  ? `${lang === "en" ? "Change" : "เงินทอน"}: ${t.thb}${Number(cashInput) - orderSum}`
                                  : (lang === "en" ? "Amount not enough" : "จำนวนเงินไม่พอ")}
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            onCloseTakeaway(order.id, paymentMethod, paymentMethod === "cash" ? Number(cashInput || 0) : undefined);
                            setSelectedTakeawayId(null);
                          }}
                          disabled={paymentMethod === "cash" && (cashInput === "" || Number(cashInput) < orderSum)}
                          className="w-full bg-secondary text-secondary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Check size={16} />
                          {t.closeTable}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tableNumbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
              <CreditCard className="text-muted-foreground/50" size={34} />
            </div>
            <p className="text-muted-foreground text-sm">{t.noTablesWaiting}</p>
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[auto_1fr] lg:gap-8 lg:items-start">
            {/* Table picker */}
            <div className="mb-6 lg:mb-0 lg:w-64">
              <p className="text-muted-foreground text-sm mb-3">{t.selectTablePay}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 gap-2.5">
                {tableNumbers.map((tn) => (
                  <button
                    key={tn}
                    onClick={() => onSelectTable(tn)}
                    className={`aspect-square rounded-2xl flex flex-col items-center justify-center border-2 transition-all ${selectedTable === tn
                      ? "bg-primary border-primary text-primary-foreground shadow-lg scale-105"
                      : "bg-card border-border text-foreground hover:border-primary/40 hover:bg-primary/5 active:scale-95"
                      }`}
                  >
                    <div className="font-display font-bold text-xl">{tn}</div>
                    <div className="text-[9px] opacity-60 mt-0.5 uppercase tracking-wide">{t.tableLabel}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Order summary */}
            {selectedTable && tableOrders.length > 0 && (
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                {/* Summary header */}
                <div
                  className="px-5 py-4 border-b border-border"
                  style={{ background: "linear-gradient(135deg, rgba(60,36,20,0.06), rgba(60,36,20,0.02))" }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display text-xl font-semibold text-foreground">
                        {t.tableLabel} {selectedTable}
                      </div>
                      <div className="text-muted-foreground text-xs mt-0.5">
                        {tableOrders.length} {tableOrders.length === 1 ? t.rounds : t.roundsPlural}
                        {" · "}
                        {allItems.reduce((s, ci) => s + ci.quantity, 0)} {t.items}
                      </div>
                    </div>
                    <div className="font-display font-bold text-2xl text-primary">{t.thb}{tableSum}</div>
                  </div>
                </div>

                {/* Items list */}
                <div
                  className="px-5 py-4 space-y-2.5 max-h-80 overflow-y-auto"
                  style={{ scrollbarWidth: "none" }}
                >
                  {allItems.map((ci, idx) => (
                    <div
                      key={`${ci.cartId}-${idx}`}
                      className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-muted-foreground text-sm font-medium flex-shrink-0">
                          {ci.quantity}×
                        </span>
                        <div className="min-w-0">
                          <div className="text-foreground text-sm font-medium truncate">
                            {lang === "en" ? ci.item.name.en : ci.item.name.th}
                          </div>
                          {ci.addEgg && (
                            <div className="text-muted-foreground text-xs">{t.eggAdded}</div>
                          )}
                        </div>
                      </div>
                      <span className="text-foreground font-semibold text-sm flex-shrink-0 ml-3">
                        {t.thb}{cartItemTotal(ci)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Payment method */}
                <div className="px-5 py-4 border-t border-border">
                  <div className="text-sm font-semibold text-foreground mb-2.5">
                    {lang === "en" ? "Payment Method" : "วิธีจ่ายเงิน"}
                  </div>
                  <div className="flex gap-2 mb-3">
                    {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setPaymentMethod(m); setCashInput(""); }}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${paymentMethod === m
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-foreground hover:border-primary/40"
                          }`}
                      >
                        {m === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน")}
                      </button>
                    ))}
                  </div>

                  {paymentMethod === "cash" && (
                    <div className="mb-1">
                      <label className="text-xs text-muted-foreground block mb-1">
                        {lang === "en" ? "Cash received" : "รับเงินมา"}
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={cashInput}
                        onChange={(e) => setCashInput(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="0"
                        className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                      />
                      {cashInput !== "" && (
                        <div className={`text-sm font-semibold mt-2 ${Number(cashInput) >= tableSum ? "text-secondary" : "text-destructive"}`}>
                          {Number(cashInput) >= tableSum
                            ? `${lang === "en" ? "Change" : "เงินทอน"}: ${t.thb}${Number(cashInput) - tableSum}`
                            : (lang === "en" ? "Amount not enough" : "จำนวนเงินไม่พอ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Total & close */}
                <div className="px-5 py-4 border-t border-border bg-muted/20">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-semibold text-foreground text-base">{t.tableTotal}</span>
                    <span className="font-display font-bold text-2xl text-primary">{t.thb}{tableSum}</span>
                  </div>
                  <button
                    onClick={() =>
                      onCloseTable(
                        selectedTable,
                        paymentMethod,
                        paymentMethod === "cash" ? Number(cashInput || 0) : undefined
                      )
                    }
                    disabled={paymentMethod === "cash" && (cashInput === "" || Number(cashInput) < tableSum)}
                    className="w-full bg-secondary text-secondary-foreground py-4 rounded-2xl font-semibold text-base hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check size={18} />
                    {t.closeTable}
                  </button>
                </div>
              </div>
            )}

            {selectedTable && tableOrders.length === 0 && (
              <div className="bg-card rounded-2xl border border-border px-6 py-10 text-center text-muted-foreground text-sm">
                No pending orders for this table.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface StaffMenuProps {
  lang: Language;
  items: (MenuItem & { active?: boolean })[];
  onAdd: () => void;
  onEdit: (item: MenuItem) => void;
  onToggleActive: (item: MenuItem, active: boolean) => void;
  onDelete: (itemId: string) => void;
  onTabChange: (tab: "orders" | "payment" | "menu" | "history") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

function StaffMenuScreen({
  lang, items, onAdd, onEdit, onToggleActive, onDelete, onTabChange, onLogout, onLangToggle,
}: StaffMenuProps) {
  const t = T[lang];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="menu" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <button
          onClick={onAdd}
          className="w-full mb-4 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          {lang === "en" ? "Add New Item" : "เพิ่มเมนูใหม่"}
        </button>

        {CATEGORIES.map((cat) => {
          const catItems = items.filter((i) => i.categoryId === cat.id);
          if (catItems.length === 0) return null;
          return (
            <div key={cat.id} className="mb-6">
              <h3 className="font-semibold text-foreground text-sm mb-2 flex items-center gap-1.5">
                <span>{cat.icon}</span>
                {lang === "en" ? cat.name.en : cat.name.th}
              </h3>
              <div className="space-y-2">
                {catItems.map((item) => (
                  <div
                    key={item.id}
                    className={`bg-card rounded-xl border border-border p-3 flex items-center gap-3 ${item.active === false ? "opacity-50" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm truncate">
                        {lang === "en" ? item.name.en : item.name.th}
                      </div>
                      <div className="text-muted-foreground text-xs">{t.thb}{item.price}</div>
                    </div>
                    <button
                      onClick={() => onToggleActive(item, item.active === false)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${item.active === false
                        ? "bg-muted text-muted-foreground"
                        : "bg-secondary/15 text-secondary"
                        }`}
                    >
                      {item.active === false ? (lang === "en" ? "Off" : "ปิด") : (lang === "en" ? "On" : "เปิด")}
                    </button>
                    <button onClick={() => onEdit(item)} className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
                      <Utensils size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(lang === "en" ? "Delete this item?" : "ลบเมนูนี้?")) onDelete(item.id);
                      }}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StaffMenuEditProps {
  lang: Language;
  item: MenuItem;
  onSave: (item: MenuItem) => void;
  onCancel: () => void;
  onLangToggle: () => void;
}

function StaffMenuEditScreen({ lang, item, onSave, onCancel, onLangToggle }: StaffMenuEditProps) {
  const t = T[lang];
  const [form, setForm] = useState<MenuItem>(item);

  const update = (patch: Partial<MenuItem>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {lang === "en" ? "Edit Menu Item" : "แก้ไขเมนู"}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-5 overflow-y-auto pb-28" style={{ scrollbarWidth: "none" }}>
        <div className="mb-5">
          <label className="text-sm font-semibold text-foreground block mb-1.5">
            {lang === "en" ? "Photo" : "รูปภาพ"}
          </label>
          {form.photo ? (
            <div className="relative w-full h-40 rounded-xl overflow-hidden bg-muted mb-2">
              <img src={resolvePhoto(form.photo, 600, 400)} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => update({ photo: "" })}
                className="absolute top-2 right-2 bg-black/60 text-white p-1.5 rounded-full hover:bg-black/80 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <div className="w-full h-40 rounded-xl bg-muted flex items-center justify-center mb-2 text-muted-foreground text-sm">
              {lang === "en" ? "No photo" : "ยังไม่มีรูป"}
            </div>
          )}
          <label className="block w-full text-center bg-card border-2 border-dashed border-border rounded-xl py-2.5 text-sm font-medium text-foreground cursor-pointer hover:border-primary/40 transition-all">
            {lang === "en" ? "Upload Photo" : "อัปโหลดรูปภาพ"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const base64 = await compressImage(file);
                  update({ photo: base64 });
                }
              }}
            />
          </label>
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">
            {lang === "en" ? "Category" : "หมวดหมู่"}
          </label>
          <select
            value={form.categoryId}
            onChange={(e) => update({ categoryId: e.target.value })}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{lang === "en" ? c.name.en : c.name.th}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">Name (English)</label>
          <input
            value={form.name.en}
            onChange={(e) => update({ name: { ...form.name, en: e.target.value } })}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">ชื่อ (ภาษาไทย)</label>
          <input
            value={form.name.th}
            onChange={(e) => update({ name: { ...form.name, th: e.target.value } })}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">Description (English)</label>
          <textarea
            value={form.description.en}
            onChange={(e) => update({ description: { ...form.description, en: e.target.value } })}
            rows={3}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary resize-none"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">คำอธิบาย (ภาษาไทย)</label>
          <textarea
            value={form.description.th}
            onChange={(e) => update({ description: { ...form.description, th: e.target.value } })}
            rows={3}
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary resize-none"
          />
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold text-foreground block mb-1.5">
            {lang === "en" ? "Price (THB)" : "ราคา (บาท)"}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={form.price === 0 ? "" : form.price}
            onChange={(e) => update({ price: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
            placeholder="0"
            className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="h-px bg-border my-5" />

        <h3 className="font-semibold text-foreground text-sm mb-3">
          {lang === "en" ? "Options" : "ตัวเลือกของเมนูนี้"}
        </h3>

        {/* Built-in toggles */}
        <div className="space-y-2 mb-5">
          {[
            { key: "hasMeatChoice" as const, label: lang === "en" ? "Meat Choice" : "เลือกเนื้อสัตว์" },
            { key: "hasSpice" as const, label: lang === "en" ? "Spice Level" : "ระดับความเผ็ด" },
            { key: "hasPortion" as const, label: lang === "en" ? "Portion Size" : "ขนาดจาน (ธรรมดา/พิเศษ)" },
            { key: "hasEggAddon" as const, label: lang === "en" ? "Add Fried Egg" : "เพิ่มไข่ดาว" },
            { key: "hasPlainAddOns" as const, label: lang === "en" ? "Extra Plate/Cutlery/Water" : "จาน/ช้อนส้อม/แก้วน้ำเพิ่ม" },
          ].map((opt) => {
            const isOn = opt.key === "hasEggAddon" || opt.key === "hasPlainAddOns"
              ? form[opt.key] !== false
              : !!form[opt.key];
            return (
              <button
                key={opt.key}
                onClick={() => update({ [opt.key]: !isOn } as Partial<MenuItem>)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${isOn ? "bg-primary/8 border-primary" : "bg-card border-border"
                  }`}
              >
                <span className="text-sm font-medium text-foreground">{opt.label}</span>
                <div className={`w-11 h-6 rounded-full relative transition-colors ${isOn ? "bg-primary" : "bg-muted"}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${isOn ? "left-[22px]" : "left-0.5"}`} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Meat price deltas — only if meat choice is on */}
        {form.hasMeatChoice && (
          <div className="mb-5">
            <label className="text-sm font-semibold text-foreground block mb-2">
              {lang === "en" ? "Extra price per meat type (0 = same price)" : "ราคาเพิ่มต่อชนิดเนื้อ (0 = ราคาเท่ากัน)"}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["pork", "chicken", "beef"] as MeatChoice[]).map((m) => (
                <div key={m}>
                  <div className="text-xs text-muted-foreground mb-1">{T[lang].meats[m]}</div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.meatPriceDeltas?.[m] || ""}
                    onChange={(e) =>
                      update({
                        meatPriceDeltas: { ...form.meatPriceDeltas, [m]: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 },
                      })
                    }
                    placeholder="0"
                    className="w-full bg-card border-2 border-border rounded-lg px-2 py-2 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Portion price delta — only if portion is on */}
        {form.hasPortion && (
          <div className="mb-5">
            <label className="text-sm font-semibold text-foreground block mb-1.5">
              {lang === "en" ? "Extra price for Special portion" : "ราคาเพิ่มถ้าเลือกขนาดพิเศษ"}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={form.portionPriceDelta || ""}
              onChange={(e) => update({ portionPriceDelta: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
              placeholder="0"
              className="w-full bg-card border-2 border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        )}

        {/* Custom groups manager */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-foreground">
              {lang === "en" ? "Custom Option Groups" : "ตัวเลือกที่สร้างเอง"}
            </label>
            <button
              onClick={() =>
                update({
                  customGroups: [
                    ...(form.customGroups || []),
                    { id: uid(), nameTh: "", nameEn: "", type: "single", choices: [] },
                  ],
                })
              }
              className="text-primary text-xs font-semibold flex items-center gap-1"
            >
              <Plus size={14} /> {lang === "en" ? "Add Group" : "เพิ่มกลุ่ม"}
            </button>
          </div>

          {(form.customGroups || []).map((group, gIdx) => (
            <div key={group.id} className="bg-card border border-border rounded-xl p-3 mb-2.5">
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={group.nameEn}
                  onChange={(e) => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, nameEn: e.target.value };
                    update({ customGroups: groups });
                  }}
                  placeholder="Group name (EN)"
                  className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <input
                  value={group.nameTh}
                  onChange={(e) => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, nameTh: e.target.value };
                    update({ customGroups: groups });
                  }}
                  placeholder="ชื่อกลุ่ม (TH)"
                  className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={() => {
                    const groups = (form.customGroups || []).filter((_, i) => i !== gIdx);
                    update({ customGroups: groups });
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs text-muted-foreground">
                  {lang === "en" ? "Selection type:" : "แบบเลือก:"}
                </span>
                <select
                  value={group.type}
                  onChange={(e) => {
                    const groups = [...(form.customGroups || [])];
                    groups[gIdx] = { ...group, type: e.target.value as "single" | "multi" };
                    update({ customGroups: groups });
                  }}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none"
                >
                  <option value="single">{lang === "en" ? "Choose 1" : "เลือกได้ 1"}</option>
                  <option value="multi">{lang === "en" ? "Choose many" : "เลือกได้หลายอย่าง"}</option>
                </select>
              </div>

              <div className="space-y-1.5 mb-2">
                {group.choices.map((choice, cIdx) => (
                  <div key={choice.id} className="flex items-center gap-1.5">
                    <input
                      value={choice.labelEn}
                      onChange={(e) => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, labelEn: e.target.value };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      placeholder="Choice (EN)"
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <input
                      value={choice.labelTh}
                      onChange={(e) => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, labelTh: e.target.value };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      placeholder="ตัวเลือก (TH)"
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={choice.priceDelta || ""}
                      onChange={(e) => {
                        const groups = [...(form.customGroups || [])];
                        const choices = [...group.choices];
                        choices[cIdx] = { ...choice, priceDelta: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 };
                        groups[gIdx] = { ...group, choices };
                        update({ customGroups: groups });
                      }}
                      placeholder="+฿"
                      className="w-16 bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => {
                        const groups = [...(form.customGroups || [])];
                        groups[gIdx] = { ...group, choices: group.choices.filter((_, i) => i !== cIdx) };
                        update({ customGroups: groups });
                      }}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => {
                  const groups = [...(form.customGroups || [])];
                  groups[gIdx] = {
                    ...group,
                    choices: [...group.choices, { id: uid(), labelEn: "", labelTh: "", priceDelta: 0 }],
                  };
                  update({ customGroups: groups });
                }}
                className="text-primary text-xs font-semibold flex items-center gap-1"
              >
                <Plus size={12} /> {lang === "en" ? "Add Choice" : "เพิ่มตัวเลือก"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent">
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.en || !form.name.th}
          className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base disabled:opacity-40 hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
        >
          {lang === "en" ? "Save" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}

interface StaffHistoryProps {
  lang: Language;
  orders: Order[];
  onTabChange: (tab: "orders" | "payment" | "menu" | "history") => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

function StaffHistoryScreen({ lang, orders, onTabChange, onLogout, onLangToggle }: StaffHistoryProps) {
  const t = T[lang];
  const paidOrders = orders
    .filter((o) => o.status === "paid")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  function dateLabel(date: Date): string {
    return date.toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  const grouped: Record<string, Order[]> = {};
  paidOrders.forEach((o) => {
    const key = dateLabel(o.timestamp);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="history" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {paidOrders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {lang === "en" ? "No completed orders yet" : "ยังไม่มีออเดอร์ที่เสร็จสิ้น"}
          </div>
        ) : (
          Object.entries(grouped).map(([dateStr, dayOrders]) => {
            const dayTotal = dayOrders.reduce((s, o) => s + orderTotal(o), 0);
            return (
              <div key={dateStr} className="mb-6">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="font-semibold text-foreground text-sm">{dateStr}</h3>
                  <span className="text-muted-foreground text-xs">
                    {dayOrders.length} {t.rounds} · {t.thb}{dayTotal}
                  </span>
                </div>
                <div className="space-y-2">
                  {dayOrders.map((o) => (
                    <div key={o.id} className="bg-card rounded-xl border border-border p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {t.tableLabel} {o.tableNumber}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatClock(o.timestamp)} · {o.items.reduce((s, ci) => s + ci.quantity, 0)} {t.items}
                        </div>
                      </div>
                      <div className="font-semibold text-primary text-sm">{t.thb}{orderTotal(o)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function getTableFromUrl(): number | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("table");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [lang, setLang] = useState<Language>("en");
  const [view, setView] = useState<View>(() => (getTableFromUrl() ? "menu" : "staff-login"));
  const [tableNumber, setTableNumber] = useState<number | null>(() => getTableFromUrl());

  // Customer state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(CATEGORIES[0].id);

  // Staff state
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const [allMenuItems, setAllMenuItems] = useState<(MenuItem & { active?: boolean })[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "menuItems"), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem & { active?: boolean }));
      setAllMenuItems(data);
      setMenuItems(data.filter((m) => m.active !== false));
    });
    return () => unsubscribe();
  }, []);
  useEffect(() => {
    const q = query(collection(db, "orders"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          tableNumber: raw.tableNumber,
          timestamp: raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(),
          items: raw.items,
          status: raw.status,
          paymentMethod: raw.paymentMethod,
          cashReceived: raw.cashReceived,
        } as Order;
      });
      setOrders(data);
    });
    return () => unsubscribe();
  }, []);

  const [selectedPayTable, setSelectedPayTable] = useState<number | null>(null);
  const [loginError, setLoginError] = useState(false);
  const [staffTab, setStaffTab] = useState<"orders" | "payment" | "menu" | "history">("orders");
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [takeawayCart, setTakeawayCart] = useState<CartItem[]>([]);
  const [takeawayCategory, setTakeawayCategory] = useState<string>(CATEGORIES[0].id);
  const [takeawaySelectedItem, setTakeawaySelectedItem] = useState<MenuItem | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && !getTableFromUrl()) {
        setView((v) => (v === "staff-login" ? "staff-orders" : v));
      }
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  const toggleLang = () => setLang((l) => (l === "en" ? "th" : "en"));

  const handleSelectItem = (item: MenuItem) => {
    setSelectedItem(item);
    setView("item-detail");
  };

  const handleAddToCart = (ci: CartItem) => {
    setCart((prev) => [...prev, ci]);
    setView("menu");
  };

  const handleUpdateQty = (cartId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
    } else {
      setCart((prev) => prev.map((ci) => (ci.cartId === cartId ? { ...ci, quantity: qty } : ci)));
    }
  };

  const handleRemoveItem = (cartId: string) => {
    setCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
  };

  const handleConfirmOrder = async () => {
    if (tableNumber && cart.length > 0) {
      const cleanItems = JSON.parse(JSON.stringify(cart)); // ตัดฟิลด์ที่เป็น undefined ทิ้งอัตโนมัติ
      await addDoc(collection(db, "orders"), {
        tableNumber,
        items: cleanItems,
        status: "in-progress",
        createdAt: serverTimestamp(),
      });
      setCart([]);
      setView("order-sent");
    }
  };

  const handleStartTakeaway = () => {
    setTakeawayCart([]);
    setTakeawayCategory(CATEGORIES[0].id);
    setView("staff-takeaway-menu");
  };

  const handleTakeawayAddToCart = (ci: CartItem) => {
    setTakeawayCart((prev) => [...prev, ci]);
    setView("staff-takeaway-menu");
  };

  const handleTakeawayUpdateQty = (cartId: string, qty: number) => {
    if (qty <= 0) {
      setTakeawayCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
    } else {
      setTakeawayCart((prev) => prev.map((ci) => (ci.cartId === cartId ? { ...ci, quantity: qty } : ci)));
    }
  };

  const handleTakeawayRemove = (cartId: string) => {
    setTakeawayCart((prev) => prev.filter((ci) => ci.cartId !== cartId));
  };

  const takeawayCounterRef = { current: 0 };
  const handleConfirmTakeaway = async () => {
    if (takeawayCart.length === 0) return;
    const cleanItems = JSON.parse(JSON.stringify(takeawayCart));
    const counterRef = doc(db, "counters", "takeaway");
    const nextNumber = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(counterRef);
      const current = snap.exists() ? (snap.data().count || 0) : 0;
      const next = current + 1;
      transaction.set(counterRef, { count: next });
      return next;
    });
    await addDoc(collection(db, "orders"), {
      tableNumber: 0,
      isTakeaway: true,
      takeawayLabel: `T-${nextNumber}`,
      items: cleanItems,
      status: "in-progress",
      createdAt: serverTimestamp(),
    });
    setTakeawayCart([]);
    setView("staff-orders");
  };

  // Staff handlers
  const STAFF_EMAIL = "admin@hueanyong.local";

  const handleStaffLogin = async (pw: string) => {
    try {
      await signInWithEmailAndPassword(auth, STAFF_EMAIL, pw);
      setLoginError(false);
      setStaffTab("orders");
      setView("staff-orders");
    } catch {
      setLoginError(true);
    }
  };

  const handleMarkServed = async (orderId: string) => {
    await updateDoc(doc(db, "orders", orderId), { status: "awaiting-payment" });
  };

  const handleRemoveOrderItem = async (orderId: string, cartId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const newItems = order.items.filter((ci) => ci.cartId !== cartId);
    if (newItems.length === 0) {
      await deleteDoc(doc(db, "orders", orderId));
    } else {
      await updateDoc(doc(db, "orders", orderId), { items: newItems });
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    await deleteDoc(doc(db, "orders", orderId));
  };

  const handleCloseTable = async (tableNum: number, paymentMethod: PaymentMethod, cashReceived?: number) => {
    const toClose = orders.filter(
      (o) => o.tableNumber === tableNum && o.status === "awaiting-payment"
    );
    await Promise.all(
      toClose.map((o) =>
        updateDoc(doc(db, "orders", o.id), {
          status: "paid",
          paymentMethod,
          ...(cashReceived !== undefined ? { cashReceived } : {}),
        })
      )
    );
    setSelectedPayTable(null);
  };

  const handleCloseTakeawayOrder = async (orderId: string, paymentMethod: PaymentMethod, cashReceived?: number) => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "paid",
      paymentMethod,
      ...(cashReceived !== undefined ? { cashReceived } : {}),
    });
  };

  const handleStaffTabChange = (tab: "orders" | "payment" | "menu" | "history") => {
    setStaffTab(tab);
    setView(
      tab === "orders" ? "staff-orders" :
        tab === "payment" ? "staff-payment" :
          tab === "menu" ? "staff-menu" : "staff-history"
    );
  };

  const handleAddNewItem = () => {
    setEditingItem({
      id: uid(),
      categoryId: CATEGORIES[0].id,
      name: { en: "", th: "" },
      description: { en: "", th: "" },
      price: 0,
      photo: "",
    });
    setView("staff-menu-edit");
  };

  const handleEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setView("staff-menu-edit");
  };

  const handleSaveItem = async (item: MenuItem) => {
    await setDoc(doc(db, "menuItems", item.id), { ...item, active: (item as any).active ?? true });
    setEditingItem(null);
    setView("staff-menu");
  };

  const handleToggleActive = async (item: MenuItem, active: boolean) => {
    await updateDoc(doc(db, "menuItems", item.id), { active });
  };

  const handleDeleteItem = async (itemId: string) => {
    await deleteDoc(doc(db, "menuItems", itemId));
  };

  const handleLogout = async () => {
    await signOut(auth);
    setView("staff-login");
  };

  const handleSeedMenu = async () => {
    for (const item of SEED_MENU_ITEMS) {
      await setDoc(doc(db, "menuItems", item.id), { ...item, active: true });
    }
    alert(`Imported ${SEED_MENU_ITEMS.length} menu items to Firestore`);
  };

  switch (view) {
    case "menu":
      return (
        <MenuScreen
          lang={lang}
          tableNumber={tableNumber!}
          cart={cart}
          menuItems={menuItems}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onItemClick={handleSelectItem}
          onViewCart={() => setView("cart")}
          onLangToggle={toggleLang}
        />
      );

    case "item-detail": {
      const isTakeawayFlow = !!takeawaySelectedItem;
      const activeItem = isTakeawayFlow ? takeawaySelectedItem : selectedItem;
      return activeItem ? (
        <ItemDetailScreen
          lang={lang}
          tableNumber={isTakeawayFlow ? 0 : tableNumber!}
          item={activeItem}
          cart={isTakeawayFlow ? takeawayCart : cart}
          onBack={() => {
            if (isTakeawayFlow) { setTakeawaySelectedItem(null); setView("staff-takeaway-menu"); }
            else setView("menu");
          }}
          onAddToCart={(ci) => {
            if (isTakeawayFlow) { handleTakeawayAddToCart(ci); setTakeawaySelectedItem(null); }
            else handleAddToCart(ci);
          }}
          onViewCart={() => setView(isTakeawayFlow ? "staff-takeaway-cart" : "cart")}
          onLangToggle={toggleLang}
          isTakeaway={isTakeawayFlow}
        />
      ) : null;
    }

    case "cart":
      return (
        <CartScreen
          lang={lang}
          tableNumber={tableNumber!}
          cart={cart}
          onBack={() => setView("menu")}
          onUpdateQty={handleUpdateQty}
          onRemove={handleRemoveItem}
          onConfirm={handleConfirmOrder}
          onLangToggle={toggleLang}
        />
      );

    case "order-sent":
      return (
        <OrderSentScreen
          lang={lang}
          tableNumber={tableNumber!}
          onOrderMore={() => setView("menu")}
        />
      );

    case "staff-login":
      return (
        <StaffLoginScreen
          lang={lang}
          onLogin={handleStaffLogin}
          onBack={() => setView("staff-login")}
          error={loginError}
          onLangToggle={toggleLang}
        />
      );

    case "staff-orders":
      return (
        <StaffOrdersScreen
          lang={lang}
          orders={orders}
          onMarkServed={handleMarkServed}
          onRemoveItem={handleRemoveOrderItem}
          onCancelOrder={handleCancelOrder}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );

    case "staff-payment":
      return (
        <StaffPaymentScreen
          lang={lang}
          orders={orders}
          selectedTable={selectedPayTable}
          onSelectTable={setSelectedPayTable}
          onCloseTable={handleCloseTable}
          onCloseTakeaway={handleCloseTakeawayOrder}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );

    case "staff-menu":
      return (
        <StaffMenuScreen
          lang={lang}
          items={allMenuItems}
          onAdd={handleAddNewItem}
          onEdit={handleEditItem}
          onToggleActive={handleToggleActive}
          onDelete={handleDeleteItem}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );

    case "staff-menu-edit":
      return editingItem ? (
        <StaffMenuEditScreen
          lang={lang}
          item={editingItem}
          onSave={handleSaveItem}
          onCancel={() => setView("staff-menu")}
          onLangToggle={toggleLang}
        />
      ) : null;

    case "staff-history":
      return (
        <StaffHistoryScreen
          lang={lang}
          orders={orders}
          onTabChange={handleStaffTabChange}
          onLogout={handleLogout}
          onLangToggle={toggleLang}
        />
      );

    case "staff-takeaway-menu":
      return (
        <MenuScreen
          lang={lang}
          tableNumber={0}
          cart={takeawayCart}
          menuItems={menuItems}
          activeCategory={takeawayCategory}
          onCategoryChange={setTakeawayCategory}
          onItemClick={(item) => { setTakeawaySelectedItem(item); setView("item-detail"); }}
          onViewCart={() => setView("staff-takeaway-cart")}
          onLangToggle={toggleLang}
          isTakeaway={true}
        />
      );

    case "staff-takeaway-cart":
      return (
        <CartScreen
          lang={lang}
          tableNumber={0}
          cart={takeawayCart}
          onBack={() => setView("staff-takeaway-menu")}
          onUpdateQty={handleTakeawayUpdateQty}
          onRemove={handleTakeawayRemove}
          onConfirm={handleConfirmTakeaway}
          onLangToggle={toggleLang}
          isTakeaway={true}
        />
      );

    default:
      return null;
  }
}
