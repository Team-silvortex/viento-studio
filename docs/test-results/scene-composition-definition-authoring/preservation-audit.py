#!/usr/bin/env python3
"""Read-only repository preservation audit; writes only this round's report.

Run from any directory. --baseline-only skips atlas and Markdown until the final
append is ready; --after-cleanup additionally requires the five initially absent
owned generated paths to be absent. No build, deletion, or source edit occurs.
"""
from pathlib import Path
import argparse
import datetime
import hashlib
import html
import json
import os
import re
import stat
import subprocess
import sys
import urllib.parse

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[2]
EXPECTED_DELTA = set("""
crates/viento-studio-core/src/lib.rs
crates/viento-studio-core/src/scene_composition_definitions_patch.rs
engine/README.md
engine/index.mjs
engine/scene-authoring-candidate.mjs
engine/scene-authoring-workflow.mjs
engine/scene-composition-definitions.mjs
engine/studio-core.build.json
engine/studio-core.mjs
engine/studio-core.wasm
scripts/tests/dialog-harness.mjs
scripts/tests/scene-authoring-ui.test.mjs
scripts/tests/scene-composition-definitions-fixture.mjs
scripts/tests/scene-composition-definitions-host.test.mjs
scripts/tests/scene-composition-definitions-preview.test.mjs
scripts/tests/scene-composition-definitions-smoke.mjs
scripts/tests/scene-composition-definitions-ui.test.mjs
scripts/tests/scene-composition-definitions-workflow.test.mjs
scripts/tests/scene-composition-definitions.test.mjs
scripts/tests/studio-core-composition-definitions-patch.test.mjs
web/i18n/en.js
web/i18n/ja.js
web/modules/app-project-build.js
web/modules/app-runtime.js
web/modules/app-scene-authoring.js
web/modules/app-scene-composition-definitions.js
web/modules/app-scene-preview.js
web/project-build.css
""".split())
GENERATED = {'desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist'}
EXCLUDED_PARTS = {'.git', 'node_modules', 'target', '__pycache__'}


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def load(name):
    return json.loads((EVIDENCE / name).read_text(encoding='utf-8'))


def relative_files(directory, excluded=EXCLUDED_PARTS):
    """Never follow symlink directories or enter known generated subtrees."""
    for parent, dirs, files in os.walk(directory, followlinks=False):
        parent = Path(parent)
        dirs[:] = [name for name in dirs if name not in excluded
                   and not (parent / name).is_symlink()
                   and str((parent / name).relative_to(ROOT)) not in GENERATED]
        for name in files:
            yield parent / name


def without_fences(text):
    # Markdown fenced source examples are not repository navigation.
    output, fence = [], None
    for line in text.splitlines():
        opening = re.match(r'^\s{0,3}(`{3,}|~{3,})', line)
        if fence:
            if opening and opening.group(1)[0] == fence[0] and len(opening.group(1)) >= len(fence):
                fence = None
            output.append('')
        elif opening:
            fence = opening.group(1)
            output.append('')
        else:
            output.append(line)
    return '\n'.join(output)


def destination(text, start):
    """Read a CommonMark inline/reference destination, including nested ()."""
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text):
        return None
    if text[start] == '<':
        end = text.find('>', start + 1)
        return text[start + 1:end] if end >= 0 else None
    chars, depth = [], 0
    while start < len(text):
        character = text[start]
        if character == '\\' and start + 1 < len(text):
            chars.append(text[start + 1])
            start += 2
            continue
        if character == '(':
            depth += 1
        elif character == ')':
            if not depth:
                break
            depth -= 1
        if character.isspace() and not depth:
            break
        chars.append(character)
        start += 1
    return ''.join(chars) or None


def headings(file, cache):
    if file in cache:
        return cache[file]
    text = without_fences(file.read_text(encoding='utf-8'))
    found, counts = set(), {}
    for line in text.splitlines():
        match = re.match(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$', line)
        if not match:
            continue
        value = html.unescape(re.sub(r'<[^>]*>', '', match.group(1)))
        value = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', value).lower()
        value = ''.join(character for character in value if character.isalnum() or character in ' _-').replace(' ', '-')
        number = counts.get(value, 0)
        counts[value] = number + 1
        found.add(value if not number else f'{value}-{number}')
    found.update(match.group(1) for match in re.finditer(r'(?:id|name)=["\']([^"\']+)', text))
    cache[file] = found
    return found


def markdown_links():
    files = sorted(file for file in relative_files(ROOT) if file.suffix.lower() == '.md'
                   and not file.is_relative_to(EVIDENCE))
    errors, links, anchors, cache, inventories, rustdoc_symbols = [], 0, 0, {}, {}, []
    for file in files:
        if file.is_symlink():
            errors.append({'file': str(file.relative_to(ROOT)), 'reason': 'symlink_markdown'})
            continue
        inventories[str(file.relative_to(ROOT))] = sha(file)
        text = without_fences(file.read_text(encoding='utf-8'))
        # Exclude inline source-code examples, then include image destinations
        # and reference definitions in the same local path/anchor checks.
        text = re.sub(r'(`+)([^`]|(?!\1)`)*?\1', lambda match: '\n' * match.group(0).count('\n'), text)
        destinations = []
        for match in re.finditer(r'\]\(', text):
            target = destination(text, match.end())
            if target is not None:
                destinations.append((target, text.count('\n', 0, match.start()) + 1))
        for match in re.finditer(r'^\s{0,3}\[[^]]+\]:\s*', text, re.MULTILINE):
            target = destination(text, match.end())
            if target is not None:
                destinations.append((target, text.count('\n', 0, match.start()) + 1))
        for target, line in destinations:
            if re.fullmatch(r'(?:struct|enum|trait|fn|mod|macro|const|type|union|static)@[A-Za-z_][A-Za-z0-9_:]*', target):
                rustdoc_symbols.append({'file': str(file.relative_to(ROOT)), 'line': line, 'target': target})
                continue
            url = urllib.parse.urlsplit(html.unescape(target))
            if url.scheme or url.netloc or target.startswith('/') or '${' in target:
                continue
            location = urllib.parse.unquote(url.path)
            anchor = urllib.parse.unquote(url.fragment)
            dest = (file.parent / location).resolve() if location else file
            links += 1
            issue = {'file': str(file.relative_to(ROOT)), 'line': line, 'target': target}
            if not dest.exists():
                errors.append({**issue, 'reason': 'missing'})
                continue
            if anchor and dest.suffix.lower() == '.md':
                anchors += 1
                if anchor not in headings(dest, cache):
                    errors.append({**issue, 'reason': 'anchor'})
    return {'files': len(files), 'relativeLocalLinks': links, 'markdownAnchors': anchors,
            'excludedEvidenceDirectory': str(EVIDENCE.relative_to(ROOT)),
            'excludedGeneratedPaths': sorted(GENERATED), 'rustdocSymbolsExcluded': rustdoc_symbols, 'errors': errors,
            'sourceInventorySha256': hashlib.sha256(json.dumps(inventories, sort_keys=True).encode()).hexdigest()}


def audit(args):
    errors = []
    report = {'format': 'viento-scene-composition-definition-authoring-preservation-audit', 'schemaVersion': 1,
              'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'mode': 'baseline-only' if args.baseline_only else 'complete',
              'afterCleanup': args.after_cleanup, 'scriptSha256': sha(Path(__file__).resolve()),
              'scope': 'Read-only frozen source, exact approved delta, historical/author bytes, external tool physical identity, append-only atlas and repository Markdown navigation; no build or engine/device execution.'}

    def require(condition, kind, **details):
        if not condition:
            errors.append({'kind': kind, **details})

    def verify_map(name, count):
        mapping, drift = load(name), []
        require(len(mapping) == count, 'baseline_count', baseline=name, expected=count, actual=len(mapping))
        for path, digest in mapping.items():
            file = ROOT / path
            actual = sha(file) if file.is_file() and not file.is_symlink() else None
            if actual != digest:
                drift.append({'path': path, 'expected': digest, 'actual': actual})
        require(not drift, 'byte_drift', baseline=name, entries=drift)
        return mapping, {'files': len(mapping), 'baselineSha256': sha(EVIDENCE / name), 'drift': drift, 'allMatch': not drift}

    baseline = load('baseline.json')
    old = load('source-baseline.json')
    require(len(old) == 639, 'old_source_count', actual=len(old))
    current, report['frozenSource'] = verify_map('source-hashes.json', len(load('source-hashes.json')))
    historical, report['historical'] = verify_map('historical-baseline.json', 3215)
    author, report['author'] = verify_map('author-baseline.json', 39)
    actual_author = {str(file.relative_to(ROOT)) for file in relative_files(ROOT / 'examples')}
    require(actual_author == set(author), 'author_inventory', added=sorted(actual_author - set(author)), missing=sorted(set(author) - actual_author))
    actual_history = {str(file.relative_to(ROOT)) for file in relative_files(ROOT / 'docs' / 'test-results') if not file.is_relative_to(EVIDENCE)}
    require(actual_history == set(historical), 'historical_inventory', added=sorted(actual_history - set(historical)), missing=sorted(set(historical) - actual_history))
    names = set(old)
    for prefix in ['engine', 'web', 'scripts']:
        names.update(str(file.relative_to(ROOT)) for file in relative_files(ROOT / prefix) if file.suffix in ['.mjs', '.js'])
    names.update(str(file.relative_to(ROOT)) for file in relative_files(ROOT / 'crates' / 'viento-studio-core') if file.suffix == '.rs')
    require(names == set(current), 'frozen_source_inventory', added=sorted(names - set(current)), missing=sorted(set(current) - names))
    delta = {path: {'before': old.get(path), 'after': digest} for path, digest in current.items() if old.get(path) != digest}
    require(set(delta) == EXPECTED_DELTA, 'unexpected_source_delta', unexpected=sorted(set(delta) - EXPECTED_DELTA), missing=sorted(EXPECTED_DELTA - set(delta)))
    require(delta == load('source-delta.json'), 'source_delta_manifest')
    require(set(old).issubset(current), 'old_source_removed', paths=sorted(set(old) - set(current)))
    report['sourceDelta'] = {'files': len(delta), 'newFiles': sum(item['before'] is None for item in delta.values()),
                             'modifiedFiles': sum(item['before'] is not None for item in delta.values()),
                             'exactApprovedSet': set(delta) == EXPECTED_DELTA, 'paths': sorted(delta)}
    old_rust = {path: digest for path, digest in old.items() if path.startswith('crates/viento-studio-core/') and path.endswith('.rs')}
    changed_rust = sorted(path for path, digest in old_rust.items() if current.get(path) != digest)
    require(changed_rust == ['crates/viento-studio-core/src/lib.rs'], 'old_rust_changed', paths=changed_rust)
    report['sharedRust'] = {'existingFiles': len(old_rust), 'existingChanges': changed_rust,
                            'newModule': 'crates/viento-studio-core/src/scene_composition_definitions_patch.rs'}
    wasm = ROOT / 'engine' / 'studio-core.wasm'
    build = json.loads((ROOT / 'engine' / 'studio-core.build.json').read_text(encoding='utf-8'))
    require(sha(wasm) == build['wasmSha256'] and wasm.stat().st_size == build['bytes'], 'wasm_build_receipt')
    report['wasm'] = {'purposefullyUpdated': old['engine/studio-core.wasm'] != current['engine/studio-core.wasm'],
                      'bytes': wasm.stat().st_size, 'sha256': sha(wasm), 'buildReceiptMatches': sha(wasm) == build['wasmSha256']}
    tools = load('tool-baseline.json')
    require(len(tools) == 4, 'tool_count', actual=len(tools))
    tool_results = {}
    for name, expected in tools.items():
        file = Path(name)
        try:
            observed = file.lstat()
            actual = {'bytes': observed.st_size, 'sha256': sha(file) if stat.S_ISREG(observed.st_mode) else None,
                      'dev': observed.st_dev, 'ino': observed.st_ino}
        except OSError as error:
            actual = {'error': str(error)}
        require(actual == expected, 'external_tool_changed', path=name, expected=expected, actual=actual)
        tool_results[name] = {'matches': actual == expected, **actual}
    report['externalTools'] = {'count': len(tools), 'baselineSha256': sha(EVIDENCE / 'tool-baseline.json'), 'tools': tool_results}
    head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    version = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    require(head == baseline['head'] and version == baseline['version'], 'head_or_version_changed', head=head, version=version)
    report['head'] = head
    report['version'] = version
    whitespace = subprocess.run(['git', '-C', str(ROOT), 'diff', '--check'], capture_output=True, text=True)
    require(whitespace.returncode == 0, 'diff_whitespace', output=whitespace.stdout + whitespace.stderr)
    report['diffWhitespace'] = 'passed' if whitespace.returncode == 0 else 'failed'
    generated = load('generated-paths-initial.json')
    require(set(generated) == GENERATED and all(not item['exists'] for item in generated.values()), 'generated_baseline_scope')
    report['generatedPaths'] = {name: {'baselineExists': generated[name]['exists'], 'existsNow': os.path.lexists(ROOT / name)} for name in sorted(generated)}
    if args.after_cleanup:
        require(all(not item['existsNow'] for item in report['generatedPaths'].values()), 'owned_generated_directory_remains')
    if not args.baseline_only:
        old_atlas = load('atlas-baseline.json')
        atlas = json.loads((ROOT / 'docs' / 'function-atlas.json').read_text(encoding='utf-8'))
        prefixes = {}
        for axis, entries in old_atlas['axes'].items():
            matches = atlas['axes'][axis][:len(entries)] == entries
            require(matches, 'atlas_axis_prefix', axis=axis)
            prefixes['axes.' + axis] = {'old': len(entries), 'current': len(atlas['axes'][axis]), 'prefixMatches': matches}
        for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
            matches = atlas[key][:len(old_atlas[key])] == old_atlas[key]
            require(matches, 'atlas_prefix', section=key)
            prefixes[key] = {'old': len(old_atlas[key]), 'current': len(atlas[key]), 'prefixMatches': matches}
        require(atlas['schemaVersion'] == old_atlas['schemaVersion'], 'atlas_schema_changed')
        require(atlas['meta'].get('historicalSha256') == old_atlas['meta'].get('historicalSha256'), 'atlas_historical_reference_changed')
        for path, digest in old_atlas['meta'].get('historicalSha256', {}).items():
            require(sha(ROOT / path) == digest, 'old_function_network_bytes_changed', path=path)
        report['atlas'] = {'baselineSha256': sha(EVIDENCE / 'atlas-baseline.json'), 'currentSha256': sha(ROOT / 'docs' / 'function-atlas.json'),
                           'prefixes': prefixes, 'oldScoresAndEvidenceUnchanged': all(value['prefixMatches'] for value in prefixes.values())}
        report['markdown'] = markdown_links()
        require(not report['markdown']['errors'], 'markdown_navigation', entries=report['markdown']['errors'])
    report['errors'] = errors
    report['ok'] = not errors
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-only', action='store_true')
    parser.add_argument('--after-cleanup', action='store_true')
    parser.add_argument('--output', default='preservation-audit.json', help='JSON basename inside this evidence directory')
    args = parser.parse_args()
    if Path(args.output).name != args.output or not args.output.endswith('.json'):
        parser.error('--output must be a JSON basename inside this evidence directory')
    report = audit(args)
    destination_file = EVIDENCE / args.output
    temporary = destination_file.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(destination_file)
    print(json.dumps({key: report[key] for key in ['ok', 'mode', 'head', 'version', 'sourceDelta', 'errors']}, ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
