"""Verify the placement-offset slice and remove only initially absent build directories.
No author workspace, installed app, dependency, external tool or release is changed.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib,json,os,re,shutil,stat,subprocess
R=Path(__file__).resolve().parents[3]; D=Path(__file__).resolve().parent

def read(n): return json.loads((D/n).read_text())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
def save(n,v):
    with (D/n).open('x') as f: json.dump(v,f,ensure_ascii=False,indent=2);f.write('\n')
def preserved(n):
    values=read(n); errors=[p for p,h in values.items() if sha(R/p)!=h]; assert not errors,(n,errors)
    return {'baseline':n,'files':len(values),'unchanged':len(values),'mismatches':errors}
def facts(n):
    s=(D/n).read_text(); result={k:int(re.findall(r'^[ℹ#] '+k+r' (\d+)$',s,re.M)[-1]) for k in ('tests','pass','fail','cancelled','skipped','todo')}
    result['durationMs']=float(re.findall(r'^[ℹ#] duration_ms ([\d.]+)$',s,re.M)[-1]);assert result['pass']==result['tests'] and not any(result[k] for k in ('fail','cancelled','skipped','todo'))
    return result,s
initial=read('initial-state.json'); head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()
assert head==initial['head'] and (R/'VERSION').read_text().strip()==initial['version']=='0.0.9'
app,log=facts('app-check.log'); focus,_=facts('focused-tests.log'); core,_=facts('core-focus.log')
assert 'API 契约预检通过' in log and '版本一致性检查通过：0.0.9（构建 0.0.9）' in log
javascript=int(re.findall(r'语法检查通过：(\d+) 个 JavaScript 文件',log)[-1])
rust=(D/'core-native-test.log').read_text(); rust_count=sum(map(int,re.findall(r'test result: ok\. (\d+) passed;',rust))); assert rust_count>110 and not re.search(r'test result: FAILED|[1-9]\d* failed;',rust)
for n in ['core-fmt.log','core-clippy.log','core-native-build.log','core-wasm-build.log','native-helpers-build.log','desktop-prepare-final.log','mobile-prepare.log']: assert (D/n).is_file()
browser=read('browser/browser.json'); assert browser['ok'] and len(browser['steps'])==5 and not browser['errors'] and not browser['svgRequests']
assert set(browser['layout'])=={'zh-CN','en','ja'} and all(all(m.values()) for m in browser['layout'].values())
assert browser['normalSave']['externalConflictPreserved']
legacy={}
for name,steps in [('inheritance-regression',6),('batch-regression',5)]:
    b=read(name+'/browser.json'); assert b['ok'] and len(b['steps'])==steps and not b['errors'] and not b['svgRequests'];legacy[name]={'steps':steps,'evidence':name+'/browser.json','runtimeExceptions':0}
p=read('packaged-resources.json');assert p['ok'] and p['version']=='0.0.9' and p['embeddedNode']['version']=='v24.20.0' and p['sourceAndPreparedManifestsStableDuringAcceptance'];assert sha(D/'prepared-check.mjs')==p['proofSourceSha256']
review=read('boundary-review.json');assert review['ok'] and review['findings']==[]
for path,item in review['reviewedSources'].items(): assert sha(R/path)==item['sha256']
for n in ['boundary-probe.json','boundary-receipt-probe.json']: assert read(n)['ok']
helpers=read('native-helpers.json')
for item in helpers['binaries']:
    file=Path(item['path']);assert file.stat().st_size==item['bytes'] and sha(file)==item['sha256']
build=json.loads((R/'engine/studio-core.build.json').read_text());assert sha(R/'engine/studio-core.wasm')==build['wasmSha256']
for path,h in build['sources'].items(): assert sha(R/('scripts/build-studio-core.mjs' if path=='build-script' else 'crates/viento-studio-core/'+path))==h
preservation={'ok':True,'recordedAt':datetime.now(timezone.utc).isoformat(),'historical':preserved('historical-baseline.json'),'frozenGodotBackend':preserved('frozen-backend-baseline.json'),'protectedSceneSlices':preserved('protected-scene-slices.json'),'currentSources':preserved('source-hashes.json')}
save('historical-preservation.json',preservation)
generated=initial['generated']; assert len(generated)==8 and not any(generated.values())
assert not (R/'crates/viento-studio-core/target').exists()
tools=json.loads((D.parent/'release-0.0.9/cleanup.json').read_text())['retainedTools']
for item in tools:
    file=Path(item['path']); assert file.stat().st_size==item['bytes'] and sha(file)==item['sha256']
for name in generated:
    target=R/name;assert target.is_dir() and stat.S_ISDIR(target.lstat().st_mode)
seen=set(); entries=[]
for name in generated:
    target=R/name; allocated=logical=count=0
    for directory,dirs,files in os.walk(target,followlinks=False):
        for file in [Path(directory),*(Path(directory)/x for x in files),*(Path(directory)/x for x in dirs if (Path(directory)/x).is_symlink())]:
            m=file.lstat();inode=(m.st_dev,m.st_ino)
            if inode not in seen:seen.add(inode);allocated+=m.st_blocks*512
            if stat.S_ISREG(m.st_mode):logical+=m.st_size;count+=1
    shutil.rmtree(target);assert not target.exists();entries.append({'path':name,'existedBefore':False,'allocatedBytes':allocated,'logicalFileBytes':logical,'fileCount':count,'removed':True})
freed=sum(e['allocatedBytes'] for e in entries)
cleanup={'ok':True,'recordedAt':datetime.now(timezone.utc).isoformat(),'scope':'Only eight exact initially absent generated directories. Shared WASM, dependencies, external tools, user works/settings and installations retained.','removedDirectories':len(entries),'allocatedBytesFreed':freed,'allocatedGiBFreed':round(freed/1024**3,3),'entries':entries,'retainedTools':tools,'sharedRebuiltWasmRetained':True}
save('cleanup.json',cleanup)
new_tests=read('new-test-counts.json')
results={'ok':True,'date':'2026-10-11','recordedAt':datetime.now(timezone.utc).isoformat(),'sourceVersion':'0.0.9','baseCommit':head,'delivery':'unreleased-working-tree',
'scope':'One existing recipe placement offset SET/removal, complete actor/group provenance and full dependency review, source draft application and ordinary Save.',
'feature':{'function':'scene.composition_placement_editor','optionalCapability':1,'operation':'sceneComposition.editPlacementOffset','offsetPairSetOrNullDelete':True,'absentAndExplicitZeroRemainDistinctAuthorIntent':True,'offsetAppliedAfterLocalPositionOverride':True,'everyActorInPlacementMoves':True,'organizationGroupsAreNotSpatialTransforms':True,'allOriginalAndFinalPlacementsValidated':True,'templatesOverridesStableIdsUnrelatedBytesRetained':True,'noGeometrySession':True,'noImplicitSave':True},
'application':{**app,'log':'app-check.log','node':'24.20.0 (pinned embedded)','javascriptFiles':javascript,'apiContract':'passed','versionPreflight':'0.0.9','actualGodotAndBevyRegression':True,'freshNativeHelpers':True},
'focused':{**focus,'log':'focused-tests.log','includedInApplicationCount':True,'newTests':new_tests,'coreFocused':{**core,'log':'core-focus.log','overlapsApplicationAndFocused':True}},
'rust':{'passed':rust_count,'log':'core-native-test.log','fmt':'core-fmt.log','clippyDenyWarnings':'core-clippy.log','freshNativeCli':'core-native-build.log','freshWasm':'core-wasm-build.log','wasmBytes':build['bytes'],'wasmSha256':build['wasmSha256']},
'browser':{'evidence':'browser/browser.json','browser':browser['browser'],'steps':len(browser['steps']),'runtimeExceptions':0,'layout':browser['layout'],'normalSave':browser['normalSave'],'screenshotsVisuallyInspected':['placement-narrow-zh-CN.png','placement-narrow-en.png','placement-narrow-ja.png','placement-reviewed.png'],'visualScope':'Visible portions only; full candidate asserted by script. Actual Chrome HTTP editor with disposable registered projection and images; no installed window or device.'},
'oldBrowserRegressions':legacy,'preparedResources':{'evidence':'packaged-resources.json','counts':p['counts'],'scope':p['scope'],'embeddedNode':p['embeddedNode'],'mobileChecks':p['mobileChecks']},
'boundaryReview':{'evidence':'boundary-review.json','probe':'boundary-probe.json','receiptAndCapabilityProbe':'boundary-receipt-probe.json','findings':review['findings'],'verdict':review['verdict']},'sourceHashes':'source-hashes.json','preservation':'historical-preservation.json','nativeHelperBytes':'native-helpers.json','cleanup':'cleanup.json',
'initialAttempts':[
{'log':'core-native-test-initial.log','cause':'New token-deletion fixture placed the reset member inside actorIds; only fixture corrected.'},
{'log':'ui-tests-initial.log','cause':'New asynchronous late-open fixture rejected a deferred digest before its consumer was ready; only fixture synchronization corrected.'},
{'log':'browser-initial.log','evidence':'browser-initial/browser.json','cause':'New smoke assumed groups at the preview top level. Actual v2 groups are sceneStructure.groups; the new parent validation and new test fixture were corrected.'},
{'log':'browser-second.log','evidence':'browser-second/browser.json','cause':'New browser script called a nonexistent language setter; changed the fixture to the existing applyLanguage API.'},
{'log':'boundary-probe-initial.log','cause':'New proof assumed tab indentation; changed its expectation to extract original pair bytes rather than assume formatting.'},
{'log':'batch-regression.log','evidence':'batch-evidence-relocation.json','cause':'Successful old browser regression initially used the wrong output environment variable; report files relocated byte-for-byte from its owned temporary directory, original conditions retained.'}],
'limitations':['No version bump, commit, push, installer, installed Tauri window or Android device acceptance.','No actor/group structure edits, scale/hierarchy transforms, executable recipe build, cross-file transaction or cross-view undo.','Mobile prepared ESM/WASM portability is not device or security sandbox acceptance.','Focused/new/core counts overlap application tests.']}
save('results.json',results)
print(json.dumps({'ok':True,'applicationPassed':app['pass'],'focusedPassed':focus['pass'],'rustPassed':rust_count,'newTests':new_tests,'preparedCounts':p['counts'],'historicalFiles':preservation['historical']['files'],'protectedFiles':preservation['protectedSceneSlices']['files'],'sourceFiles':preservation['currentSources']['files'],'allocatedGiBFreed':cleanup['allocatedGiBFreed']},ensure_ascii=False))
