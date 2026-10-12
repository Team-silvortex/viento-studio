from pathlib import Path, PurePosixPath
import datetime, errno, hashlib, json, os, stat, sys, tempfile

OUT_REL = 'docs/test-results/scene3d-scene-framing'
GENERATED = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']
sha = lambda data: hashlib.sha256(data).hexdigest()


def safe(root, rel):
    path = PurePosixPath(rel)
    assert not path.is_absolute() and '..' not in path.parts and str(path) == rel
    target = root
    assert not root.is_symlink() and root.resolve() == root
    for part in path.parts:
        target = target / part
        assert not target.is_symlink(), f'symlink: {target}'
    if target.exists():
        assert target.is_file(), f'not regular file: {target}'
    return target


def read_snapshot(root, rel):
    target = safe(root, rel)
    if not target.exists():
        return None, None
    data = target.read_bytes()
    return data, stat.S_IMODE(target.stat().st_mode)


def digest(root, rel):
    data, _ = read_snapshot(root, rel)
    return sha(data) if data is not None else None


def apply_reviewed(*, actual, stage, packet_path, approved_sha, baseline_path, backup,
                   expected_implementation_count=16):
    """Apply one approved byte snapshot. Parameters allow owned toy fixtures;
    the normal command below always fixes the real paths and accepts only SHA.
    """
    packet_bytes = packet_path.read_bytes()
    assert sha(packet_bytes) == approved_sha, 'packet changed'
    packet = json.loads(packet_bytes)
    assert packet['actual'] == str(actual) and packet['stage'] == str(stage)
    baseline_bytes = baseline_path.read_bytes()
    assert sha(baseline_bytes) == packet['baselineSha256'], 'baseline changed'
    baseline = json.loads(baseline_bytes)
    assert not (actual / OUT_REL).exists(), 'new report directory already exists'
    assert all(not (actual / rel).exists() for rel in GENERATED)
    for rel, expected in baseline.items():
        assert digest(actual, rel) == expected, f'current checkout changed: {rel}'
    files = packet['files']
    allowed = set(packet['implementationFiles'])
    assert len(allowed) == expected_implementation_count
    assert all(rel in allowed or rel.startswith(OUT_REL + '/') for rel in files)
    assert allowed <= set(files)
    packet_rel, receipt_rel = OUT_REL + '/apply-packet.json', OUT_REL + '/apply-receipt.json'
    assert packet_rel not in files and receipt_rel not in files, 'reserved apply records in packet'

    # Verify the bytes actually retained for writing, not a prior independent
    # read. A later stage edit cannot change this approved in-memory snapshot.
    payloads, originals, original_modes = {}, {}, {}
    for rel, entry in files.items():
        data, _ = read_snapshot(stage, rel)
        assert data is not None and sha(data) == entry['after'], f'stage changed: {rel}'
        old, mode = read_snapshot(actual, rel)
        expected_before = baseline.get(rel)
        assert entry['before'] == expected_before, f'packet baseline mismatch: {rel}'
        assert (sha(old) if old is not None else None) == expected_before, f'checkout changed: {rel}'
        payloads[rel], originals[rel], original_modes[rel] = data, old, mode
    payloads[packet_rel], originals[packet_rel], original_modes[packet_rel] = packet_bytes, None, None
    originals[receipt_rel], original_modes[receipt_rel] = None, None
    for rel, data in originals.items():
        if data is not None:
            target = safe(backup, rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                assert sha(target.read_bytes()) == sha(data), f'backup changed: {rel}'
            else:
                target.write_bytes(data)

    created_dirs, journal, written = [], [], []

    def replace(rel, data, mode):
        target = safe(actual, rel)
        parent = actual
        for part in PurePosixPath(rel).parts[:-1]:
            parent = parent / part
            assert not parent.is_symlink(), f'symlink: {parent}'
            if not parent.exists():
                # Register before mkdir too, so an interruption just after
                # creation cannot strand a new directory and block a retry.
                created_dirs.append(parent)
                parent.mkdir()
            assert parent.is_dir(), f'not directory: {parent}'
        fd, temp = tempfile.mkstemp(prefix='.framing-', dir=target.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temp, mode if mode is not None else 0o644)
            os.replace(temp, target)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    def write_journaled(rel, data):
        expected = sha(originals[rel]) if originals[rel] is not None else None
        assert digest(actual, rel) == expected, f'checkout changed before write: {rel}'
        # The ledger precedes every mutation. Even an exception/interruption
        # immediately after os.replace must restore this particular target.
        journal.append(rel)
        replace(rel, data, original_modes[rel])
        written.append(rel)

    try:
        for rel, data in payloads.items():
            write_journaled(rel, data)
        for rel, data in payloads.items():
            assert digest(actual, rel) == sha(data), f'written mismatch: {rel}'
        for rel, expected in baseline.items():
            assert digest(actual, rel) == files.get(rel, {}).get('after', expected), f'unrelated source changed: {rel}'
        assert all(not (actual / rel).exists() for rel in GENERATED)
        result = {'ok': True, 'appliedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'actual': str(actual), 'packetSha256': sha(packet_bytes), 'implementationFiles': len(allowed),
                  'packetFiles': len(files), 'writtenFilesIncludingPacket': len(written),
                  'baselineFilesChecked': len(baseline), 'unrelatedBaselineUnchanged': True,
                  'generatedDirectoriesAbsent': GENERATED, 'version': (actual / 'VERSION').read_text().strip()}
        receipt_bytes = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode()
        write_journaled(receipt_rel, receipt_bytes)
        assert digest(actual, receipt_rel) == sha(receipt_bytes), 'receipt mismatch'
    except BaseException as failure:
        rollback_errors = []
        for rel in reversed(journal):
            try:
                if originals[rel] is None:
                    safe(actual, rel).unlink(missing_ok=True)
                else:
                    replace(rel, originals[rel], original_modes[rel])
            except BaseException as error:
                rollback_errors.append(f'{rel}: {type(error).__name__}: {error}')
        for directory in reversed(created_dirs):
            try:
                if directory.is_symlink():
                    raise RuntimeError(f'new directory replaced by symlink: {directory}')
                if directory.exists():
                    directory.rmdir()
            except OSError as error:
                # Never remove a nonempty directory, including contents owned
                # by a concurrent writer or a file whose restore failed.
                if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
                    rollback_errors.append(f'{directory}: {type(error).__name__}: {error}')
            except BaseException as error:
                rollback_errors.append(f'{directory}: {type(error).__name__}: {error}')
        if rollback_errors:
            raise RuntimeError('Apply failed; rollback incomplete: ' + '; '.join(rollback_errors)) from failure
        raise
    return result


def main():
    # No path, allowlist or test injection is accepted on the formal CLI.
    assert len(sys.argv) == 2, 'one approved packet SHA256 is required'
    base = Path('/tmp/viento-scene3d-framing-xmbbbvr9')
    result = apply_reviewed(actual=Path('/home/chiharukiryu/cdev/viento-studio'),
        stage=base / 'project', packet_path=base / 'control/packet.json', approved_sha=sys.argv[1],
        baseline_path=base / 'control/baseline.json', backup=base / 'backup')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
