# สร้างไฟล์ต้นฉบับไอคอนแอป Android (assets/icon-*.png) จากโลโก้ในโปรเจกต์ ให้หน้าตาเหมือนวงกลมโลโก้ในหน้า login พนักงาน
# (StaffLoginScreen: พื้น #3C2414 + ลายเส้นสีอ่อน) แล้วค่อยรัน `npx capacitor-assets generate --android`
#
# ต่างจากหน้า login 3 จุด เพราะลายเส้นละเอียดมาก ย่อเหลือ ~52dp บนหน้าโฮมแล้วจางจนกลืนพื้น:
# โลโก้ใหญ่ขึ้น (68% แทน 60% — มุมล่างของเส้นพื้นยังห่างขอบวงกลม), เส้นหนาขึ้นเล็กน้อย, สีครีม #FFF8F0 แทนเทา
#
# ใช้ logo-black.png (578px) แทน logo.png (144px ต่ำเกินไปสำหรับไอคอน) แล้วเปลี่ยนเส้นดำเป็นสีอ่อน
# ความทึบของแต่ละ pixel = alpha × ความเข้มของหมึก — ขอบเส้นใน logo-black เป็นทั้ง alpha บางส่วนและสีเทาอ่อน
# ถ้าคง alpha เดิมไว้เฉยๆ ขอบที่เป็นสีอ่อนจะกลายเป็นเส้นทึบ เส้นหนาขึ้นกว่าต้นฉบับ
#
# ใช้: python scripts/make-icon-sources.py   (ต้องมี Pillow)

from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "assets" / "logo-black.png"
OUT = ROOT / "assets"

SIZE = 1024
BG = (0x3C, 0x24, 0x14)       # สีพื้นวงกลมโลโก้หน้า login
LINE = (0xFF, 0xF8, 0xF0)     # สีครีมเดียวกับตัวหนังสือบนแถบน้ำตาลของแอป
LOGO_WIDTH = 0.68             # หน้า login ใช้ 60% (48px ในวงกลม 80px)
THICKEN = 5                   # MaxFilter บน mask ขนาด 1024 — เส้นหนาขึ้นข้างละ ~2px
INK_FULL = 20                 # ค่าความสว่างของเนื้อเส้นดำ (เฉลี่ย ~28) ถือว่าหมึกเต็ม 100%

src = Image.open(SRC).convert("RGBA")
src = src.crop(src.getbbox())

ink = Image.new("L", src.size)
ink.putdata([
    round(a * max(0.0, min(1.0, (255 - (r + g + b) / 3) / (255 - INK_FULL))))
    for r, g, b, a in src.getdata()
])
logo = Image.new("RGBA", src.size, LINE + (0,))
logo.putalpha(ink)

w = round(SIZE * LOGO_WIDTH)
h = round(src.height * w / src.width)
logo = logo.resize((w, h), Image.LANCZOS)
logo.putalpha(logo.getchannel("A").filter(ImageFilter.MaxFilter(THICKEN)))

fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
fg.alpha_composite(logo, ((SIZE - w) // 2, (SIZE - h) // 2))
bg = Image.new("RGBA", (SIZE, SIZE), BG + (255,))

OUT.mkdir(exist_ok=True)
fg.save(OUT / "icon-foreground.png")
bg.save(OUT / "icon-background.png")
Image.alpha_composite(bg, fg).save(OUT / "icon-only.png")
print(f"logo {w}x{h} on {SIZE}x{SIZE} -> {OUT}")
