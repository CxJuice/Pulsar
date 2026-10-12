"""Publish verified desktop packages only from a manually dispatched workflow."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'release-assets'
COMBINATIONS = {
    ('win', 'x64'): 3, ('win', 'arm64'): 3,
    ('mac', 'x64'): 2, ('mac', 'arm64'): 2, ('mac', 'universal'): 2,
    ('linux', 'x64'): 4, ('linux', 'arm64'): 4,
}


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def gh(*arguments: str) -> str:
    result = subprocess.run(['gh', *arguments], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'GitHub CLI command failed')
    return result.stdout.strip()


def release_information(repository: str, tag: str) -> dict:
    # The REST tag endpoint only finds published releases; CLI lookup includes drafts.
    identifier = gh('release', 'view', tag, '--json', 'databaseId', '--jq', '.databaseId')
    return json.loads(gh('api', f'repos/{repository}/releases/{identifier}'))


def collect_assets(version: str, commit: str) -> list[Path]:
    manifests = sorted(ASSETS.glob('ScTranslateKit-*-build.json'))
    combinations = set()
    names = set()
    for manifest in manifests:
        data = json.loads(manifest.read_text(encoding='utf-8'))
        combination = (data['platform'], data['arch'])
        if combination not in COMBINATIONS or combination in combinations:
            raise RuntimeError(f'Unexpected or duplicate build: {combination}')
        combinations.add(combination)
        if data['version'] != version or data['commit'] != commit:
            raise RuntimeError(f'Build source mismatch: {manifest.name}')
        if len(data['packages']) != COMBINATIONS[combination]:
            raise RuntimeError(f'Incomplete build: {manifest.name}')
        names.add(manifest.name)
        for package in data['packages']:
            name = package['name']
            if Path(name).name != name or name in names:
                raise RuntimeError(f'Invalid or duplicate package name: {name}')
            path = ASSETS / name
            checksum = ASSETS / (name + '.sha256')
            if path.stat().st_size != package['bytes'] or digest(path) != package['sha256']:
                raise RuntimeError(f'Package checksum mismatch: {name}')
            if checksum.read_text(encoding='ascii').strip() != f'{package["sha256"]}  {name}':
                raise RuntimeError(f'Checksum file mismatch: {name}')
            names.update((name, checksum.name))
    if combinations != set(COMBINATIONS):
        raise RuntimeError('All seven platform/architecture builds are required')
    if {path.name for path in ASSETS.iterdir()} != names:
        raise RuntimeError('Unexpected files in release assets')
    return [ASSETS / name for name in sorted(names)]


def release_tag(version: str) -> str:
    if os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch':
        raise RuntimeError('Releases require a manually dispatched workflow')
    ref = os.environ['GITHUB_REF']
    if ref.startswith('refs/tags/v'):
        tag = ref.removeprefix('refs/tags/')
        if tag != f'v{version}':
            raise RuntimeError('Release tag must match package.json version')
        return tag
    default_branch = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))['repository']['default_branch']
    if ref != f'refs/heads/{default_branch}':
        raise RuntimeError('Select the default branch or a matching version tag to publish')
    return f'v{version}+build.{os.environ["GITHUB_RUN_NUMBER"]}'


def cleanup_run_artifacts(repository: str, run_id: str) -> None:
    expected = {f'ScTranslateKit-{platform}-{arch}' for platform, arch in COMBINATIONS}
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100'))
    artifacts = [artifact for page in pages for artifact in page['artifacts'] if artifact['name'] in expected]
    for artifact in artifacts:
        gh('api', '--method', 'DELETE', f'repos/{repository}/actions/artifacts/{artifact["id"]}')
    print(f'Removed {len(artifacts)} published workflow artifacts ({sum(artifact["size_in_bytes"] for artifact in artifacts)} bytes)')


def main() -> None:
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    tag = release_tag(version)
    commit = os.environ['GITHUB_SHA']
    repository = os.environ['GH_REPO']
    assets = collect_assets(version, commit)
    hashes = {path.name: 'sha256:' + digest(path) for path in assets}
    prerelease = '-' in version.split('+', 1)[0]
    title = f'ScTranslateKit {tag.removeprefix("v")}'
    notes = ROOT / 'release-notes.md'
    run_url = f'https://github.com/{repository}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    section = re.search(rf'(?ms)^## {re.escape(version)}\s*\n(.*?)(?=^## |\Z)', changelog)
    if not section:
        raise RuntimeError(f'CHANGELOG.md has no entry for {version}')
    notes.write_text(
        f'手动触发 Actions 构建发布，源码提交：`{commit}`。\n\n'
        f'{section.group(1).strip()}\n\n'
        f'[构建记录]({run_url})\n\n'
        '- Windows：x64、ARM64（安装 EXE、便携 EXE、ZIP）\n'
        '- macOS：x64、ARM64、Universal（DMG、ZIP）\n'
        '- Linux：x64、ARM64（AppImage、DEB、RPM、tar.gz）\n\n'
        '共 20 个分发包，附带 SHA256 校验文件及构建清单。\n\n'
        'Windows 包未签名；macOS 使用临时签名，未经过 Apple 公证。'
        '编译与打包已完成，各平台安装运行尚未验证。\n', encoding='utf-8')
    existing = subprocess.run(['gh', 'release', 'view', tag, '--json', 'isDraft,isImmutable,targetCommitish'], text=True, capture_output=True)
    if existing.returncode == 0:
        information = json.loads(existing.stdout)
        tag_result = subprocess.run(['gh', 'api', f'repos/{repository}/commits/{quote(tag, safe="")}', '--jq', '.sha'], text=True, capture_output=True)
        if tag_result.returncode == 0:
            tagged_commit = tag_result.stdout.strip()
        elif information['isDraft'] and '404' in tag_result.stderr:
            # GitHub can defer creating a new tag until the draft is published.
            tagged_commit = information['targetCommitish']
        else:
            raise RuntimeError('Cannot verify existing release source')
        if tagged_commit != commit:
            raise RuntimeError('Existing release tag points to a different commit')
        if information['isImmutable']:
            release = release_information(repository, tag)
            if {item['name']: item.get('digest') for item in release['assets']} != hashes:
                raise RuntimeError('Immutable release already exists with different assets')
            print(f'Release already published: {release["html_url"]}')
            return
    else:
        gh('release', 'create', tag, '--target', commit, '--draft', '--title', title, '--notes-file', str(notes))
    gh('release', 'upload', tag, *(str(path) for path in assets), '--clobber')
    # Check uploaded files before publishing the draft or marking it as latest.
    release = release_information(repository, tag)
    if {item['name']: item.get('digest') for item in release['assets']} != hashes:
        raise RuntimeError('Uploaded release assets do not match the complete build')
    gh('release', 'edit', tag, '--draft=false', f'--prerelease={str(prerelease).lower()}',
       f'--latest={str(not prerelease).lower()}', '--title', title, '--notes-file', str(notes))
    url = gh('release', 'view', tag, '--json', 'url', '--jq', '.url')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with Path(summary).open('a', encoding='utf-8') as stream:
            stream.write(f'## 手动 Release 已发布\n\n[{tag}]({url})\n\n7 种版本，20 个分发包，SHA256 与构建清单齐全。\n')
    print(f'Published {len(assets)} assets: {url}')


if __name__ == '__main__':
    main()
