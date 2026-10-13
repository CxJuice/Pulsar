"""Collect CI desktop packages and require matching Rust service architecture."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import struct

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'release' / 'ci'
DESTINATION = ROOT / 'release' / 'artifacts'


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def architectures(path: Path, platform: str) -> set[str]:
    with path.open('rb') as stream:
        header = stream.read(4096)
        if platform == 'win':
            if header[:2] != b'MZ':
                raise ValueError(f'Not a PE executable: {path}')
            stream.seek(struct.unpack_from('<I', header, 60)[0])
            pe = stream.read(6)
            if pe[:4] != b'PE\0\0':
                raise ValueError(f'Invalid PE header: {path}')
            return { {0x8664: 'x64', 0xAA64: 'arm64'}.get(struct.unpack_from('<H', pe, 4)[0], 'unknown') }
        if platform == 'linux':
            if header[:4] != b'\x7fELF' or len(header) < 20 or header[4] != 2:
                raise ValueError(f'Not a 64-bit ELF executable: {path}')
            if header[5] not in (1, 2):
                raise ValueError(f'Invalid ELF byte order: {path}')
            endian = '<' if header[5] == 1 else '>'
            return { {62: 'x64', 183: 'arm64'}.get(struct.unpack_from(endian + 'H', header, 18)[0], 'unknown') }
        machines = {0x01000007: 'x64', 0x0100000C: 'arm64'}
        magic = header[:4]
        if magic in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf', b'\xbe\xba\xfe\xca', b'\xbf\xba\xfe\xca'):
            endian = '>' if magic[0] == 0xCA else '<'
            count = struct.unpack_from(endian + 'I', header, 4)[0]
            width = 32 if magic in (b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca') else 20
            return {machines.get(struct.unpack_from(endian + 'I', header, 8 + index * width)[0], 'unknown') for index in range(count)}
        if magic not in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf'):
            raise ValueError(f'Not a Mach-O executable: {path}')
        return {machines.get(struct.unpack_from(('<' if magic[0] == 0xCF else '>') + 'I', header, 4)[0], 'unknown')}


def main() -> None:
    platform = os.environ['CI_PLATFORM']
    arch = os.environ['CI_ARCH']
    expected = {'x64', 'arm64'} if arch == 'universal' else {arch}
    name = 'sctranslate-service.exe' if platform == 'win' else 'sctranslate-service'
    source = ROOT / 'service' / 'target' / 'release' / name
    bundled = [path for path in OUTPUT.rglob(name) if path.is_file()]
    if not bundled:
        raise RuntimeError('Packaged Rust service is missing')
    for path in [source, *bundled]:
        if architectures(path, platform) != expected:
            raise RuntimeError(f'Rust service architecture mismatch: {path}')
        if platform != 'win' and not os.access(path, os.X_OK):
            raise RuntimeError(f'Rust service is not executable: {path}')
        # macOS ad-hoc signing changes the bundled Mach-O signature.
        if platform != 'mac' and digest(path) != digest(source):
            raise RuntimeError(f'Packaged Rust service differs from build: {path}')
    suffixes = {'win': ('.exe', '.zip'), 'mac': ('.dmg', '.zip'), 'linux': ('.AppImage', '.deb', '.rpm', '.tar.gz')}[platform]
    packages = sorted(path for path in OUTPUT.iterdir() if path.is_file() and path.name.startswith('Pulsar-') and path.name.endswith(suffixes) and '__uninstaller' not in path.name)
    expected_count = {'win': 3, 'mac': 2, 'linux': 4}[platform]
    if len(packages) != expected_count:
        raise RuntimeError(f'Expected {expected_count} packages; found {len(packages)}')
    build_number = os.environ.get('BUILD_NUMBER')
    if build_number:
        marker = f'-build-{build_number}-'
        if any(marker not in package.name for package in packages):
            raise RuntimeError(f'Package filenames must include the automatic build number {build_number}')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    app_version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    manifest = {'version': app_version, 'platform': platform, 'arch': arch, 'commit': os.environ['GITHUB_SHA'], 'packages': []}
    version_info_path = ROOT / 'release' / 'build-version.json'
    version_info = json.loads(version_info_path.read_text(encoding='utf-8')) if version_info_path.is_file() else {}
    manifest.update({key: value for key, value in version_info.items() if key in {'sourceVersion', 'releaseVersion', 'appVersion'}})
    for package in packages:
        checksum = digest(package)
        size = package.stat().st_size
        shutil.move(package, DESTINATION / package.name)
        (DESTINATION / (package.name + '.sha256')).write_text(f'{checksum}  {package.name}\n', encoding='ascii')
        manifest['packages'].append({'name': package.name, 'bytes': size, 'sha256': checksum})
    if os.environ.get('SCKIT_UPDATE_URL'):
        target_suffix = {'win': '-Setup-', 'mac': '.zip', 'linux': '.AppImage'}[platform]
        targets = [package for package in packages if (target_suffix in package.name if platform == 'win' else package.name.endswith(target_suffix))]
        if len(targets) != 1:
            raise RuntimeError(f'Expected one {platform} updater package; found {len(targets)}')
        update_files = sorted(path for path in OUTPUT.iterdir() if path.is_file() and (path.name in {'latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'} or path.name.endswith('.blockmap')))
        expected_metadata = {
            'win': 'latest.yml',
            'mac': 'latest-mac.yml',
            'linux': 'latest-linux.yml' if arch == 'x64' else f'latest-linux-{arch}.yml',
        }[platform]
        if not any(path.name == expected_metadata for path in update_files):
            raise RuntimeError(f'electron-builder did not produce {expected_metadata}')
        manifest['updateTarget'] = targets[0].name
        manifest['updateFiles'] = []
        for update_file in update_files:
            checksum = digest(update_file)
            size = update_file.stat().st_size
            shutil.move(update_file, DESTINATION / update_file.name)
            role = 'metadata' if update_file.name == expected_metadata else 'blockmap'
            manifest['updateFiles'].append({'name': update_file.name, 'role': role, 'bytes': size, 'sha256': checksum})
    (DESTINATION / f'Pulsar-{manifest["version"]}-{platform}-{arch}-build.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Collected {len(packages)} packages for {platform}-{arch}')


if __name__ == '__main__':
    main()
