import { createRuntimeCaseDocumentService } from '../lib/runtime-case-documents.mjs';
import { createRuntimeCaseSuiteDocumentService } from '../lib/runtime-case-suites.mjs';
import { sceneId, runtimeCase } from './runtime-case-fixture.mjs';
export { fixture,inventory,service,builtService,settled,registry,gate,phaseResult,sceneId,backendId,fakeTool,unknown,build } from './runtime-case-fixture.mjs';

export async function savedSuite(h,{firstFails=false,count=2}={}) {
  const author=createRuntimeCaseDocumentService(h.root),groups=createRuntimeCaseSuiteDocumentService(h.root),members=[];
  for(let index=0;index<count;index++) {
    const catalog=await author.list(sceneId),definition=runtimeCase();
    if(index===0&&firstFails)definition.checks[0].position.value[0]+=1;
    const content='\uFEFF'+JSON.stringify({format:'viento-runtime-case-document',schemaVersion:1,sceneObjectId:sceneId,case:definition},null,'\t').replaceAll('\n','\r\n')+'\r\n';
    members.push(await author.save({sceneId,sceneVersion:catalog.sceneVersion,sourcePath:`documents/runtime-cases/case-${index}.json`,documentType:catalog.defaults.documentType,content}));
  }
  const definition={format:'viento-runtime-case-suite',schemaVersion:1,sceneObjectId:sceneId,documentIds:members.map(item=>item.id)};
  const content='\uFEFF'+JSON.stringify(definition,null,'\t').replaceAll('\n','\r\n')+'\r\n',catalog=await groups.list(sceneId);
  const group=await groups.save({sceneId,sceneVersion:catalog.sceneVersion,sourcePath:'documents/runtime-suites/group.json',documentType:catalog.defaults.documentType,content});
  return {author,groups,members,group,definition,content};
}
