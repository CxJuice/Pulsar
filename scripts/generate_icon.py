"""从根目录 Pulsar.svg 生成应用图标资源；双击即可重新生成。"""
from io import BytesIO
from pathlib import Path
import shutil

import cairosvg
from PIL import Image

# 配置区
ROOT = Path(__file__).resolve().parents[1]
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def main() -> None:
    output = ROOT / "public"
    output.mkdir(exist_ok=True)
    logo_svg = ROOT / "Pulsar.svg"
    shutil.copyfile(logo_svg, output / "Pulsar.svg")
    shutil.copyfile(logo_svg, output / "icon.svg")
    canvas = Image.open(BytesIO(cairosvg.svg2png(url=str(logo_svg), output_width=1024, output_height=1024))).convert("RGBA")
    canvas.save(output / "icon.png")
    canvas.save(output / "icon.ico", sizes=[(size, size) for size in SIZES])
    print(f"图标已生成：{output / 'icon.ico'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"生成失败：{error}")
        input("按回车关闭窗口…")
        raise
