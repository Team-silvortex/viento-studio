#!/usr/bin/env python3
"""Read-only repository preservation audit; all outputs are confined to /tmp."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import hashlib
import json
import sys

ROOT=Path('/home/chiharukiryu/cdev/viento-studio')
BASE=Path('/tmp/viento-film-template-before')
OUTPUT=Path('/tmp/viento-film-template-preservation.json')
SUMMARY=Path('/tmp/viento-film-template-preservation-summary.json')

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def digest_bytes(content):
    return hashlib.sha256(content).hexdigest()

def digest_file(path):
    value=hashlib.sha256()
    with path.open('rb') as file:
        for part in iter(lambda:file.read(4*1024*1024), b''):
            value.update(part)
    return value.hexdigest()

baseline=read_json(BASE/'all-files.json')
missing=[]
changed=[]
observed={}
for name, before in baseline.items():
    path=ROOT/name
    if not path.is_file():
        missing.append(name)
        continue
    current=digest_file(path)
    observed[name]=current
    if current!=before:
        changed.append({'path':name,'beforeSha256':before,'afterSha256':current})

def file_group(names):
    names=sorted(names)
    group_missing=[name for name in names if name not in observed]
    group_changed=[name for name in names if name in observed and observed[name]!=baseline[name]]
    return {'files':len(names), 'preservedExactly':len(names)-len(group_missing)-len(group_changed),
            'ok':not group_missing and not group_changed, 'missing':group_missing, 'changed':group_changed,
            'hashes':{name:baseline[name] for name in names}}

groups={
    'oldEvidence':file_group(name for name in baseline if name.startswith('docs/test-results/')),
    'oldBackendGdAndText':file_group(name for name in baseline if name.startswith('scripts/backends/') and Path(name).suffix in ['.gd','.txt']),
    'examples':file_group(name for name in baseline if name.startswith('examples/')),
    'publishedReleaseDocuments':file_group(name for name in baseline if Path(name).name.startswith('RELEASE') and name.endswith('.md')),
    'history':file_group(name for name in baseline if name.startswith('docs/history/')),
    'oldMenuAuthorBaselineFiles':file_group(name for name in baseline if name.startswith('docs/test-results/project-menu/browser/author-final/')),
    'oldMenuZipArchives':file_group(name for name in baseline if name.startswith('docs/test-results/project-menu/') and name.endswith('.zip')),
}
expected_baseline_groups={'oldEvidence':14890,'oldBackendGdAndText':91,'examples':164}
for key,count in expected_baseline_groups.items():
    if groups[key]['files']!=count:
        raise ValueError(f'Unexpected baseline {key}: {groups[key]["files"]} != {count}')

# The original real-Chrome inventory is itself guarded by all-files.json and
# supplies the 18 asset/registration hashes omitted by the nonignored-file list.
menu_inventory_name='docs/test-results/project-menu/browser/evidence-inventory.json'
menu_inventory_unchanged=(menu_inventory_name in observed and observed[menu_inventory_name]==baseline[menu_inventory_name])
menu_inventory=read_json(ROOT/menu_inventory_name)
menu_prefix='docs/test-results/project-menu/browser/'
menu_expected={menu_prefix+name:expected for name,expected in menu_inventory['hashes'].items() if name.startswith('author-final/')}
menu_author_missing=[]
menu_author_changed=[]
for name,expected in menu_expected.items():
    path=ROOT/name
    if not path.is_file():
        menu_author_missing.append(name)
    elif digest_file(path)!=expected:
        menu_author_changed.append(name)
menu_actual={str(path.relative_to(ROOT)).replace('\\','/') for path in (ROOT/'docs/test-results/project-menu/browser/author-final').rglob('*') if path.is_file()}
menu_extra=sorted(menu_actual-set(menu_expected))
menu_author={'files':len(menu_expected),'actualFiles':len(menu_actual),'originalInventoryUnchanged':menu_inventory_unchanged,
            'ignoredAssetAndRegistrationFilesCovered':len(set(menu_expected)-set(baseline)),
            'ok':menu_inventory_unchanged and len(menu_expected)==104 and not menu_author_missing and not menu_author_changed and not menu_extra,
            'missing':menu_author_missing,'changed':menu_author_changed,'extra':menu_extra,'hashes':menu_expected}

before_catalog=read_json(BASE/'scripts/lib/project-templates.json')
current_catalog=read_json(ROOT/'scripts/lib/project-templates.json')
current_packs={pack['packageId']:pack for pack in current_catalog['templates']+current_catalog['compatibilityTemplates']}
old_packs=[]
for pack in before_catalog['templates']+before_catalog['compatibilityTemplates']:
    current=current_packs.get(pack['packageId'])
    old_packs.append({'packageId':pack['packageId'],'exactObjectPreserved':current==pack,
                      'beforeCanonicalSha256':digest_bytes(canonical(pack).encode()),
                      'afterCanonicalSha256':None if current is None else digest_bytes(canonical(current).encode())})
other_catalog_equal={key:value for key,value in before_catalog.items() if key!='templates'}=={key:value for key,value in current_catalog.items() if key!='templates'}
old_templates={'ok':all(item['exactObjectPreserved'] for item in old_packs) and other_catalog_equal,
               'oldPackages':old_packs,'catalogueMetadataAndCompatibilityTemplatesUnchanged':other_catalog_equal,
               'currentPackageIds':[pack['packageId'] for pack in current_catalog['templates']]}

before_atlas=read_json(BASE/'docs/function-atlas.json')
current_atlas=read_json(ROOT/'docs/function-atlas.json')
def array_preservation(old,new):
    a=Counter(canonical(item) for item in old)
    b=Counter(canonical(item) for item in new)
    lost=a-b
    added=b-a
    return {'oldObjects':len(old),'currentObjects':len(new),'preservedExactly':len(old)-sum(lost.values()),
            'addedObjects':sum(added.values()),'ok':not lost,
            'missingOrChangedObjects':[{'object':json.loads(item),'multiplicity':count} for item,count in lost.items()]}

atlas_arrays={}
for key in before_atlas['axes']:
    atlas_arrays['axes.'+key]=array_preservation(before_atlas['axes'][key],current_atlas['axes'].get(key,[]))
for key in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:
    atlas_arrays[key]=array_preservation(before_atlas[key],current_atlas.get(key,[]))
expected_before={'functions':202,'implementations':614,'bindings':829,'cells':3316,'evidence':3859,'dependencies':639,'workflows':167}
expected_now={'functions':203,'implementations':618,'bindings':833,'cells':3332,'dependencies':643,'workflows':168}
def atlas_counts(atlas):
    return {'functions':len(atlas['axes']['function']),'implementations':len(atlas['axes']['implementation']),
            **{key:len(atlas[key]) for key in ['bindings','cells','evidence','dependencies','workflows']}}
old_counts=atlas_counts(before_atlas)
new_counts=atlas_counts(current_atlas)
assert old_counts==expected_before,(old_counts,expected_before)
counts_ok=all(new_counts.get(key)==value for key,value in expected_now.items())
atlas={'ok':all(item['ok'] for item in atlas_arrays.values()) and counts_ok and current_atlas['schemaVersion']==before_atlas['schemaVersion'],
       'schemaVersionUnchanged':current_atlas['schemaVersion']==before_atlas['schemaVersion'],
       'permittedMutableFields':['meta','sourceSnapshot'],'oldCounts':old_counts,'currentCounts':new_counts,
       'expectedCurrentCountsSatisfied':counts_ok,'arrays':atlas_arrays,
       'baselineSha256':digest_file(BASE/'docs/function-atlas.json'),'currentSha256':digest_file(ROOT/'docs/function-atlas.json')}

ok=not missing and all(group['ok'] for group in groups.values()) and menu_author['ok'] and old_templates['ok'] and atlas['ok']
report={'format':'viento-film-template-preservation','schemaVersion':1,'ok':ok,
        'checkedAt':datetime.now(timezone.utc).isoformat(),'repository':str(ROOT),'baselineDirectory':str(BASE),
        'allBaselineFiles':{'files':len(baseline),'present':len(observed),'missing':missing,'noFilesLost':not missing,
                            'changedFiles':changed,'changedCount':len(changed),
                            'note':'Current entry documentation, the three new-template production sources, tests, atlas and generated atlas views are allowed to change. Immutable historical/sample groups are checked separately.'},
        'immutableGroups':groups,'oldMenuAuthor104':menu_author,'oldTemplatePackages':old_templates,'atlas':atlas,
        'limits':['Ignored menu assets and registrations are validated against the previously frozen real-Chrome inventory, whose own baseline hash is unchanged.',
                  'This is a preservation audit; it does not turn prior test receipts into fresh execution results.']}
summary={'format':'viento-film-template-preservation-summary','schemaVersion':1,'ok':ok,'checkedAt':report['checkedAt'],
         'baselineFiles':len(baseline),'baselineFilesPresent':len(observed),'baselineFilesLost':len(missing),
         'baselineFilesChanged':len(changed),'immutableGroups':{key:{k:v for k,v in group.items() if k not in ['hashes','missing','changed']} for key,group in groups.items()},
         'menuAuthorFiles':menu_author['files'],'menuAuthorUnchanged':menu_author['ok'],
         'menuIgnoredAssetAndRegistrationFilesCovered':menu_author['ignoredAssetAndRegistrationFilesCovered'],
         'oldTemplatePackages':len(old_packs),'oldTemplatePackagesUnchanged':old_templates['ok'],
         'atlasOldCounts':old_counts,'atlasCurrentCounts':new_counts,'atlasOldObjectsAndScoresPreserved':atlas['ok'],
         'report':str(OUTPUT),'script':'/tmp/viento-film-template-preservation.py'}
OUTPUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
SUMMARY.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
if not ok:
    sys.exit(1)
