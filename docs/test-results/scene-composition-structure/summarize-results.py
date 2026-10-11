from pathlib import Path
import json,re,hashlib,datetime
r=Path.cwd();o=r/'docs/test-results/scene-composition-structure';h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def node(name):
 s=(o/name).read_text();values={key:int(re.findall(r'ℹ '+key+r' (\d+)',s)[-1]) for key in ['tests','pass','fail','cancelled','skipped','todo']}
 values['durationMs']=float(re.findall(r'ℹ duration_ms ([\d.]+)',s)[-1]);return values
full=node('app-check.log');focus=node('focused-tests.log');assert full['fail']==full['skipped']==full['cancelled']==full['todo']==0
assert full['tests']==full['pass']==2578 and focus['tests']==focus['pass']==74
rust=(o/'core-native-test.log').read_text();counts=[int(n) for n in re.findall(r'test result: ok\. (\d+) passed;',rust)];assert sum(counts)==128
browser={}
for name in ['browser-confirmed','single-regression','batch-regression']:
 p=o/name/'browser.json';item=json.loads(p.read_text());assert item['ok'] and not item['errors'] and not item['svgRequests']
 browser[name]={'ok':True,'flows':len(item['steps']),'browser':item.get('browser'),'pageErrors':len(item['errors']),'externalSvgRequests':len(item['svgRequests']),'reportSha256':h(p)}
prepared=json.loads((o/'packaged-resources.json').read_text());assert prepared['ok']
for name in ['boundary-review.json','host-review.json']:
 review=json.loads((o/name).read_text());assert not review.get('findings',review.get('openFindings',[])),name
source=json.loads((o/'source-hashes.json').read_text());assert all(h(r/name)==digest for name,digest in source.items())
baseline=json.loads((o/'baseline.json').read_text());core=json.loads((o/'core-verification.json').read_text())
result={'ok':True,'scope':'Shared recipe fragment actor addition/removal in the current unpublished 0.0.9 worktree: Rust source-preserving rules, detached exact pure proposals, independent three-language UI, full candidate preview, in-memory source apply and ordinary Save. Existing recipe/Scene2D/backend schemas remain unchanged.',
 'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':baseline['head'],'version':baseline['version'],'delivery':'unpublished source and prepared copies; no commit/version/push/install change',
 'sourceManifest':{'files':len(source),'sha256':h(o/'source-hashes.json'),'changedOrAdded':len(json.loads((o/'source-delta.json').read_text())),'stableAcrossVerification':True},
 'rust':{'tests':sum(counts),'new':9,'fail':0,'fmt':'passed','clippy':'passed','nativeCliAndWasmReceiptCases':17,'wasm':{'bytes':(r/'engine/studio-core.wasm').stat().st_size,'sha256':h(r/'engine/studio-core.wasm')}},
 'application':full,'focused':focus,'newTests':{'pure':18,'coreBridge':13,'ui':24,'preview':5,'parent':7,'sourceHost':7,'total':74,'allIncludedInFull':True},
 'preflight':{'javascriptFiles':500,'version':'passed','api':'passed','node':'24.20.0'},
 'browser':browser,'prepared':{'newCasesEach':len(prepared['desktopChecks']),'legacyCasesEach':len(prepared['desktopLegacyChecks']),'totalCaseGroups':2*(len(prepared['desktopChecks'])+len(prepared['desktopLegacyChecks'])),
 'inventories':{name:item['manifestFileCount'] for name,item in prepared['artifacts'].items()},'mappedSourceFiles':len(prepared['sourceHashes']),'mobileModuleCount':prepared['mobileChecks']['moduleCount'],'actualWasm':True,'nodeDomNetworkGlobals':False,'hostImports':False,'vm':'Standard VM portability checks, not hostile code security isolation'},
 'historicalBaseline':{'files':baseline['historicalFiles'],'authorExamples':39,'retainedTools':4,'frozenBackendFiles':7,'oldSceneSliceFiles':23,'oldAtlasPrefixesAndScores':'preserved; new structure function independently appended'},
 'initialFailures':{'core':'UTF-8 BOM test fixture insertion index, repaired only new test fixture','hostParent':'Cross-realm test transport, missing WORLD constant and unavailable editor-draft fixture assertion, repaired only new tests','ui':'New button ID and closed-dialog pending assertion fixtures, repaired only new tests','browser':'Initial 5 flows passed; later added screenshot assertion required a complete scrollable list to fit Japanese narrow-screen viewport. Final identity-label and complete-DOM assertions pass without product changes.'},
 'overlap':'Focused74, UI134, core204 and browser regressions overlap full2578; 17 native/WASM request receipts are inside one bridge test. Prepared groups are portability examples, not added unique test coverage. Initial core204 regression had one Godot skip without tool env; full final uses actual tool paths and zero skips.',
 'limits':['Unused fragments have strict declaration and registered-reference checks, no generated instance rendering; effective projection defaults and unused resource bytes need admission when placed.','Only existing fragment actor membership, one operation per review; no fragment/group/placement creation, spatial transforms, nested/cross-file authoring or common undo.','Current Linux HTTP editor/browser plus native/WASM and prepared copies; no updated installed Tauri window or Android editing/device acceptance.','No recipe direct engine build, GPU or runtime-backend capability expansion.']}
(o/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'ok':True,'full':full['tests'],'new':74,'rust':128,'sourceFiles':len(source),'browserFlows':{k:v['flows'] for k,v in browser.items()},'preparedGroups':result['prepared']['totalCaseGroups']},ensure_ascii=False))
