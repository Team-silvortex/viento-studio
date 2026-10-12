from pathlib import Path
import re,json,hashlib
R=Path('/tmp/viento-scene3d-removal-71u64wrk/project');O=R/'docs/test-results/scene3d-removal-authoring'
def add(path,old,new):
 p=R/path;s=p.read_text();assert s.count(old)==1,(path,old);p.write_text(s.replace(old,new,1))
add('engine/index.mjs',"export { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from './scene3d-copy.mjs';","export { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from './scene3d-copy.mjs';\nexport { createScene3DRemovalProposal, isScene3DRemovalProposal, prepareScene3DRemovalApply } from './scene3d-removal.mjs';")
add('engine/studio-modules.mjs',"  moduleDescriptor('org.viento.scene3d-copy', [\n    ['scene.authoring.copy3d', 'authoring'],\n  ]),","  moduleDescriptor('org.viento.scene3d-copy', [\n    ['scene.authoring.copy3d', 'authoring'],\n  ]),\n  moduleDescriptor('org.viento.scene3d-removal', [\n    ['scene.authoring.removal3d', 'authoring'],\n  ]),")
add('web/modules/app-studio-system.js',"import { setupScene3DCopy } from './app-scene3d-copy.js';","import { setupScene3DCopy } from './app-scene3d-copy.js';\nimport { setupScene3DRemoval } from './app-scene3d-removal.js';")
add('web/modules/app-studio-system.js',"scene3dCopy: 'org.viento.scene3d-copy'","scene3dCopy: 'org.viento.scene3d-copy', scene3dRemoval: 'org.viento.scene3d-removal'")
add('web/modules/app-studio-system.js',"[IDS.scene3dCopy]: Boolean(ports.scene3dCopy) && features.scene3dCopy !== false };","[IDS.scene3dCopy]: Boolean(ports.scene3dCopy) && features.scene3dCopy !== false,\n    [IDS.scene3dRemoval]: Boolean(ports.scene3dRemoval) && features.scene3dRemoval !== false };")
add('web/modules/app-studio-system.js',"'scene3dDistribution', 'scene3dCopy']","'scene3dDistribution', 'scene3dCopy', 'scene3dRemoval']")
add('web/modules/app-studio-system.js',"  if (typeof setupScene3DCopy === 'function') mount(IDS.scene3dCopy, setupScene3DCopy, options('scene3dCopy'));","  if (typeof setupScene3DCopy === 'function') mount(IDS.scene3dCopy, setupScene3DCopy, options('scene3dCopy'));\n  if (typeof setupScene3DRemoval === 'function') mount(IDS.scene3dRemoval, setupScene3DRemoval, options('scene3dRemoval'));")
add('web/modules/app-studio-system.js',"controllers.get(IDS.scene3dCopy)?.refresh?.();","controllers.get(IDS.scene3dCopy)?.refresh?.(); controllers.get(IDS.scene3dRemoval)?.refresh?.();")
add('web/modules/app-runtime.js',"import { isScene3DCopyProposal, prepareScene3DCopyApply } from '../../engine/scene3d-copy.mjs';","import { isScene3DCopyProposal, prepareScene3DCopyApply } from '../../engine/scene3d-copy.mjs';\nimport { isScene3DRemovalProposal, prepareScene3DRemovalApply } from '../../engine/scene3d-removal.mjs';")
add('web/modules/app-runtime.js',"// Shared document-owned source application only. Intent semantics and private", "async function applyScene3DRemovalDraft(proposal, options = {}) {\n  return applyScene3DAuthoringDraft(proposal, options, { valid: isScene3DRemovalProposal, prepare: prepareScene3DRemovalApply,\n    errorCode: 'scene3d_removal_conflict', dirtyMessage: '3D批量移除已应用到原文草稿；尚未保存。',\n    cleanMessage: '3D批量移除已应用；文本与已保存版本一致。' });\n}\n\n// Shared document-owned source application only. Intent semantics and private")
add('web/modules/app-runtime.js',"      scene3dCopy: { getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DCopyDraft },","      scene3dCopy: { getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DCopyDraft },\n      scene3dRemoval: { getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DRemovalDraft },")
changes=[]
for p in sorted((R/'scripts/tests').glob('*.mjs')):
 if p.name.startswith('scene3d-removal'):continue
 s=p.read_text();n=s
 if p.name.endswith('-smoke.mjs'):n=re.sub(r'(initializedModules\.length,\s*)16\b',r'\g<1>17',n)
 n=re.sub(r'(plan(?:\(\))?\.modules\.length,\s*)16\b',r'\g<1>17',n)
 n=re.sub(r'((?:plan\.)?capabilities\.length,\s*)32\b',r'\g<1>33',n)
 n=n.replace('sixteen-module/thirty-two-capability','seventeen-module/thirty-three-capability').replace('all sixteen modules','all seventeen modules')
 if p.name=='studio-modules.test.mjs':n=n.replace("'org.viento.scene3d-copy']);","'org.viento.scene3d-copy', 'org.viento.scene3d-removal']);")
 if p.name=='studio-system-ui.test.mjs':n=n.replace("module.id !== 'org.viento.scene3d-copy'","module.id !== 'org.viento.scene3d-copy' && module.id !== 'org.viento.scene3d-removal'")
 if n!=s:
  changes.append({'path':str(p.relative_to(R)),'beforeSha256':hashlib.sha256(s.encode()).hexdigest(),'afterSha256':hashlib.sha256(n.encode()).hexdigest(),'scope':'Full declared registry/runtime counts and optional domain filter, not injected subset counts or old author semantics.'});p.write_text(n)
with (O/'count-adjustments.json').open('x') as f:json.dump({'ok':True,'moduleCount':17,'capabilityCount':33,'changes':changes},f,indent=2);f.write('\n')
p=R/'scripts/tests/scene3d-removal-system-ports.test.mjs';s=(R/'scripts/tests/scene3d-copy-system-ports.test.mjs').read_text().replace('Copy','Removal').replace('copy','removal')
s=s.replace("removal: 'setupScene3DRemoval', distribution:","removal: 'setupScene3DRemoval', copy: 'setupScene3DCopy', distribution:")
s=s.replace('all seven','all eight').replace('scene3dDistribution: false },','scene3dDistribution: false, scene3dCopy: false },').replace('scene3dDistribution: {},','scene3dDistribution: {}, scene3dCopy: {},').replace('scene3dDistribution: {} };','scene3dDistribution: {}, scene3dCopy: {} };').replace("'alignment', 'distribution']","'alignment', 'distribution', 'copy']").replace('initializedModules.length, 16);\n});','initializedModules.length, 17);\n});').replace('initializedModules.length, 15);','initializedModules.length, 16);')
p.write_text(s)
p=R/'scripts/tests/scene3d-removal-source-host.test.mjs';s=(R/'scripts/tests/scene3d-copy-source-host.test.mjs').read_text().replace('Copy','Removal').replace('copy','removal').replace('3D批量复制','3D批量移除')
s=s.replace("import { createScene3DRemovalProposal, isScene3DRemovalProposal, prepareScene3DRemovalApply } from '../../engine/scene3d-removal.mjs';","import { createScene3DRemovalProposal, isScene3DRemovalProposal, prepareScene3DRemovalApply } from '../../engine/scene3d-removal.mjs';\nimport { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from '../../engine/scene3d-copy.mjs';")
s=s.replace('isScene3DRemovalProposal, prepareScene3DRemovalApply, isScene3DDistributionProposal','isScene3DRemovalProposal, prepareScene3DRemovalApply, isScene3DCopyProposal, prepareScene3DCopyApply, isScene3DDistributionProposal')
a=s.index('const removalIds =');b=s.index('\nconst review =',a);s=s[:a]+"const edit = { instanceIds: [instanceIds[2], instanceIds[0]] };"+s[b:]
s=s.replace('const siblings = source => ({',"const siblings = source => ({\n copy: createScene3DCopyProposal(source, { copies: [{sourceInstanceId:instanceIds[0],newInstanceId:'aaaaaaaa-1111-4111-8111-111111111111'}], offset:[3,0,2] }),")
s=s.replace("const wrappers = { distribution:","const wrappers = { copy: 'applyScene3DCopyDraft', distribution:")
a=s.index(' const receipt=await h.apply(proposal); const expected=');b=s.index('\n assert.deepEqual(JSON.parse',a);s=s[:a]+" const receipt=await h.apply(proposal); const expected=structuredClone(sourceModel);\n expected.objects=expected.objects.filter(object=>!edit.instanceIds.includes(object.instanceId));"+s[b:]
s=s.replace("action: 'removal'","action: 'copy'").replace('Independent removal','Independent copy')
s=s.replace('complete removal appends','complete removal removes selected').replace('all original declarations','all survivor declarations').replace('all seven prior','all eight prior').replace('pairs,14','pairs,16')
p.write_text(s)
print(json.dumps({'countProducerAdjustments':len(changes),'newSystemTests':5,'newHostTests':6}))
