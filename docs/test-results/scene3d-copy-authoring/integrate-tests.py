from pathlib import Path
import hashlib,json,re
p=Path('/tmp/viento-scene3d-copy-jxe_q12r/project');o=p/'docs/test-results/scene3d-copy-authoring';changes=[]
for f in sorted((p/'scripts/tests').glob('*.mjs')):
 if f.name.startswith('scene3d-copy'):continue
 s=f.read_text();n=s
 if f.name.endswith('-smoke.mjs'):n=re.sub(r'(initializedModules\.length,\s*)15\b',r'\g<1>16',n)
 n=re.sub(r'(plan(?:\(\))?\.modules\.length,\s*)15\b',r'\g<1>16',n)
 n=re.sub(r'((?:plan\.)?capabilities\.length,\s*)31\b',r'\g<1>32',n)
 if f.name=='studio-modules.test.mjs':n=n.replace("'org.viento.scene3d-distribution']);","'org.viento.scene3d-distribution', 'org.viento.scene3d-copy']);")
 if f.name=='studio-system-ui.test.mjs':n=n.replace("module.id !== 'org.viento.scene3d-distribution'","module.id !== 'org.viento.scene3d-distribution' && module.id !== 'org.viento.scene3d-copy'")
 if n!=s:
  target=o/'previous-count-producers'/f.relative_to(p);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(s);f.write_text(n)
  changes.append({'path':str(f.relative_to(p)),'beforeSha256':hashlib.sha256(s.encode()).hexdigest(),'afterSha256':hashlib.sha256(n.encode()).hexdigest(),'scope':'Declared full registry/runtime counts and optional-domain filter only; mounted subsets and old semantic assertions kept.'})
(o/'module-count-adjustments.json').write_text(json.dumps({'ok':True,'moduleCount':16,'capabilityCount':32,'changes':changes},indent=2)+'\n')
f=p/'scripts/tests/scene3d-copy-system-ports.test.mjs';s=(p/'scripts/tests/scene3d-distribution-system-ports.test.mjs').read_text().replace('Distribution','Copy').replace('distribution','copy')
s=s.replace("copy: 'setupScene3DCopy', alignment:","copy: 'setupScene3DCopy', distribution: 'setupScene3DDistribution', alignment:")
s=s.replace('all six other authoring areas','all seven other authoring areas')
s=s.replace('scene3dTranslation: false, scene3dAlignment: false },','scene3dTranslation: false, scene3dAlignment: false, scene3dDistribution: false },')
s=s.replace('scene3dTranslation: {}, scene3dAlignment: {},','scene3dTranslation: {}, scene3dAlignment: {}, scene3dDistribution: {},')
s=s.replace('scene3dTranslation: {}, scene3dAlignment: {} };','scene3dTranslation: {}, scene3dAlignment: {}, scene3dDistribution: {} };')
s=s.replace("'translation', 'alignment']", "'translation', 'alignment', 'distribution']")
s=s.replace('initializedModules.length, 14','initializedModules.length, 15').replace('initializedModules.length, 15);\n});','initializedModules.length, 16);\n});')
f.write_text(s)
f=p/'scripts/tests/scene3d-copy-source-host.test.mjs';s=(p/'scripts/tests/scene3d-distribution-source-host.test.mjs').read_text().replace('Distribution','Copy').replace('distribution','copy').replace('3D等距分布','3D批量复制')
s=s.replace("import { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from '../../engine/scene3d-copy.mjs';","import { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from '../../engine/scene3d-copy.mjs';\nimport { createScene3DDistributionProposal, isScene3DDistributionProposal, prepareScene3DDistributionApply } from '../../engine/scene3d-distribution.mjs';")
s=s.replace('isScene3DCopyProposal, prepareScene3DCopyApply, isScene3DAlignmentProposal','isScene3DCopyProposal, prepareScene3DCopyApply, isScene3DDistributionProposal, prepareScene3DDistributionApply, isScene3DAlignmentProposal')
s=s.replace("const edit = { instanceIds, axis: 'x' };", "const copyIds = ['aaaaaaaa-1111-4111-8111-111111111111', 'bbbbbbbb-1111-4111-8111-111111111111'];\nconst edit = { copies: [{ sourceInstanceId: instanceIds[2], newInstanceId: copyIds[1] }, { sourceInstanceId: instanceIds[0], newInstanceId: copyIds[0] }], offset: [3, 0, 2] };")
s=s.replace('const siblings = source => ({','const siblings = source => ({\n distribution: createScene3DDistributionProposal(source, { instanceIds, axis: \'x\' }),')
s=s.replace("const wrappers = { alignment:","const wrappers = { distribution: 'applyScene3DDistributionDraft', alignment:")
s=s.replace("const expected=structuredClone(sourceModel);expected.objects[0].position[0]=-.25;", "const expected=structuredClone(sourceModel);\n for (const [index, sourceIndex] of [0,2].entries()) { const clone=structuredClone(sourceModel.objects[sourceIndex]); clone.instanceId=copyIds[index]; clone.position=clone.position.map((value,axis)=>value+edit.offset[axis]); expected.objects.push(clone); }")
s=s.replace('all six prior author approvals','all seven prior author approvals').replace('pairs,12','pairs,14')
s=s.replace("newInstanceId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Independent copy'", "newInstanceId: 'eeeeeeee-1111-4111-8111-111111111111', name: 'Independent copy'")
s=s.replace('complete copy writes source memory once, preserving unselected declarations','complete copy appends source memory once, preserving all original declarations')
f.write_text(s)
print(json.dumps({'oldCountProducersAdjusted':len(changes),'newSystemTests':5,'newHostTests':6}))
