#!/usr/bin/env python3
"""Delete only this slice's five initially absent generated directories.

Draft: do not run until all final application, browser, independent review,
prepared-copy and preservation proofs exist. Counts are read from completed
reports/logs, never guessed. Authors, history, tools, dependencies and tested
shared WASM remain outside the exact deletion list. No broad cache discovery.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import shutil
import stat

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
EXPECTED = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']


def load(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def finished_suite(name):
    text = (OUT / name).read_text(encoding='utf-8')
    matches = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(matches) == 6, f'Exactly one completed suite is required: {name}'
    result = {key: int(value) for key, value in matches}
    assert result.keys() == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    assert result['tests'] > 0 and result['tests'] == result['pass']
    assert all(result[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    return result


def no_owned_executable_active(owned):
    # The pinned Node and native helper paths must not be removed mid-run.
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal():
            continue
        try:
            executable = (proc / 'exe').resolve(strict=True)
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        assert not any(executable.is_relative_to(path) for path in owned), f'Generated executable still active: {proc.name}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-log', default='app-check.log')
    parser.add_argument('--review-report', default='review.json')
    parser.add_argument('--browser-report', help='Canonical successful NEW browser report; defaults to review.browser.path')
    parser.add_argument('--preservation-report', default='preservation-audit-before-cleanup.json')
    args = parser.parse_args()
    assert not (OUT / 'cleanup.json').exists(), 'Never repeat cleanup over later generated data'
    initial = load('generated-paths-initial.json')
    assert all(initial[name] == {'exists': False} for name in EXPECTED)
    app = finished_suite(args.app_log)
    prepared, review, preservation = load('packaged-resources.json'), load(args.review_report), load(args.preservation_report)
    assert prepared['ok'] is True and review['ok'] is True and not review['openFindings']
    assert preservation['ok'] is True and not preservation['openFindings']
    manifest_sha = sha(OUT / 'source-hashes-final.json')
    preserved = preservation['preserved']
    assert preservation['finalSourceFreeze']['manifestSha256'] == manifest_sha
    assert preservation['finalSourceFreeze']['allMatch'] is True
    assert prepared['frozenSource']['manifestSha256'] == manifest_sha
    assert review['finalSourceFreeze']['manifestSha256'] == manifest_sha
    for key, report_key in [('historical', 'historical-baseline.json'), ('authors', 'author-baseline.json')]:
        assert not preserved[key]['changed']
        assert preserved[key]['baselineSha256'] == sha(OUT / report_key)
        baseline = load(report_key)
        assert preserved[key]['files'] == len(baseline)
        for file, digest in baseline.items():
            assert sha(ROOT / file) == digest, file
    assert not preserved['externalTools']['changed']
    assert preserved['externalTools']['byteShaSizeDevInoAndNlinkMatch'] is True
    tool_baseline = load('tool-baseline.json')
    assert preserved['externalTools']['files'] == len(tool_baseline)
    for name, item in tool_baseline.items():
        tool = Path(name)
        metadata = tool.stat()
        assert sha(tool) == item['sha256'] and metadata.st_size == item['bytes'], name
        assert (metadata.st_dev, metadata.st_ino, metadata.st_nlink) == (item['dev'], item['ino'], item['nlink']), name
    browser_name = args.browser_report or review['browser']['report']
    browser_path = (OUT / browser_name).resolve(strict=True)
    assert browser_path.is_relative_to(OUT) and browser_path.is_file()
    browser = json.loads(browser_path.read_text())
    assert browser['ok'] is True and browser['steps'] and not browser['errors'] and not browser.get('svgRequests', [])
    assert browser['sourceStableDuringProof'] is True
    assert len(browser['steps']) == review['browser']['flowClasses']
    frozen = load('source-hashes-final.json')
    for name, digest in frozen.items():
        assert sha(ROOT / name) == digest, name
    for name, digest in browser['sources'].items():
        assert frozen[name] == digest, name
    helpers = [{'path': str(ROOT / name), **item} for name, item in load('native-helpers.json')['files'].items()]
    for item in helpers:
        path = Path(item['path'])
        assert path.is_relative_to(ROOT / 'desktop/.cache')
        assert path.stat().st_size == item['bytes'] and sha(path) == item['sha256']
    node = load('fixed-node.json')
    assert Path(node['node']).is_relative_to(ROOT / 'src-tauri/binaries')
    assert sha(node['node']) == node['nodeSHA256']
    owned = [ROOT / name for name in EXPECTED]
    identities = {}
    for directory in owned:
        # Reject a symlink at the owned directory or any ancestor component.
        current = directory
        while current != ROOT:
            assert not current.is_symlink(), str(current)
            current = current.parent
        assert directory.is_dir() and directory.resolve(strict=True) == directory
        metadata = directory.stat()
        identities[directory] = (metadata.st_dev, metadata.st_ino)
    assert getattr(shutil.rmtree, 'avoids_symlink_attacks', False), 'Require fd-based directory removal'
    no_owned_executable_active(owned)
    entries, inode_counts, inode_stats = [], {}, {}
    for name, directory in zip(EXPECTED, owned):
        logical = files = 0
        for parent, dirs, names in os.walk(directory, followlinks=False):
            for child in names:
                path = Path(parent) / child
                metadata = path.lstat()
                assert stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode), f'Unexpected special file: {path}'
                logical += metadata.st_size
                files += 1
                identity = (metadata.st_dev, metadata.st_ino)
                inode_counts[identity] = inode_counts.get(identity, 0) + 1
                inode_stats.setdefault(identity, (metadata.st_blocks * 512, metadata.st_nlink))
        entries.append({'path': name, 'files': files, 'logicalBytes': logical, 'allocatedFileBytes': 0})
    # Deduplicate hard links across owned paths. External links are not counted
    # as reclaimed blocks because their inode survives removing these names.
    seen = set()
    for directory, entry in zip(owned, entries):
        for parent, dirs, names in os.walk(directory, followlinks=False):
            for child in names:
                metadata = (Path(parent) / child).lstat()
                identity = (metadata.st_dev, metadata.st_ino)
                if identity in seen:
                    continue
                seen.add(identity)
                blocks, links = inode_stats[identity]
                if inode_counts[identity] == links:
                    entry['allocatedFileBytes'] += blocks
    no_owned_executable_active(owned)
    for directory in owned:
        assert not directory.is_symlink() and directory.resolve(strict=True) == directory
        metadata = directory.stat()
        assert (metadata.st_dev, metadata.st_ino) == identities[directory], f'Owned directory changed: {directory}'
    for directory in owned:
        shutil.rmtree(directory)
    assert not any(path.exists() or path.is_symlink() for path in owned)
    # All source (including the tested shared WASM) stays outside these paths.
    for name, digest in frozen.items():
        assert sha(ROOT / name) == digest, name
    report = {
        'format': 'viento-scene3d-picking-cleanup', 'schemaVersion': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
        'scope': 'Only the five exact generated directories absent in this slice baseline. Final full application, prepared/browser and independent preservation proofs completed first.',
        'sourceManifestSha256': manifest_sha, 'application': app,
        'evidence': {'prepared': {'path': 'packaged-resources.json', 'sha256': sha(OUT / 'packaged-resources.json')},
                     'review': {'path': args.review_report, 'sha256': sha(OUT / args.review_report)},
                     'browser': {'path': str(browser_path.relative_to(OUT)), 'sha256': sha(browser_path)},
                     'preservation': {'path': args.preservation_report, 'sha256': sha(OUT / args.preservation_report)}},
        'removed': entries, 'allocatedFileBytesRemoved': sum(item['allocatedFileBytes'] for item in entries),
        'logicalBytesRemoved': sum(item['logicalBytes'] for item in entries),
        'allocationMeasurement': 'st_blocks * 512, file inodes counted once across the deletion set; inodes with external hard links excluded; directory blocks excluded.',
        'helpersVerifiedBeforeRemoval': helpers,
        'retained': ['tested engine/studio-core.wasm and build metadata', 'author definitions and example assets',
                     'all historical and new evidence', 'dependencies', 'external trusted tools', 'installed applications and preferences'],
        'directoriesRemainAbsent': True,
    }
    with (OUT / 'cleanup.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['ok', 'allocatedFileBytesRemoved', 'logicalBytesRemoved']}))


if __name__ == '__main__':
    main()
