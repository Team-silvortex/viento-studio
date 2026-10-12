from pathlib import Path
import hashlib,json,re
p=Path('/tmp/viento-scene3d-distribution-n4tesgxn/project');o=p/'docs/test-results/scene3d-distribution-authoring'
changed=[]
for f in sorted((p/'scripts/tests').glob('*.mjs')):
 if f.name.startswith('scene3d-distribution'):continue
 s=f.read_text();n=s
 if f.name.endswith('-smoke.mjs'):
  n=re.sub(r'(initializedModules\.length,\s*)14\b',r'\g<1>15',n)
 n=re.sub(r'(plan(?:\(\))?\.modules\.length,\s*)14\b',r'\g<1>15',n)
 n=re.sub(r'((?:plan\.)?capabilities\.length,\s*)30\b',r'\g<1>31',n)
 if f.name=='studio-modules.test.mjs':n=n.replace("'org.viento.scene3d-alignment']);","'org.viento.scene3d-alignment', 'org.viento.scene3d-distribution']);")
 if f.name=='studio-system-ui.test.mjs':n=n.replace("module.id !== 'org.viento.scene3d-alignment'", "module.id !== 'org.viento.scene3d-alignment' && module.id !== 'org.viento.scene3d-distribution'")
 if n!=s:
  target=o/'previous-count-producers'/f.relative_to(p);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(s);f.write_text(n)
  changed.append({'path':str(f.relative_to(p)),'beforeSha256':hashlib.sha256(s.encode()).hexdigest(),'afterSha256':hashlib.sha256(n.encode()).hexdigest(),'scope':'Only declared full registry/runtime counts and optional-domain filter; existing mounted subsets and semantic checks unchanged.'})
(o/'module-count-adjustments.json').write_text(json.dumps({'ok':True,'moduleCount':15,'capabilityCount':31,'changes':changed},indent=2)+'\n')
f=p/'scripts/tests/scene3d-distribution-system-ports.test.mjs';s=(p/'scripts/tests/scene3d-alignment-system-ports.test.mjs').read_text().replace('Alignment','Distribution').replace('alignment','distribution')
s=s.replace("distribution: 'setupScene3DDistribution' };", "distribution: 'setupScene3DDistribution', alignment: 'setupScene3DAlignment' };")
s=s.replace('all five other authoring areas','all six other authoring areas')
s=s.replace('scene3dProperties: false, scene3dTranslation: false },','scene3dProperties: false, scene3dTranslation: false, scene3dAlignment: false },')
s=s.replace('scene3dProperties: {}, scene3dTranslation: {},','scene3dProperties: {}, scene3dTranslation: {}, scene3dAlignment: {},')
s=s.replace("'properties', 'translation']", "'properties', 'translation', 'alignment']")
s=s.replace('scene3dProperties: {}, scene3dTranslation: {} };','scene3dProperties: {}, scene3dTranslation: {}, scene3dAlignment: {} };')
s=s.replace('initializedModules.length, 13','initializedModules.length, 14').replace('initializedModules.length, 14);\n});','initializedModules.length, 15);\n});')
f.write_text(s)
f=p/'scripts/tests/scene3d-distribution-source-host.test.mjs';s=(p/'scripts/tests/scene3d-alignment-source-host.test.mjs').read_text().replace('Alignment','Distribution').replace('alignment','distribution').replace('3D位置对齐','3D等距分布')
s=s.replace("import { createScene3DDistributionProposal, isScene3DDistributionProposal, prepareScene3DDistributionApply } from '../../engine/scene3d-distribution.mjs';", "import { createScene3DDistributionProposal, isScene3DDistributionProposal, prepareScene3DDistributionApply } from '../../engine/scene3d-distribution.mjs';\nimport { createScene3DAlignmentProposal, isScene3DAlignmentProposal, prepareScene3DAlignmentApply } from '../../engine/scene3d-alignment.mjs';")
old="const original = '\\ufeff' + (await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8')).replaceAll('\\n', '\\r\\n');"
new="const fixtureModel = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));\nfixtureModel.objects.push({ ...fixtureModel.objects[2], instanceId: 'dddddddd-1111-4111-8111-111111111111', position: [99, 6, 12], name: 'Unselected' });\nconst original = '\\ufeff' + JSON.stringify(fixtureModel, null, 2).replaceAll('\\n', '\\r\\n') + '\\r\\n';"
assert old in s;s=s.replace(old,new)
s=s.replace('isScene3DDistributionProposal, prepareScene3DDistributionApply, isScene3DTranslationProposal','isScene3DDistributionProposal, prepareScene3DDistributionApply, isScene3DAlignmentProposal, prepareScene3DAlignmentApply, isScene3DTranslationProposal')
s=s.replace('sourceModel.objects.slice(0, 2)', 'sourceModel.objects.slice(0, 3)')
s=s.replace("const edit = { instanceIds, anchorInstanceId: instanceIds[0], axis: 'x' };", "const edit = { instanceIds, axis: 'x' };")
s=s.replace('const siblings = source => ({','const siblings = source => ({\n alignment: createScene3DAlignmentProposal(source, { instanceIds, anchorInstanceId: instanceIds[1], axis: \'x\' }),')
s=s.replace("const wrappers = { translation:","const wrappers = { alignment: 'applyScene3DAlignmentDraft', translation:")
s=s.replace('expected.objects[1].position[0]=expected.objects[0].position[0];','expected.objects[0].position[0]=-.25;')
s=s.replace('all five prior author approvals','all six prior author approvals').replace('pairs,10','pairs,12')
f.write_text(s)
print(json.dumps({'oldCountProducersAdjusted':len(changed),'newSystemTests':5,'newHostTests':6}))
