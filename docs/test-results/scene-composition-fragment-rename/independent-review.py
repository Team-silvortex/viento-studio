import hashlib,json,re,subprocess
from datetime import datetime,timezone
from pathlib import Path
root=Path('/home/chiharukiryu/cdev/viento-studio')
r=root/'docs/test-results/scene-composition-fragment-rename'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(name):return json.loads((r/name).read_text())
def verify_map(name):
    m=read(name)
    for n,h in m.items():assert sha(root/n)==h,(name,n)
    return {'files':len(m),'manifestSha256':sha(r/name),'allMatch':True}
baseline=read('baseline.json');frozen=read('source-hashes.json');old=read('source-baseline.json')
freeze=verify_map('source-hashes.json');assert freeze['files']==656
historical=verify_map('historical-baseline.json');assert historical['files']==3341
actual_history={str(p.relative_to(root)) for p in (root/'docs/test-results').rglob('*') if p.is_file() and not p.is_relative_to(r)}
assert actual_history==set(read('historical-baseline.json'))
author=verify_map('author-baseline.json');assert author['files']==39
for n,e in read('tool-baseline.json').items():
    p=Path(n);s=p.stat();assert s.st_size==e['bytes'] and s.st_dev==e['dev'] and s.st_ino==e['ino'] and sha(p)==e['sha256'],n
tools={'files':4,'manifestSha256':sha(r/'tool-baseline.json'),'bytesAndPhysicalIdentitiesMatch':True}
changed=[n for n in old if old[n]!=frozen[n]];added=[n for n in frozen if n not in old]
assert len(changed)==9 and len(added)==6
assert all(old[n]==frozen[n] for n in old if n.startswith('scripts/tests/'))
assert all(old[n]==frozen[n] for n in old if n.startswith('crates/viento-studio-core/src/') and n!='crates/viento-studio-core/src/lib.rs')
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip();assert head==baseline['head'];assert (root/'VERSION').read_text().strip()==baseline['version']
b=read('browser-final/browser.json');assert b['ok'] and len(b['steps'])==9 and b['sourceStableDuringProof'] and len(b['sources'])==22
for n,h in b['sources'].items():assert h==frozen[n] and h==sha(root/n),n
assert b['node']['version']=='v24.20.0' and b['node']['sha256']==sha(root/'src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu')
assert not b['errors'] and not b['svgRequests']
assert b['httpSummary']=={'postCaptures':69,'successful':67,'semanticRejections':0,'savedReadConflicts':2}
assert len(b['capturePhases'])==4
for p in b['capturePhases']:
    for item in p['captures']:
        assert item['status']==200 and item['payload']['ok'] or item['status']==409 and item['payload']['errorCode']=='world_read_conflict' and not item['request'].get('draft')
assert len(b['authorFiles']['before'])==22 and set(b['authorFiles']['before'])==set(b['authorFiles']['after'])
assert [n for n,h in b['authorFiles']['before'].items() if h!=b['authorFiles']['after'][n]]==[b['normalSave']['onlyChangedFile']]
assert b['confirmationDecisions'][0]=={'type':'confirm','accepted':False} and b['confirmationDecisions'][1]=={'type':'confirm','accepted':True}
assert b['keyboardTrace'][0]['kind']=='cancel' and b['keyboardTrace'][0]['cancelable'] and b['keyboardTrace'][0]['isTrusted']
for name in ['browser-initial','browser-second','browser-third']:
    p=read(name+'/browser.json');assert not p['ok'] and 'declining keyboard discard' in p['failure']
t=read('browser-third/browser.json');assert t['pageFailure']['dialogTrace'][0]['cancelable'] is False and t['confirmationDecisions'][0]['accepted'] is False
p=read('browser-fourth/browser.json');assert not p['ok'] and len(p['steps'])==5 and 'SyntaxError' in p['failure']
core=read('core-results.json');assert core['verification']['rust']['total']==172 and core['verification']['newJavaScript']['total']==22 and core['verification']['oldAndNewRegression']['passed']==290
for n,h in core['sourceHashes'].items():assert h==frozen[n]
extra=read('core-independent-audit.json');assert extra['blockingFindings']==0 and not extra['findings'] and extra['probe']['groups']==6 and extra['probe']['failed']==0
native=read('reviewer-native-provenance.json');assert len(native['binaries'])==4
for p in native['binaries']:assert (root/p['path']).stat().st_size==p['bytes'] and sha(root/p['path'])==p['sha256']
pack=read('packaged-resources.json');assert pack['ok'] and pack['frozenSource']==freeze
prepared=sum(len(cases) for domains in pack['portable'].values() for cases in domains.values() if isinstance(cases,list));assert prepared==186
for domains in pack['portable'].values():
    assert len(domains['rename'])==10 and domains['moduleCount']==93 and domains['noNodeDomNetworkGlobals'] and domains['noHostImports'] and domains['noDeviceAcceptance']
    for cases in domains.values():
        if isinstance(cases,list):assert all(c['ok'] for c in cases)
def result_count(log,expected):
    text=(r/log).read_text();summary={k:int(re.findall(r'ℹ '+k+r' (\d+)',text)[-1]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
    assert summary['tests']==summary['pass']==expected and all(summary[k]==0 for k in ['fail','cancelled','skipped','todo'])
    return {'log':log,'sha256':sha(r/log),**summary}
workflow=result_count('workflow-validation-initial.log',75);web=result_count('web-focused-final.log',47);app=result_count('app-check.log',2943)
visual=[]
for name in ['rename-narrow-zh-CN.png','rename-impact-zh-CN.png','rename-narrow-en.png','rename-impact-en.png','rename-narrow-ja.png','rename-impact-ja.png','rename-reviewed.png']:
    visual.append({'path':'browser-final/'+name,'sha256':sha(r/'browser-final'/name),'visuallyInspected':True,'finding':'No horizontal clipping or overlapping action controls. Long stable UUID references wrap within the dialog; scrolling exposes the complete raw declaration and source review.'})
report={
 'format':'viento-scene-composition-fragment-rename-independent-review','schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'status':'pass','openFindings':[],'blockingFindings':0,'findings':[],
 'scope':'Read-only final source/native/evidence verification and independently authored real HTTP/Chrome rename workflow. No product, old test, old smoke, old report, actual author project, version or commit mutation.',
 'head':head,'version':baseline['version'],'finalSourceFreeze':{'path':'source-hashes.json',**freeze},'reviewedSources':b['sources'],
 'preservation':{'historicalEvidence':historical,'historicalPathSetExact':True,'exampleAuthors':author,'externalTools':tools,'previousSourceFiles':len(old),'oldSourceChanged':len(changed),'newSourceFiles':len(added),'changedPaths':changed,'newPaths':added,'allPriorTestAndSmokeBytesUnchanged':True,'prior13RustImplementationBytesUnchanged':True,'originalDefinitionEditingAndCSTLocatorBytesUnchanged':True,'headAndVersionUnchanged':True},
 'review':[
  {'area':'Exact operation and raw token scope','conclusion':'Independent optional rename ABI accepts exact content/old/new identity keys; local case-sensitive ASCII IDs, existence and collision checks are bounded. Rust selects decoded CST value spans and replaces the definition identity plus every matching placement reference in source order. Semantic comparison and exact string-token inventory reject unrelated actor/group/UUID/key/map/offset/override/order changes, preserved-key re-spelling and forged path receipts.'},
  {'area':'Whole recipe and atomic budgets','conclusion':'Complete original expansion precedes lookup/no-op; final full expansion and 128KiB byte budget apply once after all identity replacements. Rename creates no actors, groups, placements or UUIDs and remains usable at existing 32-fragment/128-declaration limits. Invalid originals cannot be repaired through rename; unused projection/image rendering semantics are unchanged.'},
  {'area':'Same identity and candidate shape','conclusion':'Native same decoded ID returns exact original bytes and []; pure propose/prepare returns definitions_unchanged and never grants approval. Proposal keeps exact eight keys and targets strictly []; complete host prepare reconstructs intent, afterContent, changedPaths and source revisions before memory Apply.'},
  {'area':'Preview provenance and model completeness','conclusion':'Existing definitions matcher recomputes full ordered actors/groups, sceneStructure parents/memberships/counts, object IDs, updated fragment composition identity, declaration JSON Pointer, supplied UTF16 ranges and ordered contributors. Browser delivered six corrupted real receipts after detached pre-mutation capture; each fails approval and releases its preview lease. Existing Rust read-only locator remains unchanged and private Node/YAML modules remain inaccessible to browser startup.'},
  {'area':'Source owner and asynchronous lifecycle','conclusion':'Source/model/intent snapshots precede awaits. Review/apply still bind owner session, scene, path, source token, domain epoch and raw intent signature. Silent input mutation invalidates approval; a held real candidate after child/parent close and visible source edit cannot reopen, approve or overwrite the new owner and its lease is released.'},
  {'area':'Ordinary Save and resources','conclusion':'Apply changes only the visible memory source and closes to the source editor. Ordinary Save preserves exact candidate bytes and saved baseline; external disk conflict retains external disk and reviewed local source separately. No execution job starts, original OC/projection/image/metadata/limit fixture bytes remain intact, and SVG cannot execute scripts or make outbound requests. Unused rename does not promise render-ready inherited assets; first placement checks real projection/image dependencies.'},
  {'area':'Independent capability and old editors','conclusion':'Absent/version2 rename export disables only Rename. Old ADD/COPY/REMOVE each still performs real complete candidate review/cancel and the old definition locator continues. After used rename, shared actor and group editors save real edits against the new key; local overrides remain authoritative, and the old placement editor can copy the renamed definition or place a renamed unused definition.'},
  {'area':'Actual keyboard and layouts','conclusion':'Native pointer opening and Check provide actual browser user activation before real Escape. Declining discard retains reviewed input/approval; accepting discards without source changes. Chinese/English/Japanese 390px form and reference samples plus desktop raw source review have accessible actions and no horizontal overflow.'}
 ],
 'browser':{'report':'browser-final/browser.json','sha256':sha(r/'browser-final/browser.json'),'log':'browser-final.log','browser':b['browser'],'node':b['node'],'flowClasses':9,'sourceFingerprints':22,'sourceStableDuringProof':True,'http':b['httpSummary'],'phases':[{'name':p['name'],'postCaptures':len(p['captures']),'releases':len(p['released'])} for p in b['capturePhases']],'runtimeErrors':0,'svgOutboundRequests':0,'savedRead409Scope':'Two background saved-preview reads raced ordinary Save/rebuild; neither carried a draft. These are accounted separately from semantic candidate rejections.','disposableAuthorFiles':22,'onlyChangedFile':b['normalSave']['onlyChangedFile'],'screenshots':visual,'keyboardScope':'Native CDP pointer opens/checks and real Escape; accepted=false then true. Snapshot input filling and delivery fault injection are intentionally explicit test instrumentation.'},
 'nativeProvenance':{'path':'reviewer-native-provenance.json','sha256':sha(r/'reviewer-native-provenance.json'),'independentExactByteReread':True,'freshHostHelpers':3,'wasm':native['binaries'][-1]},
 'relatedEvidence':{'core':{'path':'core-results.json','sha256':sha(r/'core-results.json'),'rust':172,'newJS':22,'coreRegression':290,'nativeWasmRequests':17,'sourcePortableGroups':10},'coreSecondPass':{'path':'core-independent-audit.json','sha256':sha(r/'core-independent-audit.json'),'groups':6,'lexicalVariants':12,'nativeMalformedRequests':9,'forgedReceipts':9},'workflow':workflow,'web':web,'fullApplication':{'owner':'root, raw summary independently read after completion',**app},'prepared':{'owner':'root, final report independently checked; copied VM cases not rerun by this reviewer','path':'packaged-resources.json','sha256':sha(r/'packaged-resources.json'),'groups':186,'perCopy':93,'renamePerCopy':10,'modulesPerCopy':93,'inventory':{k:v['manifestFileCount'] for k,v in pack['artifacts'].items()},'frozenSource':pack['frozenSource']}},
 'retainedAttempts':[
  {'paths':['browser-initial/browser.json','browser-initial.log'],'result':'No completed flow. Programmatic opening/checking lacked native activation; Escape closed grouped child/parent despite confirm false. Kept as a fixture diagnostic, not a product defect.'},
  {'paths':['browser-second/browser.json','browser-second.log'],'result':'No completed flow. Native pointer opening separated the parent CloseWatcher group, but synthetic Check still left child cancellation unavailable; parent remained open.'},
  {'paths':['browser-third/browser.json','browser-third.log'],'result':'No completed flow. Trusted child cancel was explicitly cancelable=false. Actual native pointer Check supplies the missing continuing user activation; no product change was needed.'},
  {'paths':['browser-fourth/browser.json','browser-fourth.log'],'result':'Five real flow classes and native Escape decline/accept passed. New fault-setup Runtime.evaluate expression contained two statements without an IIFE and raised SyntaxError; only the new smoke expression was fixed.'}
 ],
 'limitations':['One local recipe fragment identity/reference rename only; no object/document rename, cross-file migration, declaration reorder, generated transform or executable composition build.','Unplaced definitions retain prior declaration/dependency semantics; compatible effective projection and image bytes are checked on actual placement, not promised by rename.','Standard VM portability is not a hostile-code sandbox. No installed Tauri, Android device, engine runtime execution, release/commit or disk cleanup acceptance is claimed here. Root owns final cleanup and document/atlas reporting.','Initial three native-close failures arose from insufficient simulated user activation. Current passing proof uses actual pointer opening and Check; it does not claim that unactivated script-created dialogs can veto Chrome noncancelable CloseWatcher events.'],
 'conclusion':'No remaining blocking source-patch, receipt, provenance, source-owner, capability compatibility, ordinary Save or three-language layout finding in the frozen fragment rename slice.'
}
(r/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':True,'source':freeze,'history':historical['files'],'authors':author['files'],'tools':tools['files'],'browser':9,'screenshots':7,'full':app['pass'],'prepared':186,'reviewSha256':sha(r/'review.json'),'openFindings':0},ensure_ascii=False))
