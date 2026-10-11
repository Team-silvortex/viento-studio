#!/usr/bin/env python3
"""Read-only final source, atlas, authors and evidence confirmation.

Draft: run only after the actual final audit and atlas refresh. Writes exclusively
this NEW final-confirmation.json, with no build, cleanup or product modification.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def main():
    assert not (OUT / 'final-confirmation.json').exists(), 'Never replace final evidence'
    baseline, audit = load('baseline.json'), load('final-audit.json')
    assert audit['ok'] and not audit['errors']
    manifest_sha = sha(OUT / 'source-hashes.json')
    frozen = load('source-hashes.json')
    assert audit['frozenSource']['baselineSha256'] == manifest_sha
    assert audit['frozenSource']['allMatch'] and not audit['frozenSource']['drift']
    for path, digest in frozen.items():
        assert sha(ROOT / path) == digest, path
    atlas_path = ROOT / 'docs/function-atlas.json'
    atlas = json.loads(atlas_path.read_text(encoding='utf-8'))
    assert audit['atlas']['currentSha256'] == sha(atlas_path)
    for path, digest in atlas['sourceSnapshot'].items():
        assert sha(ROOT / path) == digest, path
    for filename, count, key in [('historical-baseline.json', 'historicalFiles', 'historical'), ('author-baseline.json', 'authorFiles', 'author')]:
        mapping = load(filename); assert len(mapping) == baseline[count]
        assert audit[key]['baselineSha256'] == sha(OUT / filename) and audit[key]['allMatch'] and not audit[key]['drift']
        for path, digest in mapping.items():
            assert sha(ROOT / path) == digest, path
    tools = load('tool-baseline.json')
    assert audit['externalTools']['baselineSha256'] == sha(OUT / 'tool-baseline.json')
    assert len(tools) == audit['externalTools']['count']
    assert all(item['matches'] for item in audit['externalTools']['tools'].values())
    review = load('review.json'); assert review['ok'] and not review['openFindings']
    assert review['finalSourceFreeze']['manifestSha256'] == manifest_sha
    prepared = load('packaged-resources.json'); assert prepared['ok']
    assert prepared['frozenSource']['manifestSha256'] == manifest_sha
    docs = load('document-review.json'); assert docs['ok'] and not docs['findings']
    for item in docs['reviewedFiles']:
        assert sha(ROOT / item['path']) == item['sha256'], item['path']
    cleanup = load('cleanup.json'); assert cleanup['ok'] and cleanup['directoriesRemainAbsent']
    assert cleanup['sourceManifestSha256'] == manifest_sha
    for item in cleanup['removed']:
        assert not (ROOT / item['path']).exists() and not (ROOT / item['path']).is_symlink()
    result = load('results.json'); assert result['ok'] and result['sources']['manifestSha256'] == manifest_sha
    assert result['verification']['currentDocumentationReview']['sha256'] == sha(OUT / 'document-review.json')
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == baseline['head']
    assert (ROOT / 'VERSION').read_text().strip() == baseline['version']
    assert subprocess.run(['git', 'diff', '--check'], cwd=ROOT).returncode == 0
    counts = {key: len(atlas[key]) for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']}
    counts.update({key: len(value) for key, value in atlas['axes'].items()})
    report = {
        'format': 'viento-scene-composition-fragment-rename-final-confirmation', 'schemaVersion': 1,
        'ok': True, 'createdAt': datetime.now(timezone.utc).isoformat(),
        'head': baseline['head'], 'version': baseline['version'], 'sourceFiles': len(frozen),
        'sourceManifestSha256': manifest_sha, 'referencedSourceFiles': len(atlas['sourceSnapshot']),
        'atlas': counts, 'atlasSHA256': sha(atlas_path), 'auditSHA256': sha(OUT / 'final-audit.json'),
        'resultSHA256': sha(OUT / 'results.json'), 'documentReviewSHA256': sha(OUT / 'document-review.json'),
        'authorFiles': baseline['authorFiles'], 'historicalFiles': baseline['historicalFiles'], 'externalTrustedTools': len(tools),
        'scope': 'Read-only confirmation after actual final atlas/source/preservation refresh and precise generated-path cleanup. No referenced report, product, test, author or historical byte mutation; no release/device/installation acceptance.',
    }
    with (OUT / 'final-confirmation.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
