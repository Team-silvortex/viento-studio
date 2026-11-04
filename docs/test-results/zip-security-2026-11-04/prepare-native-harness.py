#!/usr/bin/env python3
"""Prepare a new isolated crate from production modules or a pre-fix Git snapshot.

Usage: python3 prepare-native-harness.py REPOSITORY NEW_HARNESS [--baseline-ref COMMIT]
The baseline copies only the minimum source files and injects the two current
regression functions into the old test modules; production source is never edited.
Preparation resolves metadata offline and checks every package/dependency edge
against the supplied source lock. Unexpected selections abort preparation.
Run the printed Cargo commands from any directory. Python 3.11+ is required.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import tomllib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('repository', type=Path)
parser.add_argument('harness', type=Path)
parser.add_argument('--baseline-ref')
args = parser.parse_args()
repository = args.repository.resolve()
harness = args.harness.resolve()
harness.mkdir(parents=True, exist_ok=False)
(harness / 'src').mkdir()
source = repository
record = {'baselineRef': args.baseline_ref, 'injectedTests': []}
if args.baseline_ref:
    source = harness / 'snapshot'
    paths = [
        'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
        'src-tauri/src/workspace.rs', 'src-tauri/src/project_templates.rs',
        'src-tauri/src/mobile_storage.rs', 'src-tauri/src/mobile_archive.rs',
        'src-tauri/examples/workspace-archive.rs', 'src-tauri/examples/mobile-storage.rs',
        'scripts/lib/workspace-layout.json', 'scripts/lib/project-templates.json',
    ]
    record['baselineCommit'] = subprocess.check_output(
        ['git', '-C', str(repository), 'rev-parse', args.baseline_ref], text=True
    ).strip()
    for relative in paths:
        content = subprocess.check_output(
            ['git', '-C', str(repository), 'show', f'{args.baseline_ref}:{relative}']
        )
        target = source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    for relative, test, following in [
        ('src-tauri/src/workspace.rs',
         'local_header_name_mismatches_are_rejected_without_restoring_files',
         'wrong_checksum_rolls_back_the_entire_import'),
        ('src-tauri/src/mobile_archive.rs',
         'local_header_name_mismatches_are_rejected_without_publishing_a_project',
         'corrupt_and_oversized_packages_do_not_enter_the_library'),
    ]:
        current = (repository / relative).read_text()
        marker = '    #[test]\n    fn ' + test + '()'
        start = current.index(marker)
        end = current.index('    #[test]', start + len(marker))
        regression = current[start:end]
        target = source / relative
        original = target.read_text()
        anchor = '    #[test]\n    fn ' + following + '()'
        assert original.count(anchor) == 1, (relative, anchor)
        reconstructed = original.replace(anchor, regression + anchor, 1)
        target.write_text(reconstructed)
        record['injectedTests'].append({
            'file': relative, 'test': test,
            'originalSourceSha256': hashlib.sha256(original.encode()).hexdigest(),
            'regressionSha256': hashlib.sha256(regression.encode()).hexdigest(),
            'reconstructedSourceSha256': hashlib.sha256(reconstructed.encode()).hexdigest(),
        })
manifest = tomllib.loads((source / 'src-tauri/Cargo.toml').read_text())
lock = tomllib.loads((source / 'src-tauri/Cargo.lock').read_text())
selected = ['serde', 'serde_json', 'uuid', 'sha2', 'unicode-normalization', 'zip', 'tempfile', 'fs2']
lines = ['[package]', 'name = "viento-studio"',
         'version = ' + json.dumps(manifest['package']['version']),
         'edition = "2021"', '[lib]', 'name = "viento_studio"', '[dependencies]']
for name in selected:
    spec = manifest['dependencies'][name]
    if isinstance(spec, str):
        spec = {'version': spec}
    locked = [package['version'] for package in lock['package'] if package['name'] == name]
    assert len(locked) == 1, (name, locked)
    items = ['version = ' + json.dumps('=' + locked[0])]
    if 'default-features' in spec:
        items.append('default-features = ' + str(spec['default-features']).lower())
    if 'features' in spec:
        items.append('features = ' + json.dumps(spec['features']))
    lines.append(name + ' = { ' + ', '.join(items) + ' }')
for binary in ['workspace-archive', 'mobile-storage']:
    lines += ['[[bin]]', 'name = ' + json.dumps(binary),
              'path = ' + json.dumps(str(source / 'src-tauri/examples' / f'{binary}.rs'))]
lines += ['[profile.dev]', 'debug = 0', 'incremental = false',
          '[profile.test]', 'debug = 0', 'incremental = false']
(harness / 'Cargo.toml').write_text('\n'.join(lines) + '\n')
(harness / 'src/lib.rs').write_text(
    '#![allow(dead_code)]\n#[path = ' + json.dumps(str(source / 'src-tauri/src/workspace.rs'))
    + ']\npub mod workspace;\n#[path = ' + json.dumps(str(source / 'src-tauri/src/mobile_storage.rs'))
    + ']\npub mod mobile_storage;\n'
)
shutil.copyfile(source / 'src-tauri/Cargo.lock', harness / 'Cargo.lock')
# Prune only the temporary root's unused packages, then verify every resulting
# package and dependency edge against the supplied production/snapshot lock.
metadata = subprocess.check_output([
    'cargo', 'metadata', '--manifest-path', str(harness / 'Cargo.toml'),
    '--offline', '--format-version', '1',
])
(harness / 'metadata.json').write_bytes(metadata)

def dependency_graph(path):
    packages = tomllib.loads(path.read_text())['package']
    versions = {}
    for package in packages:
        versions.setdefault(package['name'], []).append(package['version'])
    graph = {}
    for package in packages:
        dependencies = set()
        for dependency in package.get('dependencies', []):
            parts = dependency.split()
            if len(parts) > 1:
                version = parts[1]
            else:
                assert len(versions[parts[0]]) == 1, (package['name'], dependency)
                version = versions[parts[0]][0]
            dependencies.add((parts[0], version))
        graph[(package['name'], package['version'])] = dependencies
    return graph

expected = dependency_graph(source / 'src-tauri/Cargo.lock')
actual = dependency_graph(harness / 'Cargo.lock')
mismatches = []
for package, dependencies in actual.items():
    if package not in expected:
        mismatches.append({'package': package, 'unexpectedPackage': True})
    elif dependencies - expected[package]:
        mismatches.append({'package': package,
                           'unexpectedDependencies': sorted(dependencies - expected[package])})
check = {
    'expectedLockSha256': hashlib.sha256((source / 'src-tauri/Cargo.lock').read_bytes()).hexdigest(),
    'harnessLockSha256': hashlib.sha256((harness / 'Cargo.lock').read_bytes()).hexdigest(),
    'packageCount': len(actual),
    'allPackagesAndDependencyEdgesAreSubsetOfSourceLock': not mismatches,
    'mismatches': mismatches,
    'tempfileDependencies': sorted(actual[('tempfile',
        next(package['version'] for package in lock['package'] if package['name'] == 'tempfile'))]),
}
(harness / 'dependency-graph-check.json').write_text(json.dumps(check, indent=2) + '\n')
if mismatches:
    raise RuntimeError('Cargo changed source dependency selections; see dependency-graph-check.json')
record['directDependencies'] = {
    name: next(package['version'] for package in lock['package'] if package['name'] == name)
    for name in selected
}
(harness / 'reconstruction.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'manifest': str(harness / 'Cargo.toml'),
                  'commands': [
                      ['cargo', 'metadata', '--manifest-path', str(harness / 'Cargo.toml'), '--offline', '--format-version', '1'],
                      ['cargo', 'test', '--manifest-path', str(harness / 'Cargo.toml'), '--offline', '--locked', '--lib',
                       *(['local_header_name_mismatches', '--', '--nocapture'] if args.baseline_ref else [])],
                  ]}, indent=2))
