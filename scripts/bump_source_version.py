"""Persist the successful release's application version as the next source baseline."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'release-assets'
VERSION_PATTERN = re.compile(r'(\d+)\.(\d+)\.(\d+)')
BUILD_VERSION_PATTERN = re.compile(r'(\d+\.\d+\.\d+)-build\.\d+')


def read_release_version() -> str:
    manifests = sorted(ASSETS.glob('Pulsar-*-build.json'))
    if not manifests:
        raise RuntimeError('Published build manifests are missing')
    versions = set()
    for manifest in manifests:
        data = json.loads(manifest.read_text(encoding='utf-8'))
        version = data.get('appVersion', data.get('version', ''))
        if not BUILD_VERSION_PATTERN.fullmatch(version):
            raise RuntimeError(f'Unexpected application version in {manifest.name}: {version}')
        versions.add(BUILD_VERSION_PATTERN.fullmatch(version).group(1))
    if len(versions) != 1:
        raise RuntimeError('Build manifests contain different application versions')
    return versions.pop()


def version_tuple(version: str) -> tuple[int, int, int]:
    match = VERSION_PATTERN.fullmatch(version)
    if not match:
        raise RuntimeError(f'Expected a plain major.minor.patch version: {version}')
    return tuple(map(int, match.groups()))


def main() -> None:
    package_path = ROOT / 'package.json'
    lock_path = ROOT / 'package-lock.json'
    package = json.loads(package_path.read_text(encoding='utf-8'))
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    current = package['version']
    if lock.get('version') != current or lock.get('packages', {}).get('', {}).get('version') != current:
        raise SystemExit('package.json and package-lock.json versions must match before bumping')

    target = read_release_version()
    if version_tuple(current) >= version_tuple(target):
        print(f'Source version already current: {current}')
        return

    package['version'] = target
    lock['version'] = target
    lock['packages']['']['version'] = target
    package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Advanced source version: {current} -> {target}')


if __name__ == '__main__':
    main()
