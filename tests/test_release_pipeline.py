"""Offline regression checks for release authorization and artifact storage."""
from pathlib import Path
import hashlib
import json
import os
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import ci_artifacts, prepare_build_version, publish_release


class ReleasePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.event = self.root / 'event.json'
        self.event.write_text(json.dumps({'repository': {'default_branch': 'master'}}), encoding='utf-8')
        (self.root / 'package.json').write_text('{"version":"0.1.1"}', encoding='utf-8')
        (self.root / 'package-lock.json').write_text(
            json.dumps({'version': '0.1.1', 'packages': {'': {'version': '0.1.1'}}}), encoding='utf-8')
        self.environment = {
            'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/master',
            'GITHUB_EVENT_PATH': str(self.event), 'GITHUB_RUN_NUMBER': '42',
        }

    def test_automatic_events_cannot_reach_release_apis(self):
        for event in ['push', 'pull_request', 'schedule', 'workflow_run']:
            for ref in ['refs/heads/master', 'refs/tags/v0.1.1']:
                with self.subTest(event=event, ref=ref), \
                        patch.dict(os.environ, {**self.environment, 'GITHUB_EVENT_NAME': event, 'GITHUB_REF': ref}, clear=True), \
                        patch.object(publish_release, 'ROOT', self.root), \
                        patch.object(publish_release, 'gh') as github:
                    with self.assertRaisesRegex(RuntimeError, 'manually dispatched'):
                        publish_release.main()
                    github.assert_not_called()

    def test_manual_default_branch_and_matching_version_tag(self):
        with patch.dict(os.environ, self.environment, clear=True):
            self.assertEqual(publish_release.release_tag('0.1.1'), 'v0.1.1+build.42')
        with patch.dict(os.environ, {**self.environment, 'GITHUB_REF': 'refs/tags/v0.1.1'}, clear=True):
            self.assertEqual(publish_release.release_tag('0.1.1'), 'v0.1.1')

    def test_manual_wrong_branch_or_version_is_rejected(self):
        for ref in ['refs/heads/feature', 'refs/tags/v0.1.0']:
            with self.subTest(ref=ref), patch.dict(os.environ, {**self.environment, 'GITHUB_REF': ref}, clear=True):
                with self.assertRaises(RuntimeError):
                    publish_release.release_tag('0.1.1')

    def test_prepare_build_version_uses_monotonic_workflow_number(self):
        with patch.dict(os.environ, self.environment, clear=True), \
                patch.object(prepare_build_version, 'ROOT', self.root):
            prepare_build_version.main()
        package = json.loads((self.root / 'package.json').read_text(encoding='utf-8'))
        lock = json.loads((self.root / 'package-lock.json').read_text(encoding='utf-8'))
        self.assertEqual(package['version'], '0.1.1+build.42')
        self.assertEqual(lock['version'], '0.1.1+build.42')
        self.assertEqual(lock['packages']['']['version'], '0.1.1+build.42')

    def test_prepare_build_version_preserves_explicit_matching_tag(self):
        environment = {**self.environment, 'GITHUB_REF': 'refs/tags/v0.1.1'}
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(prepare_build_version, 'ROOT', self.root):
            prepare_build_version.main()
        package = json.loads((self.root / 'package.json').read_text(encoding='utf-8'))
        self.assertEqual(package['version'], '0.1.1')

    def test_linux_elf_architecture_is_detected(self):
        executable = self.root / 'service'
        binary = bytearray(64)
        binary[:4] = b'\x7fELF'
        binary[4] = 2
        binary[5] = 1
        struct.pack_into('<H', binary, 18, 62)
        executable.write_bytes(binary)
        self.assertEqual(ci_artifacts.architectures(executable, 'linux'), {'x64'})

    def test_collect_linux_packages_and_checksums(self):
        output, destination = self.root / 'release/ci', self.root / 'release/artifacts'
        source = self.root / 'service/target/release/sctranslate-service'
        bundled = output / 'linux-unpacked/resources/service/sctranslate-service'
        source.parent.mkdir(parents=True)
        bundled.parent.mkdir(parents=True)
        binary = bytearray(64)
        binary[:4] = b'\x7fELF'
        binary[4] = 2
        binary[5] = 1
        struct.pack_into('<H', binary, 18, 62)
        source.write_bytes(binary)
        bundled.write_bytes(binary)
        source.chmod(0o755)
        bundled.chmod(0o755)
        (self.root / 'package.json').write_text('{"version":"0.1.1+build.42"}', encoding='utf-8')
        packages = {
            f'ScTranslateKit-0.1.1-build-42-linux-x64.{extension}': extension.encode()
            for extension in ['AppImage', 'deb', 'rpm', 'tar.gz']
        }
        for name, content in packages.items():
            (output / name).write_bytes(content)

        with patch.dict(os.environ, {'CI_PLATFORM': 'linux', 'CI_ARCH': 'x64', 'GITHUB_SHA': 'linux-test-commit', 'BUILD_NUMBER': '42'}, clear=True), \
                patch.object(ci_artifacts, 'ROOT', self.root), patch.object(ci_artifacts, 'OUTPUT', output), \
                patch.object(ci_artifacts, 'DESTINATION', destination):
            ci_artifacts.main()

        manifest = json.loads((destination / 'ScTranslateKit-0.1.1+build.42-linux-x64-build.json').read_text())
        self.assertEqual(manifest['commit'], 'linux-test-commit')
        self.assertEqual(manifest['version'], '0.1.1+build.42')
        self.assertEqual(len(manifest['packages']), 4)
        for package in manifest['packages']:
            name, content = package['name'], packages[package['name']]
            checksum = hashlib.sha256(content).hexdigest()
            self.assertEqual((destination / name).read_bytes(), content)
            self.assertEqual(package['sha256'], checksum)
            self.assertEqual((destination / (name + '.sha256')).read_text().strip(), f'{checksum}  {name}')

    def test_cleanup_handles_pagination_and_preserves_unrelated_artifacts(self):
        pages = [{'artifacts': [{'id': 1, 'name': 'ScTranslateKit-win-x64', 'size_in_bytes': 100},
                                {'id': 2, 'name': 'test-diagnostics', 'size_in_bytes': 10}]},
                 {'artifacts': [{'id': 3, 'name': 'ScTranslateKit-mac-universal', 'size_in_bytes': 200}]}]
        with patch.object(publish_release, 'gh', side_effect=[json.dumps(pages), '', '']) as github:
            publish_release.cleanup_run_artifacts('owner/repo', '42')
        self.assertEqual(github.call_args_list[0].args,
                         ('api', '--paginate', '--slurp', 'repos/owner/repo/actions/runs/42/artifacts?per_page=100'))
        self.assertEqual([call.args[-1] for call in github.call_args_list[1:]],
                         ['repos/owner/repo/actions/artifacts/1', 'repos/owner/repo/actions/artifacts/3'])
        self.assertTrue(all(call.args[:3] == ('api', '--method', 'DELETE') for call in github.call_args_list[1:]))

    def prepare_packages(self):
        output, destination = self.root / 'release/ci', self.root / 'release/artifacts'
        service = self.root / 'service/target/release/sctranslate-service.exe'
        bundled = output / 'win-unpacked/resources/service/sctranslate-service.exe'
        service.parent.mkdir(parents=True)
        bundled.parent.mkdir(parents=True)
        binary = bytearray(128)
        binary[:2] = b'MZ'
        struct.pack_into('<I', binary, 60, 64)
        binary[64:68] = b'PE\0\0'
        struct.pack_into('<H', binary, 68, 0x8664)
        service.write_bytes(binary)
        bundled.write_bytes(binary)
        packages = {'ScTranslateKit-0.1.1-Setup-x64.exe': b'installer',
                    'ScTranslateKit-0.1.1-Portable-x64.exe': b'portable',
                    'ScTranslateKit-0.1.1-win-x64.zip': b'archive'}
        for name, content in packages.items():
            (output / name).write_bytes(content)
        return output, destination, packages, service, bundled

    def test_collect_moves_packages_and_preserves_manifest_checksums(self):
        output, destination, packages, service, bundled = self.prepare_packages()
        with patch.dict(os.environ, {'CI_PLATFORM': 'win', 'CI_ARCH': 'x64', 'GITHUB_SHA': 'test-commit'}, clear=True), \
                patch.object(ci_artifacts, 'ROOT', self.root), patch.object(ci_artifacts, 'OUTPUT', output), \
                patch.object(ci_artifacts, 'DESTINATION', destination):
            ci_artifacts.main()
        manifest = json.loads((destination / 'ScTranslateKit-0.1.1-win-x64-build.json').read_text())
        self.assertEqual(manifest['commit'], 'test-commit')
        self.assertEqual(len(manifest['packages']), 3)
        for package in manifest['packages']:
            name, content = package['name'], packages[package['name']]
            self.assertFalse((output / name).exists())
            self.assertEqual((destination / name).read_bytes(), content)
            checksum = hashlib.sha256(content).hexdigest()
            self.assertEqual(package['sha256'], checksum)
            self.assertEqual(package['bytes'], len(content))
            self.assertEqual((destination / (name + '.sha256')).read_text().strip(), f'{checksum}  {name}')
        self.assertTrue(service.is_file())
        self.assertTrue(bundled.is_file())

    def test_architecture_failure_preserves_packages(self):
        output, destination, packages, _, _ = self.prepare_packages()
        with patch.dict(os.environ, {'CI_PLATFORM': 'win', 'CI_ARCH': 'arm64'}, clear=True), \
                patch.object(ci_artifacts, 'ROOT', self.root), patch.object(ci_artifacts, 'OUTPUT', output), \
                patch.object(ci_artifacts, 'DESTINATION', destination):
            with self.assertRaisesRegex(RuntimeError, 'architecture mismatch'):
                ci_artifacts.main()
        self.assertFalse(destination.exists())
        self.assertTrue(all((output / name).is_file() for name in packages))


if __name__ == '__main__':
    unittest.main()
