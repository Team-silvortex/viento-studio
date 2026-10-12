from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
load=lambda p:json.loads((OUT/p).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
proof=lambda p:{'path':str((OUT/p).relative_to(ROOT)),'sha256':sha(OUT/p)}
text=(OUT/'app-check.log').read_text();app={k:int(v)for k,v in re.findall(r'^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$',text,re.M)}
assert app['tests']==app['pass'] and not any(app[k] for k in ['fail','cancelled','skipped','todo'])
core=load('core-results.json');v=core['verification'];assert core['status']=='passed' and core['compiledSourcesMatchCurrent']
prepared=load('packaged-resources.json');browser=load('browser-objects-final/browser.json');oldbrowser=load('browser-transform-regression-1/browser.json');review=load('review.json');preservation=load('preservation-audit-before-cleanup.json');cleanup=load('cleanup.json');freeze=load('source-freeze.json');atlasreview=load('atlas-preservation-review.json')
for report in [prepared,browser,oldbrowser,review,preservation,cleanup]:assert report['ok'] is True
assert not review['openFindings'] and not preservation['openFindings']
assert browser['sourceStableDuringProof'] and not browser['errors'] and oldbrowser['sourceStableDuringProof'] and not oldbrowser['errors']
assert atlasreview['ok'] is True
atlas=json.loads((ROOT/'docs/function-atlas.json').read_text());total=2*sum(len(x)for x in prepared['portable']['desktop'].values() if isinstance(x,list))
independent={key:len(load(file)['checks']) for key,file in [('source','source-boundary-initial.json'),('ui','ui-boundary-final.json'),('host','host-boundary-initial.json')]}
report={'format':'viento-scene3d-object-authoring-results','schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'status':'passed','version':(ROOT/'VERSION').read_text().strip(),'publishedBase':'3a91e84a5cd543ebb4a6f416f727c544cf9ff083','delivery':'working-tree','feature':'independent 3D primitive add/copy/remove with guarded source-preserving authoring','entry':'Existing JSON source editor → 管理3D对象 → select action and explicit name/fresh identity → Check complete candidate → Apply draft → ordinary Save','boundaries':[
 'Rust owns strict full-scene validation and source-preserving object-array edits; all input/output size and count budgets remain enforced.',
 'Copy preserves the complete source object except fresh UUID and semantically changed explicit name; removal preserves survivor source spans/order and refuses the last primitive.',
 'Structure and transform proposals have separate private frozen brands. Shared source admission and host draft guard grant neither cross-domain approval nor sibling controller access.',
 'Document/path/token/load/draft epoch/raw source/baseline/version checks run again across waits; successful apply carries exact source and a new ownership token.',
 'Apply changes only memory; ordinary Save retains its external-disk conflict check. Old readonly preview remains three fields and cannot write.'
 ],'validation':{
 'application':{**app,'javascriptFiles':int(re.search(r'语法检查通过：(\d+) 个 JavaScript 文件',text)[1]),'runtime':'v24.20.0','proof':proof('app-check.log'),'timingSupplement':proof('application-timing.json')},
 'rust':{'tests':v['rust']['passed'],'new':v['rust']['newUnitPassed'],'unit':v['rust']['unitPassed'],'integration':v['rust']['integrationPassed'],'fmt':v['fmt']['passed'],'clippyWarningsDenied':v['clippy']['passed'],'proof':proof('core-results.json')},
 'newApplicationTests':{'tests':72,'coreBridge':18,'portableHelper':8,'actualSourceHost':8,'systemPorts':4,'ui':34,'overlap':'All 72 are included in the complete application suite. UI87 and core219 focused sets overlap; do not add them to full tests or treat them as coverage percentages.'},
 'finalLayout':{'change':'Scoped [hidden] display priority corrects mode-specific field visibility after visual discovery. No semantic product code changed.','postCorrectionUiTests':87,'modeComputedDisplayChecks':12,'proof':proof('web-validation.json'),'uiLog':proof('ui-tests-layout-final.log'),'finalSmokeSyntax':proof('syntax-final.log')},
 'browser':{'flowClasses':len(browser['steps']),'browser':browser['browser'],'renderer':browser['gpu']['renderer'],'languages':['zh-CN','en','ja'],'narrowWidth':390,'sourceStable':browser['sourceStableDuringProof'],'proof':proof('browser-objects-final/browser.json'),'visualProof':proof('visual-review-final.json')},
 'oldTransformBrowser':{'flowClasses':len(oldbrowser['steps']),'scope':'Actual old seven-flow script rerun after shared host/source refactor and before the objects-only stylesheet correction; transform sources remain final identical.','proof':proof('browser-transform-regression-1/browser.json')},
 'prepared':{'tests':total,'newObjectsCasesEach':len(prepared['portable']['desktop']['objects']),'desktopModules':prepared['portable']['desktop']['moduleCount'],'mobileModules':prepared['portable']['mobile']['moduleCount'],'inventories':{key:value['manifestFileCount']for key,value in prepared['artifacts'].items()},'proof':proof('packaged-resources.json'),'explicitFinalDocSync':proof('prepared-doc-sync.json'),'explicitFinalCssSync':proof('prepared-css-sync.json')},
 'independent':{**independent,'groups':sum(independent.values()),'nativeWasmParityRequests':10,'openFindings':review['openFindings'],'proof':proof('review.json')}
 },'preservation':{'historicalFiles':len(load('historical-baseline.json')),'authorFiles':len(load('author-baseline.json')),'externalTools':len(load('tool-baseline.json')),'frozenSourceFiles':freeze['frozenFiles'],'priorSourceManifestRetained':proof('previous-source-hashes.json'),'sourceFreeze':proof('source-freeze.json'),'proof':proof('preservation-audit-before-cleanup.json')},'cleanup':{'allocatedFileBytesRemoved':cleanup['allocatedFileBytesRemoved'],'generatedDirectories':len(cleanup['removed']),'proof':proof('cleanup.json'),'retained':'Tested shared WASM/build metadata, author sources/examples, all old/new reports, dependencies, external trusted toolchains and installed applications'},'atlas':{'functions':len(atlas['axes']['function']),'implementations':len(atlas['axes']['implementation']),'bindings':len(atlas['bindings']),'cells':len(atlas['cells']),'oldCoordinatesScoresReasonsPreserved':True,'proof':proof('atlas-preservation-review.json')},'retainedAttempts':[
 'Initial NEW UI UUID fixture counter corrected; old logs retained and meaningful native-backed UI case passed.',
 'Initial NEW browser fixture incorrectly compared textarea-normalized LF display directly with disk CRLF; final view/draft/candidate/disk scopes are explicit.',
 'Actual screenshot review identified mode-hidden labels overridden by grid CSS; one scoped rule fixed it, final computed-display checks and complete workflow reran.',
 'Initial NEW prepared lexical-copy fixture altered camera/root name instead of object tokens; corrected fixture targets the objects array and actual copied-source checks passed.'
 ],'limits':['Working-tree increment only: no version bump, commit/push or new installer/device acceptance in this slice.','Schema1 boxes only, 1–128 objects; hierarchy, model assets, material systems, gizmos and multi-object transactions remain separate work.','Actual WebGL preview uses recorded SwiftShader software implementation; prepared VM checks have no Node/DOM/fetch/host imports and are portability checks, not hostile-code sandbox or device acceptance.']}
assert not (OUT/'results.json').exists()
(OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':True,'app':app['pass'],'rust':v['rust']['passed'],'prepared':total,'browser':len(browser['steps']),'reclaimedGiB':cleanup['allocatedFileBytesRemoved']/2**30}))
