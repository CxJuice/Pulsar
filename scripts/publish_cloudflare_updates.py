"""Mirror a complete verified desktop release to R2 and publish update feeds."""
from pathlib import Path
import hashlib
import json
import mimetypes
import os
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'release-assets'
BUCKET = 'sctranslatekit-updates'
PLATFORMS = {('win', 'x64'), ('mac', 'universal'), ('linux', 'x64'), ('linux', 'arm64')}


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def upload(path: Path, key: str, cache_control: str) -> None:
    content_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    command = [
        'npx', 'wrangler', '--config', 'cloudflare/wrangler.jsonc', 'r2', 'object', 'put',
        f'{BUCKET}/{key}', f'--file={path}', '--remote', '--force',
        f'--content-type={content_type}', f'--cache-control={cache_control}',
    ]
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f'R2 upload failed: {key}')
    print(f'Uploaded {key} ({path.stat().st_size} bytes)')


def main() -> None:
    for name in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'SCKIT_UPDATE_URL', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_RUN_NUMBER', 'GH_TOKEN', 'GH_REPO'):
        if not os.environ.get(name):
            raise SystemExit(f'{name} must be configured before publishing to Cloudflare R2')
    update_url = urlsplit(os.environ['SCKIT_UPDATE_URL'])
    if (update_url.scheme != 'https' or update_url.hostname != 'pulsar.42kit.com'
            or update_url.path not in ('', '/') or update_url.username or update_url.password
            or update_url.query or update_url.fragment):
        raise RuntimeError('SCKIT_UPDATE_URL must be the HTTPS origin https://pulsar.42kit.com')

    sys.path.insert(0, str(ROOT))
    from scripts.publish_release import collect_assets, release_information, release_tag

    manifests = sorted(ASSETS.glob('Pulsar-*-build.json'))
    if len(manifests) != len(PLATFORMS):
        raise RuntimeError(f'Expected {len(PLATFORMS)} platform build manifests')
    first = json.loads(manifests[0].read_text(encoding='utf-8'))
    source_version = first.get('sourceVersion', first['version'])
    release_version = first.get('releaseVersion', first['version'])
    tag = release_tag(source_version)
    if release_version != tag.removeprefix('v'):
        raise RuntimeError('Release tag does not match the build manifests')
    app_version = first['version']
    commit = os.environ['GITHUB_SHA']
    assets = collect_assets(release_version, commit, app_version)

    existing = subprocess.run(
        ['gh', 'release', 'view', tag, '--json', 'isDraft,targetCommitish'],
        cwd=ROOT, text=True, capture_output=True,
    )
    if existing.returncode:
        if 'release not found' not in existing.stderr.lower():
            raise RuntimeError(existing.stderr.strip() or 'Could not verify whether the GitHub release already exists')
    else:
        release_state = json.loads(existing.stdout)
        if release_state['isDraft']:
            if release_state['targetCommitish'] != commit:
                raise RuntimeError('Existing draft release targets a different source commit')
        else:
            remote = release_information(os.environ['GH_REPO'], tag)
            expected = {path.name: 'sha256:' + digest(path) for path in assets}
            actual = {item['name']: item.get('digest') for item in remote['assets']}
            if actual != expected:
                raise RuntimeError('Published GitHub release already exists with different assets')

    manifest_data = [json.loads(path.read_text(encoding='utf-8')) for path in manifests]
    if {(data['platform'], data['arch']) for data in manifest_data} != PLATFORMS:
        raise RuntimeError('Release is missing one or more supported platform builds')

    base_url = 'https://pulsar.42kit.com'
    archive_key = f'releases/{tag}'
    release_index = {
        'tag': tag,
        'sourceVersion': source_version,
        'appVersion': app_version,
        'commit': commit,
        'assets': [
            {'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path), 'url': f'{base_url}/{archive_key}/{path.name}'}
            for path in assets
        ],
        'updates': {},
    }

    # Archive every release asset before publishing any mutable latest.yml feed.
    for path in assets:
        upload(path, f'{archive_key}/{path.name}', 'public, max-age=31536000, immutable')

    feed_metadata: list[tuple[Path, str]] = []
    for data in manifest_data:
        platform, arch = data['platform'], data['arch']
        feed_prefix = f'{platform}/{arch}'
        target_name = data.get('updateTarget')
        if not target_name:
            # Legacy validation-only builds do not contain updater metadata.
            continue
        target = ASSETS / target_name
        if not target.is_file():
            raise RuntimeError(f'Missing updater target: {target_name}')
        upload(target, f'{feed_prefix}/{target_name}', 'public, max-age=31536000, immutable')
        manual_download = None
        if platform == 'mac':
            dmg = target.with_suffix('.dmg')
            if not dmg.is_file():
                raise RuntimeError(f'Missing macOS manual-download DMG: {dmg.name}')
            upload(dmg, f'{feed_prefix}/{dmg.name}', 'public, max-age=31536000, immutable')
            manual_download = f'{base_url}/{feed_prefix}/{dmg.name}'
        metadata_names = []
        for item in data.get('updateFiles', []):
            path = ASSETS / item['name']
            if item['role'] == 'metadata':
                feed_metadata.append((path, f'{feed_prefix}/{path.name}'))
            else:
                upload(path, f'{feed_prefix}/{path.name}', 'public, max-age=31536000, immutable')
            metadata_names.append(path.name)
        release_index['updates'][feed_prefix] = {
            'target': f'{base_url}/{feed_prefix}/{target_name}',
            'metadata': [f'{base_url}/{feed_prefix}/{name}' for name in metadata_names if name.endswith('.yml')],
            **({'manualDownload': manual_download} if manual_download else {}),
        }

    for path, key in feed_metadata:
        upload(path, key, 'public, max-age=60, must-revalidate')

    index_path = ROOT / 'release' / 'r2-release.json'
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(release_index, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    upload(index_path, f'{archive_key}/release.json', 'public, max-age=60, must-revalidate')
    print(f'R2 release archive published: {base_url}/{archive_key}/release.json')


if __name__ == '__main__':
    main()
