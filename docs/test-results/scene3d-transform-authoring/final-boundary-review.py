from pathlib import Path
import json,hashlib,stat
from datetime import datetime,timezone
r=Path.cwd();o=r/'docs/test-results/scene3d-transform-authoring';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def read(name):return json.loads((o/name).read_text())
def evidence(name):return {'path':str((o/name).relative_to(r)),'sha256':sha(o/name)}
freeze=read('source-hashes.json'); mismatch=[p for p,h in freeze.items() if not (r/p).is_file() or sha(r/p)!=h]; assert not mismatch
preservation={}
for label,name in [('history','historical-baseline.json'),('authors','author-baseline.json')]:
 baseline=read(name);bad=[p for p,h in baseline.items() if not (r/p).is_file() or sha(r/p)!=h];assert not bad
 preservation[label]={'files':len(baseline),'allByteHashesMatch':True,'baseline':evidence(name)}
tools=read('tool-baseline.json'); checked={}
for p,old in tools.items():
 f=Path(p);s=f.lstat();assert stat.S_ISREG(s.st_mode) and sha(f)==old['sha256'] and s.st_size==old['bytes'] and s.st_dev==old['dev'] and s.st_ino==old['ino']
 checked[p]={'sha256':old['sha256'],'bytes':s.st_size,'dev':s.st_dev,'ino':s.st_ino}
preservation['tools']={'files':len(checked),'allBytesAndPhysicalIdentitiesMatch':True,'baseline':evidence('tool-baseline.json'),'observed':checked}
old=read('source-baseline.json');changed={p:{'before':h,'after':freeze[p]} for p,h in old.items() if freeze[p]!=h};new=[p for p in freeze if p not in old]
preservation['previousSource']={'files':len(old),'unchanged':len(old)-len(changed),'changed':changed,'newSourceFiles':new}
unchanged_names=['web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','engine/scene3d.mjs','scripts/backends/godot4-scene3d.mjs','scripts/backends/godot3d/runtime.gd','scripts/adapters/node-scene3d-export.mjs','scripts/scene3d.mjs']
assert all(freeze[n]==old[n] for n in unchanged_names)
assert all(freeze[p]==h for p,h in old.items() if p.startswith(('engine/scene-composition','web/modules/app-scene-composition','scripts/backends/godot4-','scripts/backends/bevy')))
ui=read('ui-boundary-final.json');pure=read('source-boundary-final.json');assert ui['passed']==9 and pure['passed']==14 and ui['failed']==pure['failed']==0
assert freeze['web/modules/app-scene3d-transforms.js']==ui['sourceSha256']
assert all(freeze[p]==h for p,h in pure['sourceHashes'].items())
core=read('core-results.json');browser=read('browser-final/browser.json');prepared=read('packaged-resources.json')
assert core['status']=='passed' and browser['ok'] and len(browser['steps'])==7 and not browser['errors'] and browser['sourceStableDuringProof']
assert prepared['ok'] and prepared['frozenSource']['manifestSha256']==sha(o/'source-hashes.json')
portable=sum(len(cases) for side in prepared['portable'].values() for cases in side.values() if isinstance(cases,list))
assert portable==216
reviewed_names=['crates/viento-studio-core/src/scene3d_patch.rs','crates/viento-studio-core/src/scene3d.rs','crates/viento-studio-core/src/lib.rs','engine/studio-core.mjs','engine/scene3d-transform.mjs','engine/index.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','web/modules/app-runtime.js','web/modules/app-studio-system.js','web/modules/app-scene3d-preview.js','docs/SCENE3D.md','engine/README.md','web/i18n/en.js','web/i18n/ja.js']
reviewed={p:sha(r/p) for p in reviewed_names}
for p,h in reviewed.items():
 if p in freeze:assert h==freeze[p]
visual_names=['transform-zh-CN-390.png','transform-en-390.png','transform-ja-390.png','transform-save-conflict.png']
report={'format':'viento-scene3d-transform-independent-boundary-review','schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'status':'passed-independent-boundaries','openFindings':[],
 'base':{'head':'3a91e84a5cd543ebb4a6f416f727c544cf9ff083','version':'0.0.10','unreleasedIncrement':True},
 'finalSourceFreeze':{'files':len(freeze),'allCurrentBytesMatch':True,'manifestSha256':sha(o/'source-hashes.json'),**evidence('source-hashes.json')},'reviewedSources':reviewed,'browser':{'report':'browser-final/browser.json','flowClasses':7,'ok':True},
 'boundaries':[
 {'id':'independent-read-and-authoring-ports','ok':True,'detail':'Old preview/renderer/parse and 3D exporter source bytes remain unchanged; new ninth org.viento.scene3d-transforms receives separate getContext/getSource/applyDraft and depends only on document. No sibling controller reference or apply closure enters readonly preview.'},
 {'id':'native-scene-admission-and-numeric-token-scope','ok':True,'detail':'New optional probe/version1 and exact operation; original and final complete scene validation. Only net position/rotationDegrees/size numeric axes changed; fixed logical changedPath order with physical token splice. Other bytes, keys, UUIDs/order/camera/light/colors and equal-value lexemes remain exact. Existing scene3d helper only exposes triple crate-wide.'},
 {'id':'brand-and-preawait-snapshot','ok':True,'detail':'Deep frozen WeakSet-branded proposal authorizes only same module original receipt; JSON clone/copy does not grant draft application. Source primitive fields snapshot before digest; caller mutation cannot affect intent. Complete patch recomputed and source byte/current SHA checked.'},
 {'id':'same-source-author-owner-guards','ok':True,'detail':'Runtime context additionally binds active document identity and saved baseline/version. Path/load token/draft epoch/current bytes/baseline/version/external form guard checked around every digest/prepare await and immediately before sole in-memory edit. Same-path document replacement cannot retain authority.'},
 {'id':'ordinary-save-baseline','ok':True,'detail':'Application only changes owned source editor, dirty state/UI and returns exact new source token/content. Cached disk text, baseline, edit version and existing Save implementation stay intact. Root real browser proves exact ordinary Save and external-file conflict after draft application.'},
 {'id':'raw-input-and-review-ownership','ok':True,'detail':'Selected/displayed/proposal UUID must agree. Form/raw signature and bound source token revoke approval after input/source changes. Closing/cancel/lost-owner invalidates awaited apply guard; bad path/content/token receipts do not confirm. Exact successful source token advancement can finish and focus once.'},
 {'id':'new-capability-failclosed-old-read-remains','ok':True,'detail':'Actual WASM missing/unsupported patch probe VM variants preserve old 3D native parser readiness. New UI absent capability disables only authoring entry. Authoring works without WebGL; no World/backend/resource/auto-Save authority required.'}],
 'independentVerification':{'ui':{'passed':9,'failed':0,'runtime':ui['runtime'],**evidence('ui-boundary-final.json'),'log':'docs/test-results/scene3d-transform-authoring/ui-boundary-final.log','scope':ui['scope']},'source':{'passed':14,'failed':0,'runtime':pure['runtime'],'nativeWasmParityRequests':7,**evidence('source-boundary-final.json'),'log':'docs/test-results/scene3d-transform-authoring/source-boundary-final.log','scope':pure['scope']}},
 'ownerEvidenceRead':{'core':{'verification':core['verification'],**evidence('core-results.json')},'actualBrowser':{'passedFlows':7,'errors':0,'sourceFiles':len(browser['sources']),'sourceStableDuringProof':True,**evidence('browser-final/browser.json'),'limits':browser['limitations']},'prepared':{'passedCases':portable,'newTransformCasesPerCopy':5,'desktopFiles':prepared['artifacts']['desktop/resources']['manifestFileCount'],'mobileFiles':prepared['artifacts']['mobile/dist']['manifestFileCount'],'uiFiles':prepared['artifacts']['desktop/ui']['manifestFileCount'],**evidence('packaged-resources.json'),'scope':prepared['vmScope']}},
 'visualReview':{'reviewerActuallyViewed':[{'path':str((o/'browser-final'/n).relative_to(r)),'sha256':sha(o/'browser-final'/n)} for n in visual_names],'result':'Chinese/English/Japanese 390px form labels and controls are legible with vertical scrolling and no observed horizontal overflow. Ordinary saved-file conflict visibly offers keep/reload/force/cancel; no silent overwrite.'},
 'preservation':preservation,'explicitBytePreservedLegacySources':{p:old[p] for p in unchanged_names},
 'closedFindings':[{'id':'silent-valid-object-selection-mismatch','severity':'P2','initialActualControllerSha256':read('ui-boundary-second.json')['sourceSha256'],'initialEvidence':evidence('ui-boundary-second.json'),'actualFailure':'Object.value changed to another valid UUID without change event; original selected instance proposal could be approved despite displayed different object.','fix':'UI owner checks displayed/selected/proposal identity, restores bound selection and rejects silent preCheck mismatch; new owner test and same independent probe both pass.','finalControllerSha256':ui['sourceSha256']}],
 'retainedInitialEvidence':[{'path':'docs/test-results/scene3d-transform-authoring/ui-boundary-initial.log','reason':'Reviewer NEW probe import path fixture error before checks; no product execution claim.'},{**evidence('ui-boundary-second.json'),'reason':'Actual independent UI mismatch finding retained.'},{**evidence('source-boundary-initial.json'),'reason':'13 passed / 1 new fixture assertion failed because compact numeric array replacement did not match actual pretty source; corrected only NEW probe fixture then 14 pass.'}],
 'pendingRootFinalization':['Root full-application check is still running; this boundary report does not claim its result.','Current atlas append/prefix-cell preservation check will be independently recorded after root freezes atlas.'],
 'limits':['No product, old reports, authors, version, Git staging/commit/push, build or backend execution changed by reviewer. Only NEW evidence written.','VM tests are controller/source portability and ownership proofs, not a hostile-code security sandbox.','No installed desktop/Android device/hardware GPU/new release acceptance claimed.','Scope is one existing primitive transform; no asset/model/physics/hierarchy/gizmo/multiobject/independent save transaction.']}
with (o/'review.json').open('x',encoding='utf-8') as f:f.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':True,'sourceFiles':len(freeze),'history':preservation['history']['files'],'authors':preservation['authors']['files'],'tools':len(tools),'ui':ui['passed'],'source':pure['passed'],'prepared':portable,'reviewSha256':sha(o/'review.json')}))
