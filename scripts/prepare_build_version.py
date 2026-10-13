"""Apply the workflow's unique release version to package metadata."""
from pathlib import Path
import json
import os
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> None:
    package_path = ROOT / 'package.json'
    lock_path = ROOT / 'package-lock.json'
    package = json.loads(package_path.read_text(encoding='utf-8'))
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    base_version = package['version']
    if lock['version'] != base_version or lock['packages']['']['version'] != base_version:
        raise SystemExit('package.json and package-lock.json versions must match before building')

    ref = os.environ['GITHUB_REF']
    if ref.startswith('refs/tags/') and ref != f'refs/tags/v{base_version}':
        raise SystemExit('Tag must match package.json version')

    version = base_version
    release_version = base_version
    if os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch':
        sys.path.insert(0, str(ROOT))
        from scripts.publish_release import release_tag

        release_version = release_tag(base_version).removeprefix('v')
        if os.environ.get('SCKIT_UPDATE_URL'):
            match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', base_version)
            if not match:
                raise SystemExit('Automatic updates require package.json to use a plain major.minor.patch version')
            major, minor, patch = map(int, match.groups())
            version = f'{major}.{minor}.{patch + 1}-build.{os.environ["GITHUB_RUN_NUMBER"]}'
        else:
            version = release_version

        (ROOT / 'release').mkdir(exist_ok=True)
        write_json(ROOT / 'release' / 'build-version.json', {
            'sourceVersion': base_version,
            'releaseVersion': release_version,
            'appVersion': version,
        })

    if version != base_version:
        package['version'] = version
        lock['version'] = version
        lock['packages']['']['version'] = version
        write_json(package_path, package)
        write_json(lock_path, lock)

    print(f'Application version: {version}')


if __name__ == '__main__':
    main()
