// Import-free cases. The host supplies module APIs, a same-realm DTO bridge and
// a bare SHA256 digest; no DOM, filesystem, renderer or execution authority.
export async function runAlignmentCases(api) {
  const check=(value,message='Alignment portable assertion failed')=>{if(!value)throw Error(message);};
  const equal=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));};
  const same=(a,b)=>check(equal(a,b),'Alignment portable value mismatch');
  const throws=(action,code)=>{let caught=false;try{action();}catch(error){caught=true;if(code)check(error.errorCode===code,`Expected ${code}, received ${error.errorCode}`);}check(caught,'Expected alignment rejection');};
  const rejects=async(action,code)=>{let caught=false;try{await action();}catch(error){caught=true;if(code)check(error.errorCode===code,`Expected ${code}, received ${error.errorCode}`);}check(caught,'Expected alignment apply rejection');};
  const dto=value=>api.realmJson?api.realmJson(JSON.stringify(value)):value,plain=value=>JSON.parse(JSON.stringify(value));
  const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
  const value={format:'viento-scene3d',schemaVersion:1,name:'对齐 / 整列 🦊',viewport:[800,600],background:'#0d1829',camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[[-2,1.5,0],[100,20,30],[0,0,0]].map((position,index)=>({instanceId:id(index+1),name:`Box 箱${index}🦊`,primitive:'box',position,rotationDegrees:[23,-41,67],size:[1.5,3,1.5],color:'#87d8b9'}))};
  const text=model=>'\uFEFF'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
  const snapshot=(content,overrides={})=>dto({sourcePath:'documents/scenes/alignment.json',token:'prepared-alignment',content,baseSourceRevision:`sha256:${api.digest(content)}`,sourceRevision:`sha256:${api.digest(content)}`,...overrides});
  const edit=(instanceIds=[id(3),id(1)],anchorInstanceId=id(1),axis='x')=>dto({instanceIds,anchorInstanceId,axis});
  const patch=(content,instanceIds,anchorInstanceId,axis)=>api.dispatchStudioCoreScene3DAlignmentPatch(dto({protocolVersion:1,operation:'scene3d.alignObjects',content,instanceIds,anchorInstanceId,axis}));
  const replace=(content,path,token)=>{const range=api.locateJsonSource(api.parseJsonSource(content),path);check(range.exact);return content.slice(0,range.start)+token+content.slice(range.end);};
  function expected(content,selected,anchorId,axisName) {
    const original=JSON.parse(content.replace(/^\uFEFF/,'')),axis=['x','y','z'].indexOf(axisName),reference=original.objects.find(o=>o.instanceId===anchorId).position[axis],indexed=api.parseJsonSource(content),edits=[],paths=[];
    for(const[index,object]of original.objects.entries())if(selected.includes(object.instanceId)&&object.position[axis]!==reference){const path=`/objects/${index}/position/${axis}`,range=api.locateJsonSource(indexed,path);check(range.exact);edits.push({...plain(range),text:JSON.stringify(reference)});paths.push(path);}
    let after=content;for(const range of edits.sort((a,b)=>b.start-a.start))after=after.slice(0,range.start)+range.text+after.slice(range.end);return{after,paths};
  }
  const checks=[];
  {
    let raw=text(value).replaceAll('"position"','"posi\\u0074ion"').replace('"objects"','"objec\\u0074s"').replace('1000','1.000e3');raw=replace(raw,'/objects/0/position/0','-2.000e0');raw=replace(raw,'/objects/2/position/2','-0e0');
    for(const dirty of [false,true]){const content=raw+(dirty?' \r\n':''),source=snapshot(content,{baseSourceRevision:`sha256:${api.digest(raw)}`}),before=plain(source),p=api.createScene3DAlignmentProposal(source,edit()),want=expected(content,[id(1),id(3)],id(1),'x');same(plain(p.instanceIds),[id(1),id(3)]);check(p.anchorInstanceId===id(1)&&p.axis==='x');check(p.afterContent===want.after);same(plain(p.changedPaths),want.paths);same(plain(await api.prepareScene3DAlignmentApply(source,p,{digest:api.digest})),{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:want.paths});same(plain(source),before);}
    checks.push({id:'saved-dirty-sourceordered-explicit-reference-BOM-CRLF-escaped-keys-numeric-only-exact-candidate',ok:true,modes:2});
  }
  {
    const threeAxes=plain(value);threeAxes.objects[2].position=[7,4,5];for(const axis of ['x','y','z']){const content=text(threeAxes),p=api.createScene3DAlignmentProposal(snapshot(content),edit([id(3),id(1)],id(3),axis)),after=JSON.parse(p.afterContent.slice(1)),wanted=plain(threeAxes);wanted.objects[0].position[['x','y','z'].indexOf(axis)]=threeAxes.objects[2].position[['x','y','z'].indexOf(axis)];same(after,wanted);check(p.anchorInstanceId===id(3));same(plain(p.beforeObjects[1]),plain(p.afterObjects[1]));}
    checks.push({id:'three-world-position-axes-and-explicit-anchor-preserve-unselected-geometry-camera-light-and-anchor',ok:true,axes:3});
  }
  {
    const large=plain(value);large.objects=Array.from({length:128},(_,i)=>({...plain(value.objects[0]),instanceId:id(i+1),position:[i,-100000,100000]}));const ids=large.objects.map(o=>o.instanceId),source=snapshot(text(large)),p=api.createScene3DAlignmentProposal(source,edit([...ids].reverse(),id(128),'x'));same(plain(p.instanceIds),ids);check(p.beforeObjects.length===128&&p.afterObjects.length===128&&p.changedPaths.length===127);check(p.changedPaths[126]==='/objects/126/position/0');for(const object of p.afterObjects)same(plain(object.position),[127,-100000,100000]);await api.prepareScene3DAlignmentApply(source,p,{digest:api.digest});
    checks.push({id:'all128-stable-targets-sourceordered-with-complete-diagnostics-reference-retained-and127-net-paths',ok:true,targets:128});
  }
  {
    const source=snapshot(text(value)),before=plain(source);for(const intent of [edit([]),edit([id(1)]),edit([id(1),id(1)]),edit([id(1),'ffffffff-ffff-ffff-ffff-ffffffffffff']),edit([id(1),id(3)],id(2)),edit([id(1),id(3)],id(1),'X')])throws(()=>api.createScene3DAlignmentProposal(source,intent));same(plain(source),before);check(api.supportsStudioCoreScene3DAlignmentPatch());for(const supports of [api.supportsStudioCoreScene3DPatch,api.supportsStudioCoreScene3DObjectsPatch,api.supportsStudioCoreScene3DEnvironmentPatch,api.supportsStudioCoreScene3DPropertiesPatch,api.supportsStudioCoreScene3DTranslationPatch])check(supports());throws(()=>api.dispatchStudioCoreScene3DTranslationPatch(dto({protocolVersion:1,operation:'scene3d.alignObjects',content:source.content,instanceIds:[id(1),id(3)],anchorInstanceId:id(1),axis:'x'})),'studio_core_request_invalid');check(api.getStudioCoreMetadata().ready);
    checks.push({id:'incomplete-duplicate-unknown-and-nonselected-reference-or-axis-refuse-entire-batch-with-five-prior-author-capabilities-independent',ok:true});
  }
  {
    const equalValue=plain(value);equalValue.objects[0].position[0]=0;equalValue.objects[2].position[0]=0;let raw=text(equalValue);raw=replace(raw,'/objects/0/position/0','-0e0');raw=replace(raw,'/objects/2/position/0','0.000e3');check(patch(raw,[id(3),id(1)],id(1),'x').afterContent===raw);same(plain(patch(raw,[id(3),id(1)],id(1),'x').changedPaths),[]);throws(()=>api.createScene3DAlignmentProposal(snapshot(raw),edit()),'scene3d_alignment_unchanged');equalValue.objects[0].position[0]=5e-324;raw=text(equalValue);const p=api.createScene3DAlignmentProposal(snapshot(raw),edit());same(plain(p.changedPaths),['/objects/2/position/0']);check(p.afterObjects[1].position[0]===5e-324);same(plain(p.beforeObjects[0]),plain(p.afterObjects[0]));
    checks.push({id:'same-value-negative-zero-exponent-noop-preservation-and-direct-subnormal-reference-net-paths',ok:true});
  }
  {
    const bounded=plain(value);bounded.objects[0].position=[100000,0,0];bounded.objects[1].position=[0,0,0];bounded.objects[2].position=[-99999.99999999999,0,0];let raw=text(bounded);raw+=' '.repeat(131072-new TextEncoder().encode(raw).length);throws(()=>api.createScene3DAlignmentProposal(snapshot(raw),edit([id(1),id(2)])),'scene3d_limit');const p=api.createScene3DAlignmentProposal(snapshot(raw),edit([id(3),id(2),id(1)]));check(new TextEncoder().encode(p.afterContent).length<131072);await api.prepareScene3DAlignmentApply(snapshot(raw),p,{digest:api.digest});check(new TextEncoder().encode(patch(raw,[id(1),id(2)],id(2),'x').afterContent).length<131072);check(patch(raw,[id(1),id(2)],id(1),'y').afterContent===raw);throws(()=>patch(raw+' ',[id(1),id(2)],id(1),'y'),'scene3d_limit');
    checks.push({id:'final-whole128KiB-budget-rejects-growth-accepts-atomic-mixed-grow-shrink-and-exact-noop',ok:true});
  }
  {
    const source=snapshot(text(value)),p=api.createScene3DAlignmentProposal(source,edit()),copy=dto(plain(p));check(Object.isFrozen(p)&&Object.isFrozen(p.instanceIds)&&Object.isFrozen(p.beforeObjects)&&Object.isFrozen(p.afterObjects[0].position));check(!api.isScene3DAlignmentProposal(copy));await rejects(()=>api.prepareScene3DAlignmentApply(source,copy,{digest:api.digest}),'scene3d_alignment_conflict');const others=[api.createScene3DTransformProposal(source,dto({instanceId:id(1),values:{position:[4,5,6]}})),api.createScene3DObjectsProposal(source,dto({action:'remove',instanceId:id(1)})),api.createScene3DEnvironmentProposal(source,dto({values:{background:'#123456'}})),api.createScene3DPropertiesProposal(source,dto({instanceId:id(1),values:{name:'Changed'}})),api.createScene3DTranslationProposal(source,dto({instanceIds:[id(1)],offset:[1,0,0]}))];for(const other of others){check(!api.isScene3DAlignmentProposal(other));await rejects(()=>api.prepareScene3DAlignmentApply(source,other,{digest:api.digest}),'scene3d_alignment_conflict');}for(const predicate of [api.isScene3DTransformProposal,api.isScene3DObjectsProposal,api.isScene3DEnvironmentProposal,api.isScene3DPropertiesProposal,api.isScene3DTranslationProposal])check(!predicate(p));
    checks.push({id:'sixth-independent-deepfrozen-brand-clones-and-five-foreign-authoring-brands-refuse-apply-authority',ok:true});
  }
  {
    const source=snapshot(text(value)),intent=edit(),p=api.createScene3DAlignmentProposal(source,intent);intent.instanceIds.reverse();intent.anchorInstanceId=id(3);intent.axis='z';same(plain(p.instanceIds),[id(1),id(3)]);check(p.anchorInstanceId===id(1)&&p.axis==='x');let release;const pending=api.prepareScene3DAlignmentApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return api.digest(content);}});source.content='late caller mutation';source.token='late token';release();check((await pending).afterContent===p.afterContent);for(const changes of [{sourcePath:'documents/other.json'},{token:'other-session'},{content:p.beforeContent+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await rejects(()=>api.prepareScene3DAlignmentApply(snapshot(p.beforeContent,changes),p,{digest:api.digest}),'scene3d_alignment_conflict');await rejects(()=>api.prepareScene3DAlignmentApply(snapshot(p.beforeContent),p,{digest:()=> '0'.repeat(64)}),'scene3d_alignment_conflict');
    checks.push({id:'preawait-source-and-intent-detachment-with-full-path-token-bytes-two-revision-and-digest-conflicts',ok:true});
  }
  return checks;
}
