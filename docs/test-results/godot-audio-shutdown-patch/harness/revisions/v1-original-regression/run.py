#!/usr/bin/env python3
"""Serial validation of a caller-selected Godot audio teardown candidate."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = Path('/home/chiharukiryu/cdev/viento-studio')
MODES = ['never-play', 'stop-free', 'clear-stream', 'two-frames', 'wait-100ms', 'observe-release']
EDGES = ['immediate-play-quit', 'immediate-stop-free', 'immediate-replay-stop-free', 'immediate-paused-quit', 'immediate-multiple-quit', 'failed-active', 'failed-stop-free']
SUITES = [
    ('causal-visit-release', 'scripts/tests/project-causal-anchors-godot.test.mjs', 'native scene switching releases old live roots'),
    ('scene-switching', 'scripts/tests/project-scene-switching-godot.test.mjs', None),
    ('scene-audio', 'scripts/tests/scene-audio-godot.test.mjs', None),
    ('project-audio-control', 'scripts/tests/project-audio-control-godot.test.mjs', None),
]
LEAK = re.compile(r'ObjectDB[^\n]*leak|Leaked instance:|Orphan StringName:|RID[^\n]*leak|resources? still in use at exit', re.I)
ERROR = re.compile(r'^\s*(?:SCRIPT ERROR:|ERROR:)', re.M)


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def source_hashes():
    files = [Path(__file__), HERE / 'godot-verbose.py', *sorted((HERE / 'probes').glob('*.gd'))]
    files += [REPO / file for _, file, _ in SUITES]
    files += [REPO / file for file in ['scripts/adapters/node-project-build.mjs', 'scripts/backends/godot4-adapter.mjs',
              'scripts/backends/godot4-audio.mjs', 'scripts/backends/godot4-project.mjs',
              'scripts/backends/godot4-execution-clock.mjs', 'engine/project-causal-anchors.mjs']]
    files += sorted((REPO / 'scripts/backends/godot4').glob('*.gd'))
    return {str(file): digest(file) for file in files}


def capture(argv, directory, env, prefix, timeout):
    started = time.monotonic()
    child = subprocess.Popen(argv, cwd=directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            stdout, stderr = child.communicate(timeout=1)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate()
    prefix.with_suffix('.stdout.log').write_bytes(stdout)
    prefix.with_suffix('.stderr.log').write_bytes(stderr)
    result = {'argv': list(map(str, argv)), 'exitCode': child.returncode, 'timedOut': timed_out,
              'durationMs': round((time.monotonic() - started) * 1000)}
    dump(prefix.with_suffix('.process.json'), result)
    return result, stdout.decode('utf8', errors='replace'), stderr.decode('utf8', errors='replace')


def no_leaks(stdout, stderr):
    lines = [line for line in (stdout + '\n' + stderr).splitlines() if LEAK.search(line)]
    assert not lines, 'Native teardown leaked objects/resources: ' + '\n'.join(lines)


def frame(stdout, prefix):
    values = [json.loads(line[len(prefix):]) for line in stdout.splitlines() if line.startswith(prefix)]
    assert len(values) == 1, f'Expected exactly one {prefix} marker, got {len(values)}'
    return values[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default=datetime.datetime.now(datetime.timezone.utc).strftime('candidate-%Y%m%dT%H%M%SZ'))
    parser.add_argument('--suite', choices=['all', 'standalone', 'projects'], default='all')
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    if args.list:
        print(json.dumps({'standalone': {'historicalModes': MODES, 'repeats': 3, 'cycles': '32 cycles x 3', 'additionalExitModes': EDGES},
                          'projects': SUITES, 'serial': True, 'nativeLeakAssertions': True}, indent=2))
        return
    assert re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}', args.name), 'Use a short directory name, not a path.'
    tool_value = os.environ.get('VIENTO_GODOT_BIN')
    assert tool_value, 'Set VIENTO_GODOT_BIN to the candidate executable.'
    tool = Path(tool_value).resolve(strict=True)
    assert tool.is_file() and os.access(tool, os.X_OK), 'The candidate must be executable.'
    output = HERE / 'runs' / args.name
    output.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, 'GODOT_SILENCE_ROOT_WARNING': '1'}
    for key, suffix in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache')]:
        env[key] = str(output / 'host' / suffix)
    version_result, version, version_stderr = capture([str(tool), '--version'], HERE, env, output / 'version', 15)
    assert version_result['exitCode'] == 0 and not version_result['timedOut'], version_stderr
    summary = {'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'suite': args.suite,
               'tool': {'path': str(tool), 'version': version.strip(), 'sha256': digest(tool)},
               'sourceHashes': source_hashes(), 'serial': True, 'cases': [], 'failed': []}
    dump(output / 'summary.json', summary)

    def case(name, action):
        row = {'case': name}
        try:
            row.update(action() or {})
            row['passed'] = True
        except Exception as error:
            row['passed'] = False
            row['error'] = f'{type(error).__name__}: {error}'
            summary['failed'].append(name)
        summary['cases'].append(row)
        dump(output / 'summary.json', summary)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    if args.suite in ('all', 'standalone'):
        probes = output / 'standalone'
        probes.mkdir()
        for source in (HERE / 'probes').glob('*.gd'):
            shutil.copyfile(source, probes / source.name)
        def standalone(name, script, mode=None):
            def run():
                argv = [str(tool), '--headless', '--verbose', '--path', str(probes), '--script', str(probes / script)]
                if mode is not None:
                    argv += ['--', mode]
                result, stdout, stderr = capture(argv, probes, env, probes / name, 20)
                expected = 23 if mode and mode.startswith('failed-') else 0
                assert result['exitCode'] == expected and not result['timedOut'], result
                assert not ERROR.search(stdout + '\n' + stderr), 'Unexpected engine or script error.'
                no_leaks(stdout, stderr)
                if script == 'probe.gd':
                    observed = frame(stdout, 'AUDIO_SHUTDOWN_PROBE:')
                    assert observed['mode'] == mode
                    if mode in ('never-play', 'observe-release'):
                        assert observed['after'] == [False, False], observed
                elif script == 'cycles.gd':
                    observed = frame(stdout, 'AUDIO_SHUTDOWN_CYCLES:')
                    assert observed['cycles'] == 32 and observed['objectsTracked'] == 64 and observed['remaining'] == 0, observed
                else:
                    observed = frame(stdout, 'AUDIO_SHUTDOWN_EDGE:')
                    assert observed['mode'] == mode and observed['exitCode'] == expected, observed
                    if mode == 'immediate-paused-quit':
                        assert observed['playerCount'] == 1 and observed['pausedCount'] == 1, observed
                    if mode == 'immediate-multiple-quit':
                        assert observed['playerCount'] == 8 and observed['extraPlaybacks'] == 7 and observed['extraStreams'] == 7, observed
                return {'exitCode': result['exitCode'], 'observation': observed, 'durationMs': result['durationMs']}
            return run
        for mode in MODES:
            for repeat in range(1, 4):
                name = f'{mode}-{repeat}'
                case(name, standalone(name, 'probe.gd', mode))
        for repeat in range(1, 4):
            name = f'cycles-{repeat}'
            case(name, standalone(name, 'cycles.gd'))
        for mode in EDGES:
            for repeat in range(1, 4):
                name = f'{mode}-{repeat}'
                case(name, standalone(name, 'shutdown-edges.gd', mode))

    if args.suite in ('all', 'projects'):
        project_dir = output / 'projects'
        project_dir.mkdir()
        for name, test_file, pattern in SUITES:
            def project(name=name, test_file=test_file, pattern=pattern):
                directory = project_dir / name
                directory.mkdir()
                invocation_dir = directory / 'godot-invocations'
                invocation_dir.mkdir()
                local_env = {**env, 'VIENTO_GODOT_BIN': str(HERE / 'godot-verbose.py'),
                             'VIENTO_CANDIDATE_GODOT_BIN': str(tool), 'VIENTO_PROBE_INVOCATIONS': str(invocation_dir),
                             'VIENTO_CAUSAL_ANCHORS_EVIDENCE': str(directory / 'evidence')}
                argv = ['node', '--test', '--test-concurrency=1', '--test-reporter=tap']
                if pattern:
                    argv += ['--test-name-pattern=' + pattern]
                argv.append(test_file)
                result, stdout, stderr = capture(argv, REPO, local_env, directory / 'tests', 900)
                checks = []
                invocations = sorted(invocation_dir.glob('*.json'))
                assert invocations, 'No native runtime invocation was captured.'
                for metadata in invocations:
                    info = json.loads(metadata.read_text())
                    native_stdout = metadata.with_suffix('.stdout.log').read_text()
                    native_stderr = metadata.with_suffix('.stderr.log').read_text()
                    try:
                        no_leaks(native_stdout, native_stderr)
                    except AssertionError as error:
                        checks.append(f'{metadata.name}: {error}')
                    # Nonzero exits are owned by existing negative test assertions.
                    info['leakFree'] = not bool(LEAK.search(native_stdout + '\n' + native_stderr))
                    dump(metadata, info)
                logs = list(invocation_dir.glob('*.stdout.log'))
                assert len(logs) == len(invocations), 'A runtime process did not complete its output capture.'
                assert not checks, '\n'.join(checks)
                assert result['exitCode'] == 0 and not result['timedOut'], result
                assert re.search(r'^# fail 0\s*$', stdout, re.M), 'Node did not report a clean completed test suite.'
                return {'nativeInvocations': len(invocations), 'durationMs': result['durationMs'], 'exitCode': result['exitCode']}
            case(name, project)

    summary['sourceHashesAfter'] = source_hashes()
    summary['sourcesUnchanged'] = summary['sourceHashes'] == summary['sourceHashesAfter']
    summary['toolUnchanged'] = summary['tool']['sha256'] == digest(tool)
    summary['passed'] = not summary['failed'] and summary['sourcesUnchanged'] and summary['toolUnchanged']
    dump(output / 'summary.json', summary)
    assert summary['sourcesUnchanged'], 'Test or product source files changed during validation.'
    assert summary['toolUnchanged'], 'The candidate binary changed during validation.'
    assert not summary['failed'], 'Failed cases: ' + ', '.join(summary['failed'])
    print(f'PASS: {len(summary["cases"])} serial validation groups; evidence: {output}', flush=True)


if __name__ == '__main__':
    main()
