#!/usr/bin/env python3
"""Read-only final source/proof review; write only two NEW independent reports.

Run after the actual completed full suite. Do not rebuild, install, alter source
or history, or remove generated data. All earlier proof files remain immutable.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import stat
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(name):
    return json.loads((OUT / name).read_text())


def suite(name, require_pass=True):
    text = (OUT / name).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(rows) == 6, f'Exactly one actual completed suite is required: {name}'
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] > 0
    if require_pass:
        assert counts['tests'] == counts['pass']
        assert all(counts[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    duration = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', text, re.MULTILINE)
    return {'report': name, 'sha256': sha(OUT / name), 'counts': counts,
            'durationMs': float(duration[0]) if duration else None}


def prefix_review():
    old = load('atlas-baseline.json')
    now = json.loads((ROOT / 'docs/function-atlas.json').read_text())
    checks = {}
    for key, value in old['axes'].items():
        checks['axes.' + key] = now['axes'][key][:len(value)] == value
    for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
        checks[key] = now[key][:len(old[key])] == old[key]
    assert all(checks.values())
    return {'path': 'docs/function-atlas.json', 'sha256': sha(ROOT / 'docs/function-atlas.json'),
            'baselineSha256': sha(OUT / 'atlas-baseline.json'), 'oldPrefixDeepExact': checks,
            'oldScoresCoordinatesReasonsExact': True,
            'currentCounts': {'functions': len(now['axes']['function']), 'implementations': len(now['axes']['implementation']),
                              **{key: len(now[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}},
            'phase': 'Current JSON before root closing references and final derived generation; later append-only evidence and sourceSnapshot refresh are reviewed separately.'}


def main():
    assert not (OUT / 'review.json').exists() and not (OUT / 'preservation-audit-before-cleanup.json').exists()
    app = suite('app-check.log')
    frozen = load('source-hashes-confirmed.json')
    assert len(frozen) == 718 and all(sha(ROOT / path) == digest for path, digest in frozen.items())
    manifest_sha = sha(OUT / 'source-hashes-confirmed.json')
    initial_manifest_sha = sha(OUT / 'source-hashes-final.json')
    assert initial_manifest_sha == 'd8d3dcf1cd95bd731c304429026b299068f4d0d9321b8d99ec1e8cfbf9be72c0'
    initial_frozen = load('source-hashes-final.json')
    assert set(initial_frozen) == set(frozen)
    confirmed_changes = [path for path in initial_frozen if initial_frozen[path] != frozen[path]]
    assert confirmed_changes == ['scripts/tests/scene3d-environment-system-ports.test.mjs']
    count_test = (ROOT / confirmed_changes[0]).read_text()
    reconstructed_before = count_test.replace('assert.equal(snapshot.plan.modules.length, 12);', 'assert.equal(snapshot.plan.modules.length, 11);', 1)
    reconstructed_before = reconstructed_before.replace('assert.equal(snapshot.plan.capabilities.length, 28);', 'assert.equal(snapshot.plan.capabilities.length, 27);', 1)
    assert hashlib.sha256(reconstructed_before.encode()).hexdigest() == initial_frozen[confirmed_changes[0]]
    final = {'manifest': 'source-hashes-confirmed.json', 'manifestSha256': manifest_sha, 'files': len(frozen),
             'allMatch': True, 'drift': [], 'missing': [], 'initialManifest': 'source-hashes-final.json',
             'initialManifestSha256': initial_manifest_sha, 'initialToConfirmedChanges': confirmed_changes,
             'timing': 'Only the old environment system test registry count expectations changed 11/27 to 12/28 after the initial full failure. Initialized-module and independent authority expectations remain unchanged. Product, native core, UI and browser sources are unchanged; root repeated the full application suite and copied-resource verification against this confirmed manifest.'}
    previous = load('source-baseline.json')
    delta = {'previous': len(previous), 'current': len(frozen), 'added': sorted(set(frozen) - set(previous)),
             'changed': {path: {'before': digest, 'after': frozen[path]} for path, digest in previous.items() if path in frozen and frozen[path] != digest},
             'removed': sorted(set(previous) - set(frozen))}
    root_freeze = load('source-freeze-confirmed.json')
    assert delta['changed'] == root_freeze['changed'] and delta['removed'] == []
    assert set(delta['added']) == set(root_freeze['added']) and len(delta['added']) == 10 and len(delta['changed']) == 18
    allowed_sources = set(delta['changed']) | set(delta['added'])
    docs = {'README.md', 'docs/STATUS.md', 'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/STUDIO_MODULES.md', 'docs/SCENE3D.md',
            'docs/function-atlas.json', 'docs/FUNCTION_ATLAS.md', 'docs/function-atlas.html', 'docs/function-atlas.mmd'}
    preserved = {}
    for key, name in [('historical', 'historical-baseline.json'), ('authors', 'author-baseline.json')]:
        baseline = load(name)
        changed = [path for path, digest in baseline.items() if not (ROOT / path).is_file() or sha(ROOT / path) != digest]
        assert not changed, changed
        preserved[key] = {'files': len(baseline), 'baselineSha256': sha(OUT / name), 'changed': [], 'allByteShaMatch': True}
    tool_actual = {}
    for path, item in load('tool-baseline.json').items():
        metadata = Path(path).lstat()
        assert stat.S_ISREG(metadata.st_mode)
        actual = {'sha256': sha(path), 'bytes': metadata.st_size, 'dev': metadata.st_dev, 'ino': metadata.st_ino, 'nlink': metadata.st_nlink}
        assert actual == item, path
        tool_actual[path] = actual
    preserved['externalTools'] = {'files': len(tool_actual), 'baselineSha256': sha(OUT / 'tool-baseline.json'), 'changed': [],
                                  'byteShaSizeDevInoAndNlinkMatch': True, 'actual': tool_actual}
    initial_work = load('existing-working-tree-baseline.json')
    missing, changed = [], []
    for path, item in initial_work.items():
        if 'sha256' not in item:
            continue
        if not (ROOT / path).is_file():
            missing.append(path)
        elif sha(ROOT / path) != item['sha256']:
            changed.append(path)
    assert not missing and set(changed) <= allowed_sources | docs, (missing, changed)
    preserved['preexistingWorkingTree'] = {'files': len(initial_work), 'missing': [], 'byteExactFiles': len(initial_work) - len(changed),
                                         'approvedCurrentSliceChanges': changed, 'noResetOrDeletePerformed': True}
    protected = load('protected-source-baseline.json')
    changes = [path for path, digest in protected.items() if sha(ROOT / path) != digest]
    assert set(changes) <= allowed_sources
    preserved['protectedSource'] = {'files': len(protected), 'unchanged': len(protected) - len(changes),
                                    'approvedAdditiveIntegrationChanges': changes, 'allOtherProtectedBytesExact': True}
    preserved['atlas'] = prefix_review()
    quality = load('source-quality-initial.json')
    assert quality['ok'] and quality['passed'] == 9 and quality['nativeRequests'] == 17
    assert all(frozen[path] == digest for path, digest in quality['reviewedSources'].items())
    assert sha(quality['native']['path']) == quality['native']['sha256']
    assert sha(ROOT / 'engine/studio-core.wasm') == quality['wasm']['sha256']
    host = suite('host-system-tests-initial.log')
    assert host['counts']['pass'] == 12
    core = load('core-results.json')
    assert core['status'] == 'passed' and all(frozen[item['path']] == item['sha256'] for item in core['sourceFiles'])
    core_doc = load('core-document-review.json')
    assert core_doc['status'] == 'passed' and not core_doc['links']['failures']
    assert all(sha(ROOT / item['path']) == item['sha256'] for item in core_doc['sourceFiles'] + core_doc['interfaceSources'])
    browser_name = 'browser-properties-initial/browser.json'
    browser = load(browser_name)
    assert browser['ok'] and len(browser['steps']) == 8 and not browser['errors'] and not browser['cspViolations'] and not browser['svgRequests']
    assert browser['sourceStableDuringProof'] and browser['sources'] == browser['sourcesFinal']
    assert all(frozen[path] == digest for path, digest in browser['sources'].items())
    visual = load('copy-boundary-review.json')
    assert visual['ok'] is True and not visual['openFindings']
    assert visual['finalSourceFreeze']['manifestSha256'] == initial_manifest_sha
    assert all(item['personallyViewed'] and sha(OUT / 'browser-properties-initial' / item['file']) == item['sha256'] for item in visual['browser']['screenshots'])
    legacy = {}
    for kind in ['environment', 'objects', 'transforms']:
        path = f'browser-{kind}-regression-1/browser.json'
        proof = load(path)
        assert proof['ok'] and not proof['errors'] and proof['sourceStableDuringProof']
        assert all(frozen[file] == digest for file, digest in proof['sources'].items())
        legacy[kind] = {'report': path, 'sha256': sha(OUT / path), 'flowClasses': len(proof['steps']), 'sourceStableDuringProof': True}
    prepared = load('packaged-resources-confirmed.json')
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == manifest_sha
    original_prepared = load('packaged-resources-final.json')
    assert prepared['artifacts'] == original_prepared['artifacts'] and prepared['portable'] == original_prepared['portable']
    copies = {}
    for name, item in prepared['artifacts'].items():
        actual = {path.relative_to(ROOT / name).as_posix(): path for path in (ROOT / name).rglob('*') if path.is_file()}
        assert set(actual) == set(item['manifest'])
        for path, file in actual.items():
            assert sha(file) == item['manifest'][path]['sha256'] and file.stat().st_size == item['manifest'][path]['bytes']
        copies[name] = len(actual)
    kinds = ['properties', 'environment', 'objects', 'transforms', 'scene3d', 'rename', 'definitions', 'groups', 'placements', 'system', 'workflow', 'structure', 'legacy']
    groups = sum(2 * len(prepared['portable']['desktop'][kind]) for kind in kinds)
    assert groups == 252
    for kind in kinds:
        assert prepared['portable']['desktop'][kind] == prepared['portable']['mobile'][kind]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = (ROOT / 'VERSION').read_text().strip()
    assert head == load('baseline.json')['head'] and version == '0.0.10'
    created = datetime.now(timezone.utc).isoformat()
    review = {'format': 'viento-scene3d-property-independent-review', 'schemaVersion': 1, 'createdAt': created,
              'ok': True, 'openFindings': [], 'head': head, 'version': version, 'finalSourceFreeze': final,
              'reviewedSources': {path: frozen[path] for path in ['engine/scene3d-properties.mjs', 'engine/scene3d-authoring.mjs', 'engine/studio-core.mjs',
                  'crates/viento-studio-core/src/scene3d_properties_patch.rs', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js',
                  'engine/studio-modules.mjs', 'web/modules/app-scene3d-properties.js', 'web/scene3d-properties.css',
                  'web/modules/app-scene3d-preview.js', 'web/modules/scene3d-renderer.js']},
              'independent': {'sourceQuality': {'report': 'source-quality-initial.json', 'sha256': sha(OUT / 'source-quality-initial.json'),
                                               'passed': 9, 'failed': 0, 'nativeWasmRequests': 17},
                              'actualHostAndAssembly': {**host, 'applyDigestOwnerVariants': 39, 'readerDigestOwnerVariants': 18,
                                                       'pairwiseBrandDirections': 12, 'crossDomainOldReviewRevocations': 12,
                                                       'cloneRejections': 12, 'modules': 12, 'declarativeCapabilities': 28}},
              'browser': {'report': browser_name, 'sha256': sha(OUT / browser_name), 'flowClasses': 8, 'errors': 0,
                          'sourceStableDuringProof': True, 'boundSources': len(browser['sources']), 'cspViolations': 0,
                          'screenshots': visual['browser']['screenshots'], 'visualConclusion': visual['browser']['visualReview'],
                          'renderer': browser['gpu']['renderer'], 'hardwareClaim': False},
              'legacyBrowserRegressions': legacy,
              'ownerEvidence': {'core': {'report': 'core-results.json', 'sha256': sha(OUT / 'core-results.json'), 'verification': core['verification']},
                                'ui': suite('ui-tests-initial.log'), 'uiRegression': suite('ui-regression-final.log'),
                                'pureRegistry': suite('root-pure-registry-final.log'),
                                'prepared': {'report': 'packaged-resources-confirmed.json', 'sha256': sha(OUT / 'packaged-resources-confirmed.json'),
                                             'groups': groups, 'files': copies, 'modulesEach': prepared['portable']['desktop']['moduleCount']},
                                'coreDocumentation': {'report': 'core-document-review.json', 'sha256': sha(OUT / 'core-document-review.json'),
                                                      'allSourceAndInterfaceHashesCurrent': True}},
              'fullApplication': {**app, 'state': 'completed', 'claim': 'Actual completed root suite read directly. Focused suite counts are not added to this total.'},
              'resolvedFindings': [],
              'boundaries': ['SET-only one stable UUID name/color value editing; complete original and atomic final schema/budget admission. All numeric tokens, keys, other values, geometry, source ordering, identities, BOM/CRLF and trivia retained.',
                             'Decoded string equality leaves old escaped token exact; explicit color case changes are author intent. Names preserve whitespace, control characters, CR/CRLF and Unicode codepoints without trimming or normalization.',
                             'Fourth private proposal brand plus shared five-field source admission and awaited ownership guards; no sibling/cloned proposal grants write authority. Readonly preview remains its separate three-field reader-only API.',
                             'Apply changes only current source memory. Saved baseline/cache/version, cursor and scroll remain; ordinary Save still checks external-file conflicts. The form works independently without WebGL.',
                             'Independent boot-only module 12/28 and own native version1 capability; absence/unsupported new capability does not disable older source editing or 3D domains. No World/backend/render/implicit Save authority.'],
              'scopeLimits': ['Unpublished incremental work on 0.0.10; no version/commit/push/install/device acceptance.',
                              'Actual Chrome uses recorded SwiftShader software GPU; no hardware GPU, Godot pixel-parity or backend-runtime integration claim.',
                              'Copied ESM/WASM VM cases prove portability with injected DTO/hash ports, not a security sandbox.',
                              'Independent probes cover ordinary source/ownership/native quality. Hostile reply cases are existing owner evidence, not newly claimed independent attack probes.'],
              'initialAttempts': {'preparedFixture': 'prepared-check-initial.mjs/log retained. A NEW invalid-space path expected conflict but correctly produced invalid; repair uses valid documents/other.json, without product changes.',
                                  'application': suite('app-check-initial.log', require_pass=False),
                                  'applicationFailure': 'One old environment system test expected registry plan counts 11 modules/27 capabilities. Those count assertions now expect 12/28 for the additive property registry; independent port/initialized-module and authority assertions were retained. Initial full log/source manifests/prepared proof/copy review remain immutable.'}}
    preservation = {'format': 'viento-scene3d-property-independent-preservation', 'schemaVersion': 1, 'createdAt': created,
                    'ok': True, 'openFindings': [], 'finalSourceFreeze': final,
                    'baseline': {'report': 'baseline.json', 'sha256': sha(OUT / 'baseline.json')}, 'preserved': preserved,
                    'sourceDelta': delta,
                    'generatedDirectories': {'initial': 'generated-paths-initial.json', 'current': {path: {'exists': (ROOT / path).exists(), 'isSymlink': (ROOT / path).is_symlink()} for path in load('generated-paths-initial.json')},
                                             'note': 'Presence recorded before root cleanup. No deletion executed or adoption of unknown data performed by reviewer.'},
                    'scope': 'Fresh read-only current source/history/author/tool identities and old complete ordered atlas prefixes against the immutable initial baseline. Only these two NEW reports written; previous reports retained.'}
    for name, report in [('review.json', review), ('preservation-audit-before-cleanup.json', preservation)]:
        with (OUT / name).open('x') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'ok': True, 'reviewSha256': sha(OUT / 'review.json'), 'preservationSha256': sha(OUT / 'preservation-audit-before-cleanup.json'),
                      'source': len(frozen), 'app': app['counts'], 'historical': preserved['historical']['files'], 'authors': preserved['authors']['files'], 'tools': len(tool_actual)}))


if __name__ == '__main__':
    main()
