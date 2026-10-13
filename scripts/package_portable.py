"""直接运行或双击，将最新 Windows 打包目录制作为完整便携 ZIP。"""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

# 配置区
ROOT = Path(__file__).resolve().parents[1]
BUILD_CANDIDATES = [ROOT / "release" / "desktop" / "win-unpacked", ROOT / "release" / "window-fix" / "win-unpacked"]
DESTINATION = ROOT / "release" / "desktop"


def main() -> None:
    available = [folder for folder in BUILD_CANDIDATES if (folder / "resources" / "app.asar").is_file()]
    if not available:
        raise RuntimeError("缺少打包目录；请先运行 npm run package。")
    build = max(available, key=lambda folder: (folder / "resources" / "app.asar").stat().st_mtime)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    archive_path = DESTINATION / f"Pulsar-{version}-win-x64.zip"
    required = ["Pulsar.exe", "resources/app.asar", "resources/service/sctranslate-service.exe"]
    for name in required:
        if not (build / name).is_file():
            raise RuntimeError(f"缺少打包文件：{name}；请先运行 npm run package。")
    packed_service = build / required[2]
    source_service = ROOT / "service" / "target" / "release" / "sctranslate-service.exe"
    if hashlib.sha256(packed_service.read_bytes()).digest() != hashlib.sha256(source_service.read_bytes()).digest():
        raise RuntimeError("包内 Rust 服务与当前 release 服务不一致，请重新打包。")
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file_path in sorted(build.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, "Pulsar/" + file_path.relative_to(build).as_posix())
        archive.writestr("Pulsar/使用说明.txt", (
            f"Pulsar {version} — Windows x64 便携版\n"
            "请解压整个文件夹，再运行 Pulsar.exe。更新前关闭旧工作台。\n"
            "不需要安装 Node.js、Rust 或 Python。点击「连接 ParaTranz」登录自己的账户。\n"
            "本地草稿和启动日志保存在应用数据目录。\n"
            "本版未签名。项目数据来自登录账号可访问的 ParaTranz 项目。接口参考：\n"
            "https://paratranz.cn/projects/8340/strings?file=3485163&stage=0\n"
        ))
    with zipfile.ZipFile(archive_path) as archive:
        for name in required:
            if "Pulsar/" + name not in archive.namelist():
                raise RuntimeError(f"便携包缺少必要文件：{name}")
        corrupt_entry = archive.testzip()
        if corrupt_entry:
            raise RuntimeError(f"压缩包损坏：{corrupt_entry}")
    with archive_path.open("rb") as archive_file:
        digest = hashlib.file_digest(archive_file, "sha256").hexdigest().upper()
    archive_path.with_suffix(".zip.sha256").write_text(f"{digest}  {archive_path.name}\n", encoding="ascii")
    print(f"来源：{build}\n便携包：{archive_path}\nSHA256：{digest}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"打包失败：{error}", file=sys.stderr)
        if sys.stdin.isatty():
            input("按回车关闭窗口…")
        sys.exit(1)
