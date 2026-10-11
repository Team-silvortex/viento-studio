#!/usr/bin/env python3
"""Read-only proof of the bounded atlas source-delivery update."""
import datetime
import argparse
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = pathlib.Path(__file__).resolve().parent
arguments = argparse.ArgumentParser()
arguments.add_argument('--output', default='atlas-delivery-check.json')
options = arguments.parse_args()
assert re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json', options.output), 'Output must be a single NEW release JSON filename'
output = EVIDENCE / options.output
assert output.parent.resolve() == EVIDENCE.resolve() and not output.is_symlink(), 'Output must remain inside this NEW release evidence directory'
assert not output.exists(), 'Preserve prior evidence; use a fresh output filename'
sha = lambda value: hashlib.sha256(value).hexdigest()
baseline = json.loads((EVIDENCE/'atlas-before-delivery.json').read_text())
current = json.loads((ROOT/'docs/function-atlas.json').read_text())
ledger = json.loads((EVIDENCE/'atlas-delivery.json').read_text())
assert ledger['beforeAtlasSha256'] == sha((EVIDENCE/'atlas-before-delivery.json').read_bytes())
assert current['meta']['version'] == '0.0.10'
assert current['meta']['commit'] == ledger['auditBaseCommit']
assert current['sourceSnapshot'] == baseline['sourceSnapshot'] or set(current['sourceSnapshot']) >= set(baseline['sourceSnapshot'])
for axis in baseline['axes']:
    assert [entry['id'] for entry in current['axes'][axis]] == [entry['id'] for entry in baseline['axes'][axis]], axis
for axis in ['architecture','implementation','maturity']:
    assert current['axes'][axis] == baseline['axes'][axis], axis
function_changes = {entry['function']:entry['fields'] for entry in ledger['activeBoundaryChanges']}
released = set(ledger['releasedFunctions'])
for before, after in zip(baseline['axes']['function'], current['axes']['function']):
    expected = {**before, **{key:entry['after'] for key,entry in function_changes.get(before['id'],{}).items()}}
    assert after == expected, before['id']
    assert (after['delivery'] == 'source-release') if before['id'] in released else after['delivery'] == before['delivery']
changes = {tuple(entry['coordinates']):entry for entry in ledger['deliveryCellChanges']}
assert len(changes) == 68
assert len(current['cells']) == len(baseline['cells'])
non_delivery = 0
for before, after in zip(baseline['cells'], current['cells']):
    key = tuple(before['coordinates']); assert after['coordinates'] == before['coordinates']
    if key in changes:
        assert before == changes[key]['before'] and after == changes[key]['after']
        assert before['value'] == 2 and after['value'] == 3 and key[-1] == 'delivery'
    else:
        assert before == after, key
    if key[-1] != 'delivery': non_delivery += 1
assert not any(entry['delivery'] == 'working-tree' for entry in current['axes']['function'])
assert not any(cell['value'] == 2 for cell in current['cells'] if cell['coordinates'][-1] == 'delivery')
assert current['evidence'] == baseline['evidence'] + ledger['appendedEvidence']
new_evidence = [entry['id'] for entry in ledger['appendedEvidence']]
assert len(current['bindings']) == len(baseline['bindings'])
for before, after in zip(baseline['bindings'], current['bindings']):
    assert after == {**before, 'evidence':before['evidence'] + (new_evidence if before['function'] in released else [])}
assert current['dependencies'] == baseline['dependencies']
assert current['legacyCoverage'] == baseline['legacyCoverage']
assert len(current['workflows']) == len(baseline['workflows'])
for before, after in zip(baseline['workflows'], current['workflows']):
    assert {key:value for key,value in before.items() if key != 'boundary'} == {key:value for key,value in after.items() if key != 'boundary'}
historical = set()
for entry in baseline['evidence']:
    if entry['path'].startswith('docs/test-results/'):
        historical.add(entry['path'])
for path in historical:
    assert sha((ROOT/path).read_bytes()) == baseline['sourceSnapshot'][path], path
report = {'format':'viento-atlas-source-release-adoption-check','schemaVersion':1,
    'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':True,'version':'0.0.10',
    'auditBaseCommit':ledger['auditBaseCommit'],'atlasSha256':sha((ROOT/'docs/function-atlas.json').read_bytes()),
    'ledgerSha256':sha((EVIDENCE/'atlas-delivery.json').read_bytes()),
    'counts':{'functions':len(current['axes']['function']),'implementations':len(current['axes']['implementation']),
        'bindings':len(current['bindings']),'cells':len(current['cells']),
        'releasedFunctions':len(released),'delivery2To3':len(changes),'nonDeliveryCellsExact':non_delivery,
        'oldEvidenceExact':len(baseline['evidence']),'appendedEvidence':len(ledger['appendedEvidence']),
        'oldReferencedHistoricalReportFilesExact':len(historical),'legacyChainsExact':len(current['legacyCoverage'])},
    'installedDeviceMaturityUnchanged':True,'sourceSnapshotPhase':'deferred' if current['sourceSnapshot']==baseline['sourceSnapshot'] else 'refreshed',
    'scope':'Only the approved source-delivery2→3 upgrade plus current boundary wording and appended release evidence; full release/commit/push verification is recorded separately by the host.',
    'findings':[]}
with output.open('x') as handle:
    handle.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':True,**report['counts'],'sourceSnapshotPhase':report['sourceSnapshotPhase']},indent=2))
