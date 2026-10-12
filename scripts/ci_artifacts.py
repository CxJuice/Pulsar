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
    suffixes = {'win': ('.exe', '.zip'), 'mac': ('.dmg', '.zip')}[platform]
    packages = sorted(path for path in OUTPUT.iterdir() if path.is_file() and path.name.startswith('ScTranslateKit-') and path.name.endswith(suffixes) and '__uninstaller' not in path.name)
    expected_count = {'win': 3, 'mac': 2}[platform]
    if len(packages) != expected_count:
        raise RuntimeError(f'Expected {expected_count} packages; found {len(packages)}')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    manifest = {'version': json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version'], 'platform': platform, 'arch': arch, 'commit': os.environ['GITHUB_SHA'], 'packages': []}
    for package in packages:
        checksum = digest(package)
        size = package.stat().st_size
        shutil.move(package, DESTINATION / package.name)
        (DESTINATION / (package.name + '.sha256')).write_text(f'{checksum}  {package.name}\n', encoding='ascii')
        manifest['packages'].append({'name': package.name, 'bytes': size, 'sha256': checksum})
    (DESTINATION / f'ScTranslateKit-{manifest["version"]}-{platform}-{arch}-build.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Collected {len(packages)} packages for {platform}-{arch}')


if __name__ == '__main__':
    main()
