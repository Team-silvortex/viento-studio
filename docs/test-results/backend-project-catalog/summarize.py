from pathlib import Path
import json,re,hashlib,subprocess
r=Path.cwd();o=r/'docs/test-results/backend-project-catalog'
read=lambda f:json.loads((o/f).read_text())
def tests(f):
 text=(o/f).read_text();result={}
 for field in ['tests','pass','fail','cancelled','skipped','todo','duration_ms']:
  matches=re.findall(r'^ℹ '+field+r' ([0-9.]+)$',text,re.M);assert matches,(f,field);result[field]=float(matches[-1]) if field=='duration_ms' else int(matches[-1])
 return result
full=tests('full-check-frozen.log');assert full['tests']==full['pass'] and all(full[k]==0 for k in ['fail','cancelled','skipped','todo'])
focus=tests('catalog-focused-lock-repair.log');assert focus['pass']==79 and focus['fail']==0
real=read('real-backends-final/results.json');browser=read('browser-confirmed/browser.json');copies=read('packaged-resources-frozen.json');review=read('boundary-review.json');service=read('service-review.json')
assert real['ok'] and len(real['cases'])==4 and browser['ok'] and len(browser['steps'])==8 and browser['errors']==[] and copies['ok']
base=read('baseline.json');assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base['head'] and (r/'VERSION').read_text().strip()==base['version']
result={'ok':True,'scope':'0.0.9 released HEAD 9065667; uncommitted source continuation only, no release/commit/push/install',
 'implemented':['successful creator catalog with bounded strict schema, physical/source/manifest pins, atomic cross-process locked merge, no scan/adoption',
 'restart historical list initially unchecked and no default run target; explicit full inspection and selection, frozen control/case/suite context',
 'offline tool-free inspection/selection, frozen-only scene entry after cold offline start; cached scenes retain legacy shape with source-offline admission gate',
 'current-session write-only retention authority remains separate, restored history preserved, refresh reconciles prior rows and revokes changed selection',
 'zh-CN/en/ja origin and availability, current build/snapshot, explicit selection, stale/close/response-loss guards, forced user refresh',
 'owned index lock released even when temporary publication files disappear; unknown lock/path never forcibly removed'],
 'verification':{'node':'v24.20.0','app':{'path':'full-check-frozen.log',**full,'syntaxFiles':491,'apiContract':'passed','versionConsistency':'passed','nativeArchiveMobileStoreAndCoreCli':'supplied, no conditional skips'},
 'focused':{'path':'catalog-focused-lock-repair.log',**focus,'newTests':65,'newGroups':{'catalog':15,'service':10,'independentBoundary':14,'controller':15,'parent':11},'oldRetention':14,'overlap':'Focused is included in full; do not add counts'},
 'realBackends':{'path':'real-backends-final/results.json','cases':4,'names':[c['name'] for c in real['cases']],'realHeadlessAfterRestart':4,'perInstanceControlAndCaseAndSuiteBackends':2,'controlStepsEach':4,'checksEach':3,'suiteMembersEach':2,'leafReports':4,'authorAndFrozenBytes':'unchanged'},
 'browser':{'path':'browser-confirmed/browser.json','version':browser['browser'],'flows':len(browser['steps']),'errors':browser['errors'],'narrowWidth':390,'languages':['zh-CN','en','ja'],'visualCheck':'4 visible screenshots inspected by UI agent and root; complete inventory asserted from actual DTO/DOM','timing':'Completed before final catalog exceptional-cleanup fix; UI unchanged afterward, fixed copied host and full/fault checks verify final source'},
 'prepared':{'path':'packaged-resources-frozen.json','groups':copies['counts'],'desktopFiles':524,'mobileFiles':211,'desktopUiFiles':11,'sourceMappings':534,'mobileLocalModules':123,'scope':'Current 4 real manifests; desktop copied host/CLI, portable DTO and explicit mobile unsupported host assertions, not installation/device or hostile-code sandbox'},
 'independent':{'boundary':'boundary-review.json','service':'service-review.json','openFindings':[],'missingTemporaryFileProbe':'catalog-missing-temp-final.json'}},
 'attempts':{'fullInitial':{'path':'full-check-initial.log',**tests('full-check-initial.log'),'failure':'two old expectations described a session-only catalog and empty restart list; contract tests updated and replaced-root refusal strengthened'},
 'fullBeforeExceptionalCleanupFix':{'path':'full-check-final.log',**tests('full-check-final.log'),'scope':'Passed prior to independently reproduced temporary-file disappearance fault; third full verifies the repair'},
 'realInitial':{'path':'real-backends-initial/results.json','failure':'NEW runtime assertion fixture requested second-actor movement while demo explicitly controls:none; NEW fixture declares arrows before source hash/build, final actual tools pass'},
 'browserInitial':'NEW same-service offline fixture expected new cold-start-only frozenOnly flag; actual DTO preserved old cached shape. Real manual refresh cache bug then fixed with extra parent regression; final Bevy fixture re-inspects details after selection cleared them.',
 'preparedInitialAndFinal':'Both 21 groups passed their pre-lock-repair sources; preserved original artifacts/manifests/provenance. prepared-frozen verifies final module.',
 'lockFault':'Independent initial reproducer preserved index but left owned lock; final nested-finally cleanup fix and 15th regression/probe verify release and later successful write'},
 'integrity':{'sourceFiles':594,'oldHistoricalFiles':2588,'protectedRustFiles':13,'frozenGodotFiles':7,'protectedSceneFiles':23,'sharedWasmBytes':325826,'sharedWasmSha256':'4246d8fee45d85530c0afbb5012ae557fe67f5a53eae8915adf818444575ccf9','atlas':'old axes/bindings/cells/evidence/dependencies/workflow/legacy/priorities prefixes remain exact; new catalog slice separately appended'},
 'limitations':['Unregistered old and CLI outputs remain cold CLI inspect only; no automatic adoption','Catalog is local host state; source/cache path relocation is not auto migrated or included in author archive','Only successful builds persisted, failed partial outputs remain current-session diagnostics','Restored entries never acquire deletion receipts; 256 records/1MiB budget does not evict old records, no manual deletion UI yet','Runtime history/report browsing across restart, generated-project back-import, Cargo author builds, standalone distribution, ns-nova execution, installed Tauri and Android device acceptance not added'],
 'cleanup':read('cleanup.json') if (o/'cleanup.json').exists() else 'pending', 'audit':'final-audit.json'}
(o/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'ok':True,'full':full,'newTests':65,'focused':focus,'realCases':4,'browserFlows':8,'preparedGroups':21},ensure_ascii=False))
