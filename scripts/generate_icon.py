"""生成仅含 SC 字母的项目图标；双击即可重新生成。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# 配置区
ROOT = Path(__file__).resolve().parents[1]
FONT = Path("C:/Windows/Fonts/segoeuib.ttf")
COLOR = "#6151d8"
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def main() -> None:
    output = ROOT / "public"
    output.mkdir(exist_ok=True)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(FONT), 650)
    left, top, right, bottom = draw.textbbox((0, 0), "SC", font=font)
    position = ((1024 - (right - left)) / 2 - left, (1024 - (bottom - top)) / 2 - top)
    draw.text(position, "SC", font=font, fill=COLOR)
    canvas.save(output / "icon.png")
    canvas.save(output / "icon.ico", sizes=[(size, size) for size in SIZES])
    (output / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
        f'<text x="{position[0]}" y="{position[1] + font.getmetrics()[0]}" '
        f'fill="{COLOR}" font-family="Segoe UI,Arial,sans-serif" font-size="650" '
        'font-weight="700">SC</text></svg>\n', encoding="utf-8"
    )
    print(f"图标已生成：{output / 'icon.ico'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"生成失败：{error}")
        input("按回车关闭窗口…")
        raise
