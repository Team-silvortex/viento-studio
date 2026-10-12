from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def stamp(path):return {'sha256':sha(path),'bytes':path.stat().st_size}
def load(path):return json.loads(path.read_text())
old=load(OUT/'atlas-baseline.json');data=load(ROOT/'docs/function-atlas.json');snapshot=load(OUT/'atlas-source-snapshot-before.json')
assert old['sourceSnapshot']==snapshot
preserved={}
for axis in old['axes']:
 preserved['axes.'+axis]=data['axes'][axis][:len(old['axes'][axis])]==old['axes'][axis]
for key in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:
 preserved[key]=data[key][:len(old[key])]==old[key]
assert all(preserved.values())
assert data['meta']['historicalSha256']==old['meta']['historicalSha256']
assert all(sha(ROOT/path)==digest for path,digest in old['meta']['historicalSha256'].items())
assert all(sha(ROOT/path)==digest for path,digest in data['sourceSnapshot'].items())
assert set(snapshot).issubset(data['sourceSnapshot'])
delta=[{'path':path,'beforeSHA256':digest,'currentSHA256':data['sourceSnapshot'][path]} for path,digest in snapshot.items() if data['sourceSnapshot'][path]!=digest]
oldreportchanges=[v for v in delta if v['path'].startswith('docs/test-results/')];assert not oldreportchanges
newcells=data['cells'][len(old['cells']):];scores={dim:sorted(set(v['value'] for v in newcells if v['coordinates'][3]==dim)) for dim in ['implementation','verification','decoupling','delivery']}
assert scores=={'implementation':[4],'verification':[3],'decoupling':[3],'delivery':[2]}
added={'function':len(data['axes']['function'])-len(old['axes']['function']),'implementation':len(data['axes']['implementation'])-len(old['axes']['implementation']),'bindings':len(data['bindings'])-len(old['bindings']),'cells':len(newcells),'dependencies':len(data['dependencies'])-len(old['dependencies']),'workflows':len(data['workflows'])-len(old['workflows']),'evidence':len(data['evidence'])-len(old['evidence'])}
assert {k:added[k] for k in ['function','implementation','bindings','cells','dependencies','workflows']}=={'function':1,'implementation':5,'bindings':5,'cells':20,'dependencies':3,'workflows':1}
for row in data['evidence'][len(old['evidence']):]:assert not any(s in row['path'] for s in ['atlas-preservation-review','post-stage','patch-ready','actual-apply-receipt','post-apply'])
source=load(OUT/'source-hashes-final.json');assert len(source)==767 and all(sha(ROOT/path)==digest for path,digest in source.items())
assert 'docs/STATUS.md' not in source
before=OUT/'status-before-closing.md';saved=OUT/'status-before-closing.txt'
if before.exists():assert not saved.exists();before.rename(saved)
oldstatus=saved.read_text();status=(ROOT/'docs/STATUS.md').read_text();start=status.index('本轮[批量复制验收]');end=status.index('上一分布专题在 0.0.10',start);assert status[:start]+status[end:]==oldstatus
assert '实际工程与验证副本的字节一致性由单独写回记录确认' in status[start:end]
newlinks=re.findall(r'\[[^\]]+\]\(([^)]+)\)',status[start:end]);assert all((ROOT/'docs'/href.split('#',1)[0]).is_file() for href in newlinks)
counts={'architecture':len(data['axes']['architecture']),'functions':len(data['axes']['function']),'implementations':len(data['axes']['implementation']),'maturityDimensions':len(data['axes']['maturity']),**{key:len(data[key]) for key in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']},'referencedSources':len(data['sourceSnapshot'])}
outputs={path:stamp(ROOT/path) for path in ['docs/function-atlas.json','docs/FUNCTION_ATLAS.md','docs/function-atlas.html','docs/function-atlas.mmd','docs/STATUS.md']}
record={'format':'viento-scene3d-copy-atlas-preservation-review','schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'openFindings':[],'scope':'Append-only staged atlas and STATUS closing; no product/old score/evidence/legacy edit or actual checkout application. This proof is not referenced as atlas evidence, avoiding self-hash cycles.','baseline':{'path':'atlas-baseline.json','sha256':sha(OUT/'atlas-baseline.json')},'currentAtlas':{'path':'docs/function-atlas.json','sha256':sha(ROOT/'docs/function-atlas.json')},'oldPrefixesDeepExact':preserved,'oldCellValuesAndReasonsDeepExact':True,'historicalSnapshotHashesExact':old['meta']['historicalSha256'],'oldCompleteSourceSnapshot':{'entries':len(snapshot),'retainedPath':'atlas-source-snapshot-before.json','retainedSHA256':sha(OUT/'atlas-source-snapshot-before.json'),'deepEqualBaseline':True},'currentSourceSnapshot':{'entries':len(data['sourceSnapshot']),'allActualBytesMatch':True,'necessaryCurrentSourceRefreshDelta':delta,'oldHistoricalReportFingerprintsChanged':oldreportchanges,'scope':'Current product/test/docs references take current byte hashes; original1350-entry source map is separately frozen, old historical proof and meta hashes remain unchanged.'},'added':added,'counts':counts,'newScoreValues':scores,'deliveryBoundary':'Unpublished 0.0.10-after increment, stage checks and prepared copies only. Exact checkout writeback has a separate record; no commit/push/install/device or hardware-GPU maturity increase.','frozenProductSource':{'manifest':'source-hashes-final.json','sha256':sha(OUT/'source-hashes-final.json'),'files':len(source),'allMatch':True},'statusClosing':{'originalSnapshot':'status-before-closing.txt','beforeSHA256':sha(saved),'newParagraphsOnly':True,'originalRestByteExact':True,'localLinksVerified':newlinks,'actualApplyNotPreclaimed':True},'outputs':outputs,'evidence':{name:stamp(OUT/name) for name in ['results.json','application-timing.json','atlas-append-receipt.json','atlas-append.log','atlas-write.log','atlas-check.log']}}
with (OUT/'atlas-preservation-review.json').open('x') as f:json.dump(record,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'ok':True,'counts':counts,'sha256':sha(OUT/'atlas-preservation-review.json'),'allProductSourcesMatch':True}))
