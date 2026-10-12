"""Run the browser UI regression against a local ParaTranz fixture.

Double-click this file after ``npm ci`` and ``npx playwright install chromium``.
The fixture only serves synthetic data and never sends writes to ParaTranz.
"""

from pathlib import Path
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen


# Local test configuration. Change these only if the ports are in use.
DEV_PORT = 3000
FIXTURE_PORT = 3001
STARTUP_SECONDS = 60

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "node_modules" / "@playwright" / "cli" / "playwright-cli.js"
NPM = shutil.which("npm.cmd" if os.name == "nt" else "npm")
NODE = shutil.which("node")

UI_CHECK = r'''async (page) => {
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('button', { name: '编辑全部文本' }).click();
  const dialog = page.getByRole('dialog', { name: /全文编辑器/ });
  const translation = dialog.getByRole('textbox', { name: '编辑 KEY_058 的译文' });
  await translation.fill('值：~amount(10) <EM4>账本</EM4>\\n下一行');
  await dialog.getByRole('status').filter({ hasText: '译文未使用术语表中的对应译名' }).waitFor();
  await translation.fill('值：~amount(10) <EM4>账户</EM4>\\n下一行');
  if (await dialog.getByRole('status').filter({ hasText: '译文未使用术语表中的对应译名' }).count()) throw new Error('Valid glossary translation still has a term warning');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  await page.getByRole('combobox', { name: '词条状态', exact: true }).click();
  await page.getByRole('option', { name: '所有状态' }).click();
  await page.getByRole('textbox', { name: '搜索字符串' }).fill('KEY_003');
  await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /KEY_003/ }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('.string-list [role="option"][aria-selected="true"] .row-content[aria-label="打开词条 KEY_003"]'));
  await page.getByRole('button', { name: '清除搜索' }).click();
  await page.getByText('2 / 2', { exact: true }).first().waitFor();
  const selected = await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /KEY_003/ }).getAttribute('aria-selected');
  if (selected !== 'true') throw new Error('Clearing search lost the selected item');
  await page.getByRole('combobox', { name: '排序方式' }).click();
  await page.getByRole('option', { name: '键值 A–Z' }).click();
  await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /1 打开词条 KEY_001/ }).waitFor();
  await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /50 打开词条 KEY_050/ }).waitFor();
}'''


def port_open(port: int) -> bool:
    with socket.socket() as connection:
        connection.settimeout(0.5)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def app_ready() -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{FIXTURE_PORT}/", timeout=2) as response:
            return response.status == 200 and b"ScTranslateKit" in response.read(100_000)
    except OSError:
        return False


def stop_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        import signal
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    if not NPM or not NODE or not CLI.exists():
        print("Run npm ci before the UI smoke test.", file=sys.stderr)
        return 2
    if port_open(DEV_PORT) or port_open(FIXTURE_PORT):
        print(f"Ports {DEV_PORT} and {FIXTURE_PORT} must be free.", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="sckit-ui-smoke-") as temporary:
        processes = []
        logs = []
        try:
            for command, name in [
                ([NPM, "run", "dev:web"], "nuxt.log"),
                ([NODE, str(ROOT / "tests" / "ui" / "browser-fixture-server.cjs")], "fixture.log"),
            ]:
                output = open(Path(temporary) / name, "w", encoding="utf-8")
                logs.append(output)
                options = {"cwd": ROOT, "stdout": output, "stderr": subprocess.STDOUT}
                if os.name == "nt":
                    options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
                else:
                    options["start_new_session"] = True
                processes.append(subprocess.Popen(command, **options))
            deadline = time.monotonic() + STARTUP_SECONDS
            while time.monotonic() < deadline:
                if all(port_open(port) for port in (DEV_PORT, FIXTURE_PORT)) and app_ready():
                    break
                if any(process.poll() is not None for process in processes):
                    raise RuntimeError("A local UI test server exited during startup")
                time.sleep(0.25)
            else:
                raise RuntimeError("Local UI test servers did not become ready")
            cli = [NODE, str(CLI), "--session", "sckit-ui-smoke"]
            subprocess.run([*cli, "open", f"http://127.0.0.1:{FIXTURE_PORT}"], cwd=ROOT, check=True)
            subprocess.run([*cli, "snapshot"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
            subprocess.run([*cli, "run-code", " ".join(UI_CHECK.splitlines())], cwd=ROOT, check=True)
            print("Browser UI regression passed.")
            return 0
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            print(f"Browser UI regression failed: {type(error).__name__}", file=sys.stderr)
            if CLI.exists() and NODE:
                snapshot = subprocess.run([NODE, str(CLI), "--session", "sckit-ui-smoke", "snapshot"], cwd=ROOT, capture_output=True, text=True)
                print("\n".join(line for line in snapshot.stdout.splitlines() if any(marker in line for marker in ("KEY_003", "搜索字符串", " / 2", "加载词条", "停止加载"))), file=sys.stderr)
            for output in logs:
                output.flush()
                print(Path(output.name).read_text(encoding="utf-8")[-3000:], file=sys.stderr)
            return 1
        finally:
            if CLI.exists():
                subprocess.run([NODE, str(CLI), "--session", "sckit-ui-smoke", "close"], cwd=ROOT, capture_output=True)
            for process in reversed(processes):
                stop_tree(process)
            for output in logs:
                output.close()


if __name__ == "__main__":
    raise SystemExit(main())
