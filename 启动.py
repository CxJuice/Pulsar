"""双击启动 ScTranslateKit；有打包版时直接运行，否则准备并启动源码版。"""
from pathlib import Path
import os
import csv
import hashlib
import shutil
import subprocess
import sys
from datetime import datetime

# 配置区：app 为正常使用；dev 为开发模式。
RUN_MODE = "app"
ROOT = Path(__file__).resolve().parent
PACKAGED_FOLDERS = [ROOT / "release" / "desktop" / "win-unpacked", ROOT / "release" / "window-fix" / "win-unpacked"]


def synchronize_latest(build: Path) -> Path:
    canonical = PACKAGED_FOLDERS[0]
    if build == canonical:
        return canonical
    current_archive = canonical / "resources" / "app.asar"
    latest_archive = build / "resources" / "app.asar"
    if current_archive.exists() and hashlib.sha256(current_archive.read_bytes()).digest() == hashlib.sha256(latest_archive.read_bytes()).digest():
        return canonical
    if os.name == "nt":
        processes = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq ScTranslateKit.exe", "/FO", "CSV", "/NH"],
            capture_output=True, check=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if any(row and row[0].casefold() == "sctranslatekit.exe" for row in csv.reader(processes.stdout.splitlines())):
            raise RuntimeError("新版已经准备好。请先用工作台右上角关闭按钮退出所有 ScTranslateKit 窗口，再双击启动.py；会自动更新统一 EXE 入口并保留登录和草稿。")
    release_root = (ROOT / "release").resolve()
    if not canonical.resolve().is_relative_to(release_root) or canonical.is_symlink():
        raise RuntimeError("统一打包目录不在预期位置，停止更新。")
    if canonical.exists():
        backup = release_root / "archive" / ("before-launch-update-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
        shutil.copytree(canonical, backup)
    shutil.copytree(build, canonical, dirs_exist_ok=True)
    return canonical


def run(command: list[str]) -> None:
    print("运行：", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True, env=clean_environment())


def clean_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    return environment


def main() -> None:
    available = [folder for folder in PACKAGED_FOLDERS if (folder / "ScTranslateKit.exe").is_file() and (folder / "resources" / "app.asar").is_file()]
    packaged_folder = max(available, key=lambda folder: (folder / "resources" / "app.asar").stat().st_mtime) if available else None
    packaged = packaged_folder / "ScTranslateKit.exe" if packaged_folder else None
    if RUN_MODE == "app" and packaged:
        packaged = synchronize_latest(packaged_folder) / "ScTranslateKit.exe"
        subprocess.Popen([str(packaged)], cwd=packaged.parent, env=clean_environment())
        return
    node = shutil.which("node")
    if not node or not shutil.which("cargo"):
        raise RuntimeError("源码启动需要 Node.js 24.11+ 和 Rust。也可以直接运行 release/desktop/win-unpacked/ScTranslateKit.exe。")
    npm_path = Path(node).parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
    if not npm_path.exists():
        raise RuntimeError("找不到 npm-cli.js，请检查 Node.js 安装。")
    npm = [node, str(npm_path)]
    if not (ROOT / "node_modules" / "electron" / "dist" / "electron.exe").exists():
        run(npm + (["ci"] if (ROOT / "package-lock.json").exists() else ["install"]))
    if RUN_MODE == "dev":
        run(npm + ["run", "dev"])
    else:
        if not (ROOT / ".output" / "public" / "index.html").exists() or not (ROOT / "service" / "target" / "release" / "sctranslate-service.exe").exists():
            run(npm + ["run", "build"])
        run(npm + ["start"])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\n启动失败：{error}", file=sys.stderr)
        if sys.stdin.isatty():
            input("按回车关闭窗口…")
