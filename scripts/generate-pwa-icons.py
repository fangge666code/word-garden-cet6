from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "assets" / "icons"
GREEN = "#1f6b4f"
CREAM = "#fffef9"
WHITE = "#ffffff"
FONT = Path("C:/Windows/Fonts/arialbd.ttf")


def draw_icon(size: int, output_name: str, maskable: bool = False) -> None:
    image = Image.new("RGB", (size, size), GREEN if maskable else CREAM)
    draw = ImageDraw.Draw(image)
    if not maskable:
        inset = round(size * 0.075)
        radius = round(size * 0.22)
        draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=GREEN)
    font = ImageFont.truetype(str(FONT), round(size * (0.47 if maskable else 0.51)))
    box = draw.textbbox((0, 0), "W", font=font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text(((size - width) / 2, (size - height) / 2 - box[1]), "W", font=font, fill=WHITE)
    image.save(OUTPUT / output_name, format="PNG", optimize=True)


OUTPUT.mkdir(parents=True, exist_ok=True)
draw_icon(192, "icon-192.png")
draw_icon(512, "icon-512.png")
draw_icon(512, "icon-maskable-512.png", maskable=True)
draw_icon(180, "apple-touch-icon.png", maskable=True)
