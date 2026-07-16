from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
ICON = Image.open(ROOT / "src" / "assets" / "icons" / "icon-maskable-512.png").convert("RGBA")
GREEN = (31, 107, 79, 255)
CREAM = (255, 254, 249, 255)


def foreground(source: Image.Image) -> Image.Image:
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    result.putdata([
        (255, 255, 255, 255) if red > 235 and green > 235 and blue > 235 else (0, 0, 0, 0)
        for red, green, blue, _alpha in source.getdata()
    ])
    return result


density_sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, size in density_sizes.items():
    destination = RES / folder
    destination.mkdir(parents=True, exist_ok=True)
    full_icon = ICON.resize((size, size), Image.Resampling.LANCZOS)
    full_icon.save(destination / "ic_launcher.png")
    full_icon.save(destination / "ic_launcher_round.png")
    foreground(ICON).resize((size, size), Image.Resampling.LANCZOS).save(destination / "ic_launcher_foreground.png")

for splash_path in RES.glob("drawable*/splash.png"):
    with Image.open(splash_path) as old_splash:
        width, height = old_splash.size
    canvas = Image.new("RGBA", (width, height), CREAM)
    mark_size = max(72, min(width, height) // 4)
    mark = ICON.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((width - mark_size) // 2, (height - mark_size) // 2))
    canvas.convert("RGB").save(splash_path)

print("Generated branded Android launcher and splash assets.")
