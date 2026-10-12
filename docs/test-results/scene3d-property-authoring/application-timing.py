from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, re, subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
text = (OUT / 'app-check.log').read_text()
suite = {key: int(value) for key, value in re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)}
assert len(suite) == 6 and suite['tests'] == suite['pass'] and not any(suite[k] for k in ['fail', 'cancelled', 'skipped', 'todo'])
frozen = json.loads((OUT / 'source-hashes-confirmed.json').read_text())
for name, digest in frozen.items(): assert sha(ROOT / name) == digest, name
start = int(subprocess.check_output(['stat', '--format=%W', str(OUT / 'app-check.log')], text=True).strip())
report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
    'applicationLog': {'path': 'app-check.log', 'sha256': sha(OUT / 'app-check.log'),
        'fileCreatedAt': datetime.fromtimestamp(start, timezone.utc).isoformat(),
        'lastWrittenAt': datetime.fromtimestamp((OUT / 'app-check.log').stat().st_mtime, timezone.utc).isoformat()},
    'completedApplication': suite, 'syntaxFiles': int(re.search(r'语法检查通过：(\d+)', text).group(1)),
    'sourceFreeze': {'path': 'source-hashes-confirmed.json', 'files': len(frozen), 'sha256': sha(OUT / 'source-hashes-confirmed.json'), 'allMatch': True},
    'scope': 'Full application invocation began after final product/test and browser source freeze. First full run had 3330 tests/3329 pass, with an outdated environment test global registry count11/cap27. Corrected only those assertions to12/28, keeping its actual initialized11 assertion (property port absent). Original full log and718 source/copy proofs retained; source-hashes-confirmed records the sole subsequent test expectation change. No product, UI, translation or author semantic code changed. Confirmed full run began after the updated source freeze. Prepared initial harness expected a conflict for an invalid space-suffixed path; corrected only this NEW evidence script to use a different canonical path. Both initial script/log and passing final proof retained. Final syntax count includes the new property smoke harness. No repeat semantic suite required for subsequent documentation/current atlas metadata.',
    'overlap': 'Shared-core259, new bridge20, Rust234, UI155, host/system12 and pure/registry52 are separate or overlapping scopes and are not added to application3330.'}
with (OUT / 'application-timing.json').open('x') as f: f.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'application': suite, 'syntax': report['syntaxFiles']}))
