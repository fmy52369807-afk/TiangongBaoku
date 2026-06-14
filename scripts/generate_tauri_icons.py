from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src-tauri" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)


def draw_icon(size: int) -> Image.Image:
    scale = size / 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def s(value):
        return value * scale

    # Cool jade base, matching the in-app brand mark.
    draw.rounded_rectangle(
        [s(5), s(5), s(59), s(59)],
        radius=s(17),
        fill=(218, 230, 226, 255),
        outline=(159, 181, 177, 255),
        width=max(1, int(s(1.6))),
    )

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        [s(12), s(15), s(47), s(49)],
        radius=s(10),
        fill=(33, 55, 58, 40),
    )
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(s(2))))

    wash = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    wash_draw = ImageDraw.Draw(wash)
    wash_draw.ellipse([s(12), s(10), s(50), s(50)], fill=(185, 205, 201, 104))
    wash_draw.ellipse([s(20), s(16), s(44), s(40)], fill=(235, 241, 238, 88))
    image.alpha_composite(wash.filter(ImageFilter.GaussianBlur(s(1.1))))

    draw = ImageDraw.Draw(image)
    ink = (28, 58, 63, 255)
    gold = (172, 126, 58, 255)
    seal = (154, 54, 49, 255)
    line_width = max(2, int(s(4.1)))
    thin_width = max(1, int(s(2.2)))

    # Recreate the current 天工 mark as crisp strokes.
    draw.line([s(21), s(23), s(43), s(23)], fill=ink, width=line_width)
    draw.line([s(32), s(16), s(32), s(46)], fill=ink, width=line_width)
    draw.line([s(23), s(35), s(40), s(35)], fill=ink, width=max(2, int(s(3.3))))
    draw.arc([s(19), s(25), s(47), s(52)], start=28, end=114, fill=gold, width=thin_width)

    draw.rounded_rectangle([s(42), s(42), s(53), s(53)], radius=s(2), fill=seal)
    draw.line([s(45), s(46), s(50), s(46)], fill=(244, 233, 214, 255), width=max(1, int(s(1.4))))
    draw.line([s(47.5), s(44), s(47.5), s(51)], fill=(244, 233, 214, 255), width=max(1, int(s(1.3))))
    return image


for icon_size, name in [
    (32, "32x32.png"),
    (128, "128x128.png"),
    (256, "128x128@2x.png"),
    (512, "icon.png"),
]:
    draw_icon(icon_size).save(ICON_DIR / name)

ico_images = [draw_icon(size) for size in (16, 24, 32, 48, 64, 128, 256)]
ico_images[-1].save(
    ICON_DIR / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print(f"Generated icons in {ICON_DIR}")
