#!/usr/bin/env python3
"""Fresh final document/source/preservation audit. No semantic execution.

This NEW closing report is deliberately not added to atlas sourceSnapshot.
Complete after root cleanup/results/docs/atlas generation have stopped.
"""
import argparse
import json
from review_support import OUT, ROOT, sha, load, write_new, now, frozen_source, preservation, atlas_prefix, identity, document_links

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', default='source-hashes-confirmed.json')
    parser.add_argument('--prepared', default='packaged-resources-confirmed.json')
    args = parser.parse_args()
    assert not (OUT / 'post-cleanup-review.json').exists()
    _, final = frozen_source(args.manifest)
    preserved = preservation()
    current, atlas = atlas_prefix(require_snapshot=True)
    docs = document_links(current['sourceSnapshot'])
    cleanup, results, review = load('cleanup.json'), load('results.json'), load('review.json')
    assert cleanup['ok'] and results['ok'] and review['ok'] and not review['openFindings']
    assert cleanup['sourceManifestSha256'] == final['manifestSha256'] == review['finalSourceFreeze']['manifestSha256']
    prepared = load(args.prepared)
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == final['manifestSha256']
    expected = {'desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist'}
    assert {item['path'] for item in cleanup['removed']} == expected
    assert not any((ROOT / path).exists() or (ROOT / path).is_symlink() for path in expected)
    for item in cleanup['evidence'].values():
        assert sha(OUT / item['path']) == item['sha256']
    assert cleanup['applicationChecks'] == review['fullApplication']['counts']
    assert results['fullApplication']['counts'] == review['fullApplication']['counts']
    assert results['fullApplication']['executedManifestSha256'] == final['manifestSha256']
    assert results['sourceFreeze']['sha256'] == final['manifestSha256']
    assert results['sourceFreeze']['files'] == 737
    assert review['prepared']['groups'] == results['prepared']['groups'] == 314
    assert results['prepared']['sha256'] == sha(OUT / args.prepared)
    assert final['manifestSha256'] == results['sourceFreeze']['sha256']
    assert (ROOT / 'engine/studio-core.wasm').stat().st_size == 528651
    assert sha(ROOT / 'engine/studio-core.wasm') == 'ac40eb3d9a8ffcb4d079745c2b71492323fbabb1cdf3acda923e3497cbaaaad5'
    closing_path = (OUT / 'post-cleanup-review.json').relative_to(ROOT).as_posix()
    assert closing_path not in current['sourceSnapshot']
    initial, final_hashes = load('source-hashes-final.json'), load(args.manifest)
    assert set(initial) == set(final_hashes)
    phase_delta = {path: {'before': initial[path], 'after': final_hashes[path]}
                   for path in initial if initial[path] != final_hashes[path]}
    assert set(phase_delta) <= {'web/modules/app-scene3d-translation.js', 'scripts/tests/scene3d-translation-ui.test.mjs',
                              'scripts/tests/scene3d-translation-smoke.mjs'}
    assert all(item['sourceSnapshotMatches'] for item in docs['files'].values() if item['sourceSnapshotIncludes'])
    status = (ROOT / 'docs/STATUS.md').read_text()
    for number in [review['fullApplication']['counts']['tests'], 246, 314, 737]:
        assert str(number) in status, ('STATUS current actual count', number)
    report = {'format': 'viento-scene3d-translation-independent-post-cleanup-review', 'schemaVersion': 1,
        'observedAt': now(), 'ok': True, 'openFindings': [], **identity(), 'finalSourceFreeze': final,
        'preserved': preserved, 'atlas': atlas, 'documents': {**docs, 'statusCurrentCountsMatchActualReports': True},
        'sharedCore': {'currentWasm': {'bytes': 528651, 'sha256': sha(ROOT / 'engine/studio-core.wasm')},
                       'currentMetadataSha256': sha(ROOT / 'engine/studio-core.build.json'),
                       'predecessorProofBytesExact': True},
        'sourcePhases': {'initialManifestSha256': sha(OUT / 'source-hashes-final.json'),
                        'confirmedManifestSha256': final['manifestSha256'], 'initialToConfirmedChanges': phase_delta},
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'),
            'generatedPathsRemainAbsent': sorted(expected), 'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'],
            'logicalBytesRemoved': cleanup['logicalBytesRemoved'], 'canonicalProofShaPathsMatch': True,
            'scope': 'Fresh absence and retained source/history/tool proof verified. Native executables were verified before root cleanup; reviewer does not reread deleted native binaries or rebuild them.'},
        'results': {'report': 'results.json', 'sha256': sha(OUT / 'results.json'),
                    'actualApplicationAndPreparedCountsAndSourcePhasesMatch': True},
        'closingReportExcludedToAvoidSelfHashCycle': True,
        'scope': 'Fresh read-only final source/history/author/tool/old-core preservation, current atlas ordered-prefix and sourceSnapshot, cleanup/results metadata and eight current documents direct local links/anchors. No Node sidecar, build, semantic test, installation, cleanup or previous report modification.'}
    write_new('post-cleanup-review.json', report)
    print(json.dumps({'ok': True, 'sources': 737, 'historical': preserved['historical']['files'], 'authors': 41,
        'tools': 4, 'atlas': atlas['counts'], 'localReferences': docs['localReferences'], 'anchors': docs['anchors']}))

if __name__ == '__main__':
    main()
