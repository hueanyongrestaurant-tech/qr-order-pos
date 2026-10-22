import{r as _,C as $}from"./index-DNMiUGtu.js";import{T as N,Q as O,O as G,aC as M}from"./index-C45aKa3e.js";import{p as U,l as k}from"./stationTickets-BEeKcPlE.js";class R{constructor(){this.promise=new Promise((t,a)=>{this.resolve_=t,this.reject_=a})}resolve(t){return this.resolve_(t),this}reject(t){return this.reject_(t),this}then(t,a){return this.promise.then(t,a)}catch(t){return this.promise.catch(t)}}class u{static blobToDataURL(t){const a=new FileReader;return new Promise((n,r)=>{a.onload=()=>{n(a.result)},a.onerror=r,a.readAsDataURL(t)})}static async blobToBase64(t){return(await u.blobToDataURL(t)).split(",")[1]}static bufferToBase64(t){return u.blobToBase64(new Blob([t]))}static toURL(t){try{return new URL(t)}catch{return null}}static async fetchUrlToBase64(t){var a;const n=u.toURL(t);return n===null?null:n.protocol==="data:"?(a=n.href.split(",")[1])!==null&&a!==void 0?a:null:n.protocol!=="http:"&&n.protocol!=="https:"?null:fetch(n).then(r=>r.blob()).then(u.blobToBase64)}static async toBase64(t){if(typeof t=="string"){const a=await u.fetchUrlToBase64(t);return a!==null?a:t}return t instanceof Blob?await u.blobToBase64(t):t instanceof Array?await u.bufferToBase64(new Uint8Array(t)):await u.bufferToBase64(t)}}const m=_("CapacitorThermalPrinter"),I={bold:["enabled"],underline:["enabled"],doubleWidth:["enabled"],doubleHeight:["enabled"],inverse:["enabled"],dpi:["dpi"],limitWidth:["width"],barcodeWidth:["width"],barcodeHeight:["height"],barcodeTextPlacement:["placement"],align:["alignment"],charSpacing:["charSpacing"],lineSpacing:["lineSpacing"],font:["font"],clearFormatting:[],text:["text"],image:["image"],qr:["data"],barcode:["type","data"],raw:["data"],selfTest:[],beep:[],openDrawer:[],cutPaper:["half"],feedCutPaper:["half"],begin:[],write:[]},T={async image(e){return{image:await u.toBase64(e)}},async raw(e){return{data:await u.toBase64(e)}}};function W(e,t){if(e in T)return T[e](...t);const a=I[e];return Object.fromEntries(a.map((n,r)=>[n,structuredClone(t[r])]))}const E={isConnected(){return m.isConnected().then(({state:e})=>e)},connect(...e){return m.connect(...e).then(t=>t??null)}};for(const e in I)E[e]=(...t)=>{const a=W(e,t),n=v.pop(),r=new R;v.push(r);const o=Promise.resolve(n).then(async()=>{try{await m[e](await a)}finally{r.resolve()}});return e==="write"?o:h};const v=[],h=new Proxy({},{get(e,t){return t in E?E[t]:m[t]}}),l=30,x=Math.floor(l/2);function ie(){return $.isNativePlatform()}const b=255;function H(e){const t=[];for(const a of e){const n=a.codePointAt(0)??63;n<128?t.push(n):n>=3585&&n<=3675?t.push(n-3424):t.push(63)}return t}function w(e){return[27,116,e&255]}function P(e){return H(e)}function i(e,t){return e.raw(P(t))}function B(e,t){const a=Math.min(Math.max(Math.round(e),1),8)-1,n=Math.min(Math.max(Math.round(t),1),8)-1;return[29,33,a<<4|n]}const d=B(1,1),g=B(2,1);function c(e){return[27,69,e?1:0]}function C(e){return[29,66,e?1:0]}function S(e){return[27,45,e?1:0]}function Z(){return C(!0)}function j(){return C(!1)}function z(e){const t=new Intl.Segmenter(void 0,{granularity:"word"});return Array.from(t.segment(e),a=>a.segment)}function q(e){const t=new Intl.Segmenter(void 0,{granularity:"grapheme"});return Array.from(t.segment(e),a=>a.segment)}const F=new Set(["เ","แ","โ","ใ","ไ"]);function D(e){const t=q(e),a=[];for(let n=0;n<t.length;n++)F.has(t[n])&&n+1<t.length?(a.push(t[n]+t[n+1]),n++):a.push(t[n]);return a}function K(e,t){const a=D(e),n=[];let r="";for(const o of a)r.length>0&&r.length+o.length>t?(n.push(r),r=o):r+=o;return(r.length>0||n.length===0)&&n.push(r),n}function Q(e,t){const a=z(e),n=[];let r="";for(const o of a){if(o.length>t){r.length>0&&(n.push(r),r="");const s=K(o,t);for(let f=0;f<s.length-1;f++)n.push(s[f]);r=s[s.length-1]??"";continue}if(r.length+o.length>t){n.push(r),r=o.trim().length===0?"":o;continue}r+=o}return(r.length>0||n.length===0)&&n.push(r),n}function V(e,t){if(e.length<=t)return e;const a=D(e);let n="";for(const r of a){if(n.length+r.length>t)break;n+=r}return n}function y(e,t,a=l){const n=t,r=Math.max(1,a-n.length-1),o=e.length>r?V(e,r):e,s=Math.max(1,a-o.length-n.length);return o+" ".repeat(s)+n}async function p(){const e=M();if(!e)throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์สำหรับเครื่องนี้ (ตั้งค่าได้ที่ปุ่มเครื่องพิมพ์ในหัวข้อ)");if(await h.isConnected())return;if(!await h.connect({address:e.address}))throw new Error(`เชื่อมต่อเครื่องพิมพ์ "${e.name}" ไม่สำเร็จ — ตรวจสอบว่าเปิดเครื่องพิมพ์และจับคู่ Bluetooth ไว้แล้ว`)}async function oe(e,t,a,n,r){const o=U(e,t,a);if(o.length===0)return 0;await p();const s=h.begin().raw(w(b));return o.forEach(f=>J(s,k(e,f,n,r))),await s.write(),o.length}function J(e,t){let a="left";e.align("left");for(const n of t){if(n.kind==="cut"){e.feedCutPaper();continue}if(n.kind==="rule"){a!=="left"&&e.align(a="left"),e.raw([...g,...P("-".repeat(x)+`
`)]);continue}n.align!==a&&e.align(a=n.align);const r=n.size==="wide"?g:d,o=[...n.bold?c(!0):[],...n.emphasis==="group"?Z():n.emphasis==="underline"?S(!0):[]],s=[...n.emphasis==="group"?j():n.emphasis==="underline"?S(!1):[],...n.bold?c(!1):[]];(n.wrap?Q(n.text,n.size==="wide"?x:l):[n.text]).forEach(L=>e.raw([...r,...o,...P(`${L}
`),...s]))}}async function le(e,t){const a=N[t];await p();const n=new Date,r=h.begin().raw(w(b)).raw(d).align("center").raw(c(!0));i(r,`${a.appName}
`),r.raw(c(!1)),i(r,`${e.label}
`),i(r,`${n.toLocaleString(t==="th"?"th-TH":"en-US")}
`),r.align("left"),i(r,"-".repeat(l)+`
`),e.items.forEach(o=>{const s=t==="en"?o.item.name.en:o.item.name.th;i(r,y(`${o.quantity}x ${s}`,`${O(o)}${a.thb}`)+`
`);const f=G(o,t);f&&i(r,`  ${f}
`),o.customNote&&i(r,`  + ${o.customNote} (+${o.customAddOnPrice||0}${a.thb})
`)}),i(r,"-".repeat(l)+`
`),r.raw(c(!0)),i(r,y(t==="en"?"Total":"รวมทั้งหมด",`${e.total}${a.thb}`)+`
`),r.raw(c(!1)),i(r,"-".repeat(l)+`
`),r.align("center"),i(r,`${t==="en"?"Thank you for your visit":"ขอบคุณที่ใช้บริการค่ะ"}
`),r.feedCutPaper(),await r.write()}async function se(){await p();const e=h.begin().raw(w(b)).raw(d).align("center").raw(c(!0));i(e,`ทดสอบพิมพ์
`),e.raw(c(!1)),i(e,new Date().toLocaleString("th-TH")+`
`),e.feedCutPaper(),await e.write()}async function ce(){await p();const e=h.begin().raw(w(b)).raw(d).align("left");i(e,`A: inverse video (GS B)
`),e.raw(C(!0)),i(e,`ตัวอย่างข้อความกลับสี ABC 123
`),e.raw(C(!1)),i(e,"-".repeat(l)+`
`),i(e,`B: bold only (fallback if A fails)
`),e.raw(c(!0)),i(e,`ตัวอย่างตัวหนาอย่างเดียว ABC 123
`),e.raw(c(!1)),i(e,"-".repeat(l)+`
`),i(e,`C: underline (ci.note, always)
`),e.raw(S(!0)),i(e,`ตัวอย่างขีดเส้นใต้ ABC 123
`),e.raw(S(!1)),e.feedCutPaper(),await e.write()}const X=[{n:0,label:"PC437 (USA) - ESC/POS standard"},{n:1,label:"Katakana - ESC/POS standard"},{n:2,label:"PC850 - ESC/POS standard"},{n:3,label:"PC860 - ESC/POS standard"},{n:4,label:"PC863 - ESC/POS standard"},{n:5,label:"PC865 - ESC/POS standard"},{n:16,label:"WPC1252 - ESC/POS standard"},{n:17,label:"PC866 - ESC/POS standard"},{n:18,label:"PC852 - ESC/POS standard"},{n:19,label:"PC858 - ESC/POS standard"},{n:20,label:"Thai Character Code 42 (vendor)"},{n:21,label:"Thai Character Code 11 (vendor)"},{n:22,label:"Thai Character Code 13 (vendor)"},{n:23,label:"Thai Character Code 14 (vendor)"},{n:24,label:"Thai Character Code 16 (vendor)"},{n:25,label:"Thai Character Code 17 (vendor)"},{n:26,label:"Thai Character Code 18 (vendor)"},{n:30,label:"vendor extra"},{n:32,label:"vendor extra"},{n:42,label:"vendor extra"},{n:53,label:"vendor extra"},{n:255,label:"vendor extra"}],Y="ทดสอบภาษาไทย กขค ป่า ไก่ ๑๒๓ ฿99";async function ue(){await p();const e=h.begin().align("left");X.forEach(({n:t,label:a})=>{e.raw(w(t)),i(e,`n=${t} ${a}
`),i(e,`${Y}
`),i(e,"-".repeat(l)+`
`)}),e.raw(w(0)),e.feedCutPaper(),await e.write()}const ee=[{n:0,label:"GS ! 0x00 normal"},{n:1,label:"GS ! 0x01 height x2"},{n:16,label:"GS ! 0x10 width x2"},{n:17,label:"GS ! 0x11 width+height x2"},{n:34,label:"GS ! 0x22 width+height x3"},{n:51,label:"GS ! 0x33 width+height x4"}],te=[{n:0,label:"ESC ! 0x00 normal"},{n:16,label:"ESC ! 0x10 height x2"},{n:32,label:"ESC ! 0x20 width x2"},{n:48,label:"ESC ! 0x30 width+height x2"}],A="ทดสอบ ABC 123";async function he(){await p();const e=h.begin().raw(w(b)).align("left");ee.forEach(({n:t,label:a})=>{e.raw([29,33,t]),i(e,`${a}
`),i(e,`${A}
`)}),e.raw([29,33,0]),te.forEach(({n:t,label:a})=>{e.raw([27,33,t]),i(e,`${a}
`),i(e,`${A}
`)}),e.raw([27,33,0]),e.feedCutPaper(),await e.write()}async function fe(){await p();const e=h.begin().raw(w(b)).align("left").raw(d);i(e,`A: leading vowel glyphs
`),i(e,`e=เ o=โ ai=ไ ai2=ใ ae=แ
`),i(e,`with base: เก โก ไก ใก แก
`),i(e,"-".repeat(l)+`
`),i(e,`B: full name, normal, 1 call
`),i(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),i(e,"-".repeat(l)+`
`),i(e,`C: full name, SIZE_WIDE, no wrapLine
`),e.raw(g),i(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),e.raw(d),i(e,"-".repeat(l)+`
`),i(e,`D: label, SIZE_WIDE only
`),e.raw(g),i(e,`โต๊ะ 1-1
`),e.raw(d),i(e,"-".repeat(l)+`
`),i(e,`E: label, toggled like production
`),e.raw(g).raw(c(!0)).raw(d),i(e,`โต๊ะ 1-1
`),e.raw(g).raw(c(!1)).raw(d),i(e,"-".repeat(l)+`
`),e.feedCutPaper(),await e.write()}export{X as THAI_CODEPAGE_CANDIDATES,ie as isNativePrintAvailable,ce as printInverseTest,le as printReceiptNative,he as printSizeCommandSweep,oe as printStationTicketsNative,ue as printThaiCodepageSweep,fe as printWrapDiagnostic,se as testPrintSelectedPrinter};
