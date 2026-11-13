// Independent observation of pause transport. Gameplay DTOs, time and admission
// counters remain owned by the original project reader and execution backend.
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact, projectRuntimeTime as time,
  projectRuntimeSameTime as sameTime, projectRuntimeUuid as uuid } from './project-runtime-contracts.mjs';
export const PROJECT_PAUSE_PREFIX = 'VIENTO_PROJECT_PAUSE:';
const maximumSequence = 1000000000, maxLine = 4096;
const keys = ['protocol', 'event', 'sequence', 'visitIndex', 'sceneId', 'phase', 'elapsedSeconds', 'totalSeconds'];
const integer = n => Number.isSafeInteger(n) && n >= 0;
const states = ['running', 'paused', 'waiting-for-release'];
const transition = (before, after) => before === 'running' ? after === 'paused'
  : before === 'paused' ? after === 'waiting-for-release' : after === 'running' || after === 'paused';
function rowValid(row) {
  return exact(row, keys) && row.protocol === 1 && row.event === 'state' && integer(row.sequence)
    && row.sequence >= 1 && row.sequence <= maximumSequence && integer(row.visitIndex) && row.visitIndex >= 1 && row.visitIndex <= 64
    && uuid(row.sceneId) && states.includes(row.phase) && time(row.elapsedSeconds) && time(row.totalSeconds)
    && row.elapsedSeconds <= row.totalSeconds + 1e-6;
}
const invalid = () => Object.assign(new TypeError('Invalid project pause observation.'), { errorCode: 'runtime_project_pause_invalid' });
export function validateProjectPauseObservation(input) {
  const value = copy(input);
  if (!exact(value, ['format','schemaVersion','assemblyId','phase','state','current','totalTransitions','transitions','retention'])
    || value.format !== 'viento-project-pause-observation' || value.schemaVersion !== 1 || !uuid(value.assemblyId)
    || !['waiting','recording','finished','incomplete'].includes(value.phase) || !['unobserved',...states,'closed'].includes(value.state)
    || !integer(value.totalTransitions) || value.totalTransitions > maximumSequence || !Array.isArray(value.transitions)
    || !exact(value.retention,['limit','total','retained','dropped','firstSequence','lastSequence'])
    || !integer(value.retention.limit) || value.retention.limit < 1 || value.retention.limit > 128
    || value.transitions.length !== Math.min(value.totalTransitions,value.retention.limit)
    || value.retention.total !== value.totalTransitions || value.retention.retained !== value.transitions.length
    || value.retention.dropped !== value.totalTransitions-value.transitions.length
    || value.retention.firstSequence !== (value.transitions[0]?.sequence ?? null)
    || value.retention.lastSequence !== (value.transitions.at(-1)?.sequence ?? null)) throw invalid();
  if (value.current !== null && (!exact(value.current,['visitIndex','sceneId']) || !integer(value.current.visitIndex)
    || value.current.visitIndex < 1 || value.current.visitIndex > 64 || !uuid(value.current.sceneId) || value.current.sceneId === value.assemblyId)) throw invalid();
  for (let i=0;i<value.transitions.length;i++) {
    const row=value.transitions[i], previous=value.transitions[i-1];
    if (!rowValid(row) || row.sceneId===value.assemblyId || row.sequence!==value.retention.dropped+i+1
      || previous && (row.visitIndex<previous.visitIndex || row.totalSeconds+1e-6<previous.totalSeconds
        || row.visitIndex===previous.visitIndex && (row.sceneId!==previous.sceneId || row.elapsedSeconds+1e-6<previous.elapsedSeconds || !transition(previous.phase,row.phase)
          || previous.phase!=='running' && (!sameTime(row.elapsedSeconds,previous.elapsedSeconds) || !sameTime(row.totalSeconds,previous.totalSeconds)))
        || row.visitIndex>previous.visitIndex && row.phase!=='paused')) throw invalid();
  }
  if(value.retention.dropped===0 && value.transitions.length && value.transitions[0].phase!=='paused')throw invalid();
  const last=value.transitions.at(-1);
  if (value.phase==='waiting' && (value.state!=='unobserved' || value.current!==null || value.totalTransitions!==0)
    || value.phase==='finished' && (value.state!=='closed' || value.current!==null)
    || value.state==='unobserved' && (value.current!==null || value.totalTransitions!==0)
    || ['paused','waiting-for-release'].includes(value.state) && (!value.current || !last || last.phase!==value.state
      || last.visitIndex!==value.current.visitIndex || last.sceneId!==value.current.sceneId)
    || value.state==='running' && !value.current
    || value.current && last && (value.current.visitIndex<last.visitIndex
      || value.current.visitIndex===last.visitIndex && (value.current.sceneId!==last.sceneId || value.state!==last.phase))) throw invalid();
  return value;
}
export function createProjectPauseReader(input, {runtimeReader,onSnapshot,retainedTransitions=32}={}) {
  if (!runtimeReader || typeof runtimeReader.push!=='function' || typeof runtimeReader.finish!=='function'
    || onSnapshot!==undefined && typeof onSnapshot!=='function' || !Number.isInteger(retainedTransitions)
    || retainedTransitions<1 || retainedTransitions>128) throw invalid();
  const plan=validateProjectAssemblyPlan(input), members=new Set(plan.scenes.map(s=>s.scene.objectId));
  let phase='waiting', state='unobserved', current=null, ready=false, sequence=0, ended=false, interrupted=false;
  let pending='', mode='detect'; const rows=[], diagnostics=[];
  const snapshot=()=>({format:'viento-project-pause-observation',schemaVersion:1,assemblyId:plan.assembly.objectId,
    phase,state,current:current?{...current}:null,totalTransitions:sequence,transitions:copy(rows),
    retention:{limit:retainedTransitions,total:sequence,retained:rows.length,dropped:sequence-rows.length,
      firstSequence:rows[0]?.sequence??null,lastSequence:rows.at(-1)?.sequence??null}});
  const publish=()=>{try{onSnapshot?.(snapshot());}catch(error){interrupted=true;phase='incomplete';throw error;}};
  const issue=()=>{if(diagnostics.length<32)diagnostics.push({severity:'error',code:'runtime_project_pause_invalid',message:'Invalid project pause observation.'});};
  const synchronize=accepted=>{
    let changed=false;
    for(const frame of accepted){
      if(frame.event==='scene-enter'){
        if(current || ['paused','waiting-for-release'].includes(state))issue();
        current={visitIndex:frame.visitIndex,sceneId:frame.sceneId};ready=false;state='running';phase='recording';changed=true;
      }else if(frame.event==='scene-event' && frame.stream==='runtime' && frame.frame.event==='ready')ready=true;
      else if(frame.event==='scene-exit'){
        if(frame.reason==='switch' && state!=='running')issue();
        const last=rows.at(-1);
        if(last?.visitIndex===frame.visitIndex && (frame.elapsedSeconds+1e-6<last.elapsedSeconds
          || state!=='running' && !sameTime(frame.elapsedSeconds,last.elapsedSeconds)))issue();
        current=null;ready=false;state='closed';changed=true;
      }else if(frame.event==='finished'){if(rows.length && frame.totalSeconds+1e-6<rows.at(-1).totalSeconds)issue();current=null;ready=false;state='closed';phase='finished';changed=true;}
    }
    if(changed)publish();
  };
  const delegate=text=>{
    let accepted;try{accepted=runtimeReader.push(text);}catch(error){interrupted=true;phase='incomplete';throw error;}
    synchronize(accepted);return accepted;
  };
  const line=text=>{
    let row,admitted=false;
    try{
      if(new TextEncoder().encode(text).length>maxLine)throw invalid();
      row=copy(JSON.parse(text.slice(PROJECT_PAUSE_PREFIX.length)));
      const last=rows.at(-1);
      admitted=phase==='recording' && current && ready && rowValid(row) && members.has(row.sceneId)
        && row.sequence===sequence+1 && row.visitIndex===current.visitIndex && row.sceneId===current.sceneId
        && transition(state,row.phase) && (!last || row.totalSeconds+1e-6>=last.totalSeconds
          && (last.visitIndex!==row.visitIndex || row.elapsedSeconds+1e-6>=last.elapsedSeconds)
          && (state==='running' || sameTime(row.elapsedSeconds,last.elapsedSeconds) && sameTime(row.totalSeconds,last.totalSeconds)));
    }catch{/* Invalid frames cannot update the admitted pause state. */}
    if(!admitted){issue();return;}
    state=row.phase;sequence=row.sequence;rows.push(row);if(rows.length>retainedTransitions)rows.shift();publish();
  };
  const consume=(piece,complete,accepted)=>{
    if(mode==='detect'){
      const size=Math.min(PROJECT_PAUSE_PREFIX.length-pending.length,piece.length);pending+=piece.slice(0,size);piece=piece.slice(size);
      if(!PROJECT_PAUSE_PREFIX.startsWith(pending)){accepted.push(...delegate(pending+piece));pending='';mode=complete?'detect':'pass';return;}
      if(pending===PROJECT_PAUSE_PREFIX)mode='pause';
      else if(complete){accepted.push(...delegate(pending+piece));pending='';mode='detect';return;}else return;
    }
    if(mode==='pass')accepted.push(...delegate(piece));
    else if(mode==='pause'){
      if(pending.length+piece.length>maxLine+2){issue();pending='';mode='drop';}else pending+=piece;
    }
    if(complete){const observed=mode==='pause'?pending.replace(/\r?\n$/,''):null;pending='';mode='detect';if(observed!==null)line(observed);}
  };
  const api={
    get events(){return runtimeReader.events;},get diagnostics(){return [...runtimeReader.diagnostics,...copy(diagnostics)];},get pause(){return snapshot();},
    push(text){
      if(ended||interrupted||typeof text!=='string')return[];const accepted=[];let start=0;
      while(start<text.length){const nl=text.indexOf('\n',start),end=nl<0?text.length:nl+1;consume(text.slice(start,end),nl>=0,accepted);start=end;}return accepted;
    },
    finish(){
      if(!ended){
        const tail=pending,previous=mode;pending='';mode='detect';
        try{if(!interrupted){if(previous==='pause'&&tail)line(tail);else if(previous==='detect'&&tail)delegate(tail);const before=new Set(runtimeReader.events);
          try{runtimeReader.finish();}finally{synchronize(runtimeReader.events.filter(frame=>!before.has(frame)));}
        }}catch(error){interrupted=true;phase='incomplete';throw error;}
        finally{ended=true;if(interrupted||phase!=='finished'||diagnostics.length||runtimeReader.diagnostics.length)phase='incomplete';publish();}
      }
      return{events:api.events,diagnostics:api.diagnostics};
    }
  };
  if(typeof runtimeReader.snapshot==='function')api.snapshot=()=>runtimeReader.snapshot();
  for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(runtimeReader)))if(!Object.hasOwn(api,key)&&descriptor.get)Object.defineProperty(api,key,{enumerable:descriptor.enumerable,get:()=>runtimeReader[key]});
  publish();return Object.freeze(api);
}
