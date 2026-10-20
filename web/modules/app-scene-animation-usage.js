import { isSceneAnimationUsage, sceneAnimationUsageMatchSource, sceneAnimationUsageSource } from '../../engine/scene-animation-usage.mjs';
import { sourceLocationSelection } from './app-source-location.js';
import { revealSourceOffset } from './app-source-reveal.js';
import { t } from '../i18n/index.js';

// Advisory saved text only. This component owns neither animation authoring,
// review, playback nor file access; its host supplies a scoped read port.
export function setupSceneAnimationUsage({ container, getContext = () => ({}), getUsage, onSelectionChange = () => {}, translate = t } = {}) {
  const document = container.ownerDocument, node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const el = name => container.querySelector('#sceneAnimationUsage' + name);
  container.classList.add('scene-animation-usage'); container.setAttribute('aria-labelledby', 'sceneAnimationUsageTitle');
  container.innerHTML = `<div class="scene-animation-toolbar"><h3 id="sceneAnimationUsageTitle"></h3><div class="scene-animation-usage-actions"><button id="sceneAnimationUsageRefresh" type="button" class="doc-btn doc-btn-ghost"></button><button id="sceneAnimationUsageDismiss" type="button" class="doc-btn doc-btn-ghost"></button></div></div>
    <p id="sceneAnimationUsageClip" class="muted"></p><p id="sceneAnimationUsageHint" class="muted"></p>
    <h4 id="sceneAnimationUsageMatchesTitle"></h4><p id="sceneAnimationUsageStatus" class="muted" role="status" aria-live="polite"></p>
    <p id="sceneAnimationUsageBehaviorPath" class="muted"></p><ul id="sceneAnimationUsageMatches"></ul>
    <section id="sceneAnimationUsageSource" hidden><h4 id="sceneAnimationUsageSourceTitle"></h4><p id="sceneAnimationUsageSourcePath" class="muted"></p><p id="sceneAnimationUsageSourceField" class="muted"></p>
      <textarea id="sceneAnimationUsageSourceText" lang="" readonly spellcheck="false" aria-labelledby="sceneAnimationUsageSourceTitle" aria-describedby="sceneAnimationUsageSourcePath sceneAnimationUsageSourceField"></textarea>
      <div class="scene-animation-usage-actions"><button id="sceneAnimationUsageSourceLocate" type="button" class="doc-btn doc-btn-ghost"></button><button id="sceneAnimationUsageSourceDismiss" type="button" class="doc-btn doc-btn-ghost"></button></div></section>`;
  let disposed = false, owner = null, token, clipId = '', catalog = null, state = 'idle', sequence = 0, sourceView = null, listCatalog = null, listClip = '', matches = [];
  const enabled = context => !disposed && context.current === true && context.available === true && typeof getUsage === 'function';
  const exists = context => context.clips?.some(clip => clip.id === clipId);
  const current = () => { const context = getContext(); return enabled(context) && owner === context.source && token === context.usageToken && exists(context); };
  function clearSource() { sourceView = null; el('Source').hidden = true; el('SourceText').value = ''; el('SourcePath').textContent = ''; el('SourceField').textContent = ''; }
  function reset() { sequence++; clipId = ''; catalog = null; state = 'idle'; clearSource(); listCatalog = null; listClip = ''; matches = []; el('Matches').replaceChildren(); container.hidden = true; }
  const sourceCurrent = () => current() && sourceView && sourceView.catalog === catalog && sourceView.clipId === clipId && catalog.matches.includes(sourceView.match);
  function locate() {
    if (!sourceCurrent()) return false;
    const source = sourceView.source, selection = sourceLocationSelection(source.content, source, source.sourceRevision), textarea = el('SourceText');
    if (selection.status !== 'exact' || textarea.value !== source.content.replace(/\r\n|\r/g, '\n')) return false;
    textarea.focus({ preventScroll: true }); textarea.selectionStart = selection.start; textarea.selectionEnd = selection.end;
    el('Source').scrollIntoView?.({ block: 'nearest' }); revealSourceOffset(textarea, textarea.value, selection.start); return true;
  }
  function showSource(match, control, capturedCatalog, selected) {
    if (!current() || state === 'loading' || catalog !== capturedCatalog || clipId !== selected || !catalog.matches.includes(match) || match.clipId !== clipId || !el('Matches').contains(control)) return false;
    let source;try { source = sceneAnimationUsageSource(catalog, match); } catch { return false; }
    if (sourceLocationSelection(source.content, source, source.sourceRevision).status !== 'exact') return false;
    sourceView = { catalog, clipId, match, source }; el('SourceText').value = source.content.replace(/\r\n|\r/g, '\n');refresh();return locate();
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!enabled(context) || owner !== context.source || token !== context.usageToken || clipId && !exists(context)) { const selected=clipId;reset();owner=context.source;token=context.usageToken;if(selected)onSelectionChange(''); }
    const visible = current();container.hidden=!visible;container.dataset.clipId=clipId;container.setAttribute('aria-busy',String(state==='loading'));
    for(const [name,key] of [['Title','动画片段使用位置'],['Refresh','刷新已保存行为'],['Dismiss','收起使用位置'],['MatchesTitle','已保存行为的文字匹配'],['SourceTitle','上次读取的已保存原文'],['SourceLocate','重新定位参数'],['SourceDismiss','收起原文']])el(name).textContent=translate(key);
    el('Hint').textContent=translate('片段来自当前表单；文字匹配来自上次读取的同场景已保存行为。只匹配完整片段编号，不解析脚本、其他场景或未保存行为草稿；未发现匹配不代表可以安全移除。');
    const clip=context.clips?.find(clip=>clip.id===clipId);el('Clip').textContent=visible?translate('当前表单片段：{0} · {1}',clip.name,clipId):'';
    el('Refresh').disabled=!visible||state==='loading';el('Dismiss').disabled=!visible;
    if(listCatalog!==catalog||listClip!==clipId){listCatalog=catalog;listClip=clipId;matches=[];el('Matches').replaceChildren();
      for(const [index,match] of (catalog?.matches.filter(match=>match.clipId===clipId)||[]).entries()){
        const item=node('li'),binding=node('p'),parameter=node('p'),button=node('button');button.type='button';button.className='doc-btn doc-btn-ghost';button.id=`sceneAnimationUsageMatch${index}Source`;button.dataset.propertyPath=match.propertyPath;
        const captured=catalog,selected=clipId;button.addEventListener('click',()=>showSource(match,button,captured,selected));item.append(binding,parameter,button);el('Matches').append(item);matches.push({match,binding,parameter,button});
      }
    }
    for(const {match,binding,parameter,button} of matches){binding.textContent=translate('绑定 {0} · 实例 {1}',match.bindingId,match.instanceId);parameter.textContent=translate('参数 {0} · {1}',match.parameterName,match.propertyPath);button.textContent=translate('查看参数原文');button.disabled=!visible||state==='loading';}
    el('Status').dataset.status=state;el('Status').textContent=state==='loading'?translate('正在读取已保存行为中的动画片段文字匹配…'):state==='failed'?translate('无法读取使用位置；表单和审阅已保留，可刷新重试。'):catalog?catalog.behavior===null?translate('当前场景没有关联的已保存行为文档。'):matches.length?translate('上次读取找到 {0} 处完整编号文字匹配。',matches.length):translate('上次读取未在已保存行为参数中找到完整编号文字匹配。'):translate('尚未读取已保存行为。');
    el('BehaviorPath').textContent=catalog?.behavior?translate('已保存行为文档：{0}',catalog.behavior.sourcePath):'';
    if(sourceCurrent()){el('Source').hidden=false;el('SourcePath').textContent=translate('已保存行为文档：{0}',sourceView.source.sourcePath);el('SourceField').textContent=translate('参数 {0} · {1}',sourceView.match.parameterName,sourceView.source.propertyPath);}else if(sourceView)clearSource();
    el('SourceLocate').disabled=!sourceCurrent();el('SourceDismiss').disabled=!sourceCurrent();
  }
  async function read() {
    refresh();if(!current()||state==='loading')return false;
    const source=owner,selected=clipId,capturedToken=token,request=++sequence;
    const owns=()=>request===sequence&&current()&&owner===source&&token===capturedToken&&clipId===selected;
    clearSource();catalog=null;state='loading';refresh();
    try{const value=await getUsage(source);if(!owns())return false;if(!isSceneAnimationUsage(value)||!sceneAnimationUsageMatchSource(value,source))throw Error('Invalid animation usage snapshot.');catalog=value;state='ready';return true;}
    catch{if(owns())state='failed';return false;}finally{if(owns())refresh();}
  }
  function open(id){refresh();const context=getContext();if(!enabled(context)||!context.clips?.some(clip=>clip.id===id))return false;
    if(clipId!==id){sequence++;if(state==='loading')state='idle';clearSource();clipId=id;}refresh();onSelectionChange(clipId);container.scrollIntoView?.({block:'nearest'});if(!catalog&&state!=='loading')void read();return true;
  }
  el('Refresh').addEventListener('click',()=>void read());el('Dismiss').addEventListener('click',()=>{const selected=clipId;reset();onSelectionChange('',selected);});
  el('SourceLocate').addEventListener('click',locate);el('SourceDismiss').addEventListener('click',()=>{if(!sourceCurrent())return;clearSource();el('Refresh').focus();});refresh();
  return Object.freeze({open,refresh,reset,selectedClipId:()=>clipId,dispose(){if(disposed)return;reset();disposed=true;container.replaceChildren();}});
}
