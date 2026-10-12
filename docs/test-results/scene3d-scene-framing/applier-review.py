from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from datetime import datetime, timezone
import hashlib, json, os, stat, types

OUT = Path(__file__).resolve().parent
APPLIER = Path('/tmp/viento-scene3d-framing-xmbbbvr9/control/apply-reviewed-framing.py')
module = types.ModuleType('owned_applier_fixture')
exec(compile(APPLIER.read_text(), str(APPLIER), 'exec'), module.__dict__)
sha = lambda b: hashlib.sha256(b).hexdigest()
results = []


def write(root, rel, data):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def snapshots(root):
    return {str(p.relative_to(root)): (p.read_bytes(), stat.S_IMODE(p.stat().st_mode))
            for p in root.rglob('*') if p.is_file()}


class Fixture:
    def __init__(self, parent):
        self.root, self.actual, self.stage = parent, parent / 'actual', parent / 'stage'
        self.actual.mkdir(); self.stage.mkdir()
        (self.actual / 'docs/test-results').mkdir(parents=True)
        self.implementation = [f'web/mod{i}.js' for i in range(8)] + [f'scripts/fresh/mod{i}.js' for i in range(8, 16)]
        write(self.actual, 'VERSION', b'0.0.10\n'); write(self.actual, 'LICENSE', b'unrelated original\n')
        for i, rel in enumerate(self.implementation):
            if i < 8:
                write(self.actual, rel, f'old {i}\n'.encode())
            write(self.stage, rel, f'reviewed {i}\n'.encode())
        os.chmod(self.actual / self.implementation[0], 0o751)
        self.report = module.OUT_REL + '/browser/proof.json'
        for rel in [self.report, module.OUT_REL + '/result.json']:
            write(self.stage, rel, b'{"owned-fixture":true}\n')
        self.before = snapshots(self.actual)
        self.baseline = {r: sha(b) for r, (b, _) in self.before.items()}
        self.baseline_path = parent / 'baseline.json'
        self.baseline_path.write_text(json.dumps(self.baseline))
        files = self.implementation + [self.report, module.OUT_REL + '/result.json']
        self.packet = {'actual': str(self.actual), 'stage': str(self.stage),
            'baselineSha256': sha(self.baseline_path.read_bytes()), 'implementationFiles': self.implementation,
            'files': {r: {'before': self.baseline.get(r), 'after': sha((self.stage / r).read_bytes())} for r in files}}
        self.packet_path = parent / 'packet.json'
        self.save_packet()

    def save_packet(self):
        self.packet_path.write_text(json.dumps(self.packet, indent=2))
        self.approval = sha(self.packet_path.read_bytes())

    def run(self):
        return module.apply_reviewed(actual=self.actual, stage=self.stage, packet_path=self.packet_path,
            approved_sha=self.approval, baseline_path=self.baseline_path, backup=self.root / 'backup',
            expected_implementation_count=16)

    def unchanged(self):
        assert snapshots(self.actual) == self.before
        assert not (self.actual / module.OUT_REL).exists()
        assert not (self.actual / 'scripts').exists()
        assert not list(self.actual.rglob('.framing-*'))


def case(name, fn):
    try:
        with TemporaryDirectory(prefix='framing-applier-owned-') as temporary:
            fn(Fixture(Path(temporary)))
        results.append({'name': name, 'ok': True})
        print('PASS', name, flush=True)
    except BaseException as error:
        results.append({'name': name, 'ok': False, 'error': f'{type(error).__name__}: {error}'})
        print('FAIL', name, type(error).__name__, str(error), flush=True)


def expect_error(fn, error_type=AssertionError, contains=None):
    try:
        fn()
    except error_type as error:
        if contains is not None:
            assert contains in str(error), str(error)
        return
    raise AssertionError('expected failure was not raised')


def success(f):
    result = f.run(); assert result['ok'] and result['implementationFiles'] == 16
    for rel, entry in f.packet['files'].items():
        assert sha((f.actual / rel).read_bytes()) == entry['after']
    assert (f.actual / 'VERSION').read_bytes() == f.before['VERSION'][0]
    assert (f.actual / 'LICENSE').read_bytes() == f.before['LICENSE'][0]
    assert stat.S_IMODE((f.actual / f.implementation[0]).stat().st_mode) == 0o751
    assert (f.actual / (module.OUT_REL + '/apply-packet.json')).read_bytes() == f.packet_path.read_bytes()
    receipt = json.loads((f.actual / (module.OUT_REL + '/apply-receipt.json')).read_text())
    assert receipt['ok'] and receipt['packetSha256'] == f.approval
    assert not list(f.actual.rglob('.framing-*'))
case('successful packet writes exactly approved bytes and preserves existing permissions/unrelated files', success)


def stage_mismatch(f):
    write(f.stage, f.implementation[0], b'unreviewed bytes\n')
    expect_error(f.run, contains='stage changed:'); f.unchanged()
case('actual loaded payload SHA mismatch rejects before any target mutation', stage_mismatch)


def payload_snapshot(f):
    target = f.stage / f.implementation[0]; original = Path.read_bytes; fired = False
    def read(p):
        nonlocal fired
        data = original(p)
        if p == target and not fired:
            fired = True; p.write_bytes(b'late unreviewed stage edit\n')
        return data
    with patch.object(Path, 'read_bytes', read):
        assert f.run()['ok']
    assert (f.actual / f.implementation[0]).read_bytes() == b'reviewed 0\n'
    assert target.read_bytes() == b'late unreviewed stage edit\n'
case('stage mutation after snapshot cannot replace the approved in-memory payload', payload_snapshot)


def original_mismatch(f):
    target = f.actual / f.implementation[0]; original = Path.read_bytes; reads = 0
    def read(p):
        nonlocal reads
        data = original(p)
        if p == target:
            reads += 1
            if reads == 1:
                p.write_bytes(b'external concurrent original edit\n')
        return data
    with patch.object(Path, 'read_bytes', read):
        expect_error(f.run, contains='checkout changed:')
    assert target.read_bytes() == b'external concurrent original edit\n'
    assert not (f.actual / module.OUT_REL).exists()
    assert not (f.actual / 'scripts').exists()
case('original byte snapshot mismatch preserves the newer writer content and rejects apply', original_mismatch)


def fault_after(f, rel, error_type):
    replace = os.replace; fired = False
    def injected(src, dst):
        nonlocal fired
        replace(src, dst)
        if Path(dst) == f.actual / rel and not fired:
            fired = True; raise error_type('injected after atomic replace')
    with patch.object(module.os, 'replace', injected):
        expect_error(f.run, error_type, 'injected after atomic replace')
    f.unchanged()
case('exception immediately after a committed report replacement rolls every file and created directory back',
     lambda f: fault_after(f, f.report, RuntimeError))
case('KeyboardInterrupt immediately after os.replace cannot omit the current file from rollback',
     lambda f: fault_after(f, f.implementation[0], KeyboardInterrupt))
case('receipt commit failure belongs to the same rollback journal and leaves no report directory',
     lambda f: fault_after(f, module.OUT_REL + '/apply-receipt.json', RuntimeError))


def fault_before(f):
    replace = os.replace
    def injected(src, dst):
        if Path(dst) == f.actual / 'scripts/fresh/mod8.js':
            raise OSError('injected before replace')
        replace(src, dst)
    with patch.object(module.os, 'replace', injected):
        expect_error(f.run, OSError, 'injected before replace')
    f.unchanged()
case('attempted missing target rollback tolerates absent files and removes newly created source directories', fault_before)


def retry(f):
    fault_after(f, f.report, RuntimeError)
    assert f.run()['ok']
case('a completely rolled back failure can immediately retry the same approved packet', retry)


def rollback_best_effort(f):
    replace = os.replace; failed = False
    bad = f.actual / f.implementation[0]
    def injected(src, dst):
        nonlocal failed
        if failed and Path(dst) == bad:
            raise OSError('injected restore failure')
        replace(src, dst)
        if Path(dst) == f.actual / f.report and not failed:
            failed = True; raise RuntimeError('injected apply failure')
    with patch.object(module.os, 'replace', injected):
        expect_error(f.run, RuntimeError, 'rollback incomplete:')
    now = snapshots(f.actual)
    for rel, old in f.before.items():
        if rel != f.implementation[0]: assert now[rel] == old
    assert (f.actual / f.implementation[0]).read_bytes() == b'reviewed 0\n'
    assert not (f.actual / module.OUT_REL).exists()
    assert not (f.actual / 'scripts').exists()
case('one restore error is reported explicitly while remaining journal entries still roll back', rollback_best_effort)


def unrelated_edit(f):
    replace = os.replace; fired = False
    def injected(src, dst):
        nonlocal fired
        replace(src, dst)
        if Path(dst) == f.actual / f.implementation[0] and not fired:
            fired = True; (f.actual / 'LICENSE').write_bytes(b'external unrelated edit\n')
    with patch.object(module.os, 'replace', injected):
        expect_error(f.run, contains='unrelated source changed:')
    assert (f.actual / 'LICENSE').read_bytes() == b'external unrelated edit\n'
    now = snapshots(f.actual)
    for rel, old in f.before.items():
        if rel != 'LICENSE': assert now[rel] == old
    assert not (f.actual / module.OUT_REL).exists()
case('post-apply baseline guard rolls owned changes back without deleting an unrelated external edit', unrelated_edit)


def bad_approval(f):
    f.approval = '0' * 64
    expect_error(f.run, contains='packet changed'); f.unchanged()
case('a mismatched approval SHA authorizes no target writes', bad_approval)


def symlink(f):
    target = f.stage / f.implementation[0]; target.unlink()
    other = f.root / 'untrusted.js'; other.write_bytes(b'reviewed 0\n'); target.symlink_to(other)
    expect_error(f.run, contains='symlink:'); f.unchanged()
case('symlink payload paths fail before any actual fixture write', symlink)

assert len(results) == 13
report = {'ok': all(row['ok'] for row in results), 'observedAt': datetime.now(timezone.utc).isoformat(),
    'passed': sum(row['ok'] for row in results), 'failed': sum(not row['ok'] for row in results),
    'cases': results, 'applierPath': str(APPLIER), 'applierSha256': sha(APPLIER.read_bytes()),
    'scope': 'Only the parameterized function was imported in memory and called against owned TemporaryDirectory toy roots. Formal main/real CLI was never executed. No actual checkout was read or written, no product/prepare-packet change.',
    'formalCli': {'fixedActual': '/home/chiharukiryu/cdev/viento-studio',
        'fixedStage': '/tmp/viento-scene3d-framing-xmbbbvr9/project', 'onlyArgument': 'approved packet SHA256',
        'implementationCountRemains16': True},
    'changes': ['Load and verify the retained payload and original byte snapshots.',
        'Journal targets before replacement and receipt mutation.',
        'Register new directories before mkdir and remove owned empty directories during rollback.',
        'Use missing_ok deletion for attempted but uncreated targets.',
        'Continue all rollback attempts and report incomplete recovery explicitly.',
        'Check current original SHA again immediately before each journaled write and verify the receipt.'],
    'limits': ['Exception and KeyboardInterrupt recovery is verified; SIGKILL, power loss and concurrent external-writer isolation are not transactional guarantees.',
        'Rollback never recursively deletes nonempty directories; a genuine restore failure is surfaced instead of reported as successful.']}
(OUT / 'applier-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': report['ok'], 'passed': report['passed'], 'failed': report['failed'], 'applierSha256': report['applierSha256']}))
raise SystemExit(0 if report['ok'] else 1)
