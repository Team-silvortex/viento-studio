import { isSceneBehaviorAnimationClips, sceneBehaviorAnimationClipsMatchSource, sceneBehaviorAnimationClipValue } from '../../engine/scene-animation-directory.mjs';
import { t } from '../i18n/index.js';

// Read-only discovery and explicit scalar insertion. The behavior form owns
// source identity, parameter rows, review and the ordinary draft/Save workflow.
export function setupSceneBehaviorAnimationClips({ container, getContext = () => ({}), getAnimationClips, onUse = () => {}, translate = t } = {}) {
  const document = container.ownerDocument, node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const load = node('button'), hint = node('p'), status = node('p'), path = node('p');
  load.id = 'sceneBehaviorsLoadAnimationClips'; load.type = 'button'; load.className = 'doc-btn doc-btn-ghost';
  status.id = 'sceneBehaviorsAnimationClipsStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); path.id = 'sceneBehaviorsAnimationClipsPath';
  for (const element of [hint, status, path]) element.className = 'scene-behaviors-note';
  container.classList.add('scene-behaviors-animation-tools'); container.append(load, hint, status, path);
  let disposed = false, sequence = 0, loading = false, catalog = null, message = '', owner = null, rows = null;
  const choices = new Map(), pickers = new Map();
  const available = context => context.available === true && typeof getAnimationClips === 'function';
  const valid = context => !disposed && context.current === true && available(context);
  const matchesScene = (value, context) => ['objectId', 'sourcePath', 'sourceRevision'].every(key => value.scene[key] === context.scene?.[key]);
  const usable = context => valid(context) && isSceneBehaviorAnimationClips(catalog) && sceneBehaviorAnimationClipsMatchSource(catalog, context.source) && matchesScene(catalog, context);
  const rowCurrent = (row, picker) => { const context = getContext(); return usable(context) && !context.pending && !loading && context.rows?.includes(row) && row.type.value === 'string' && row.wrapper.contains(picker.wrapper); };
  function reset() { sequence++; loading = false; catalog = null; message = ''; owner = null; rows = null; choices.clear(); for (const picker of pickers.values()) picker.wrapper.remove(); pickers.clear(); }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!valid(context) || owner !== context.source) { reset(); owner = context.source; }
    if (rows !== context.rows) { sequence++; loading = false; if (message === '正在读取已保存的场景动画片段…') message = ''; rows = context.rows; }
    container.hidden = !available(context) || !context.source;
    container.setAttribute('aria-busy', String(loading)); load.disabled = !valid(context) || Boolean(context.pending) || loading;
    load.textContent = translate('读取动画片段'); hint.textContent = translate('将已保存的动画片段编号填入文本参数；不会识别参数用途、执行动画或保护后续引用。');
    const ready = usable(context), clips = ready ? catalog.clips : [];
    status.textContent = translate(message); status.dataset.status = loading ? 'loading' : ready ? catalog.status : message ? 'error' : 'idle';
    path.textContent = ready && catalog.manifest ? translate('动画来源：{0}', catalog.manifest.sourcePath) : '';
    for (const [row, picker] of pickers) if (!context.rows?.includes(row) || row.type.value !== 'string') { picker.wrapper.remove(); pickers.delete(row); }
    for (const row of context.rows || []) {
      if (row.type.value !== 'string') continue;
      let picker = pickers.get(row);
      if (!picker && clips.length) {
        const wrapper = node('div'), label = node('label'), caption = node('span'), select = node('select'), use = node('button'), detail = node('p');
        wrapper.className = 'scene-behaviors-animation-picker'; use.type = 'button'; use.className = 'doc-btn doc-btn-ghost'; detail.className = 'scene-behaviors-note';
        select.id = `sceneBehaviorsParam${row.index}AnimationClip`; use.id = `sceneBehaviorsParam${row.index}UseAnimationClip`; detail.id = `sceneBehaviorsParam${row.index}AnimationClipDetail`;select.setAttribute('aria-describedby', detail.id);
        label.append(caption, select);wrapper.append(label,use,detail);row.wrapper.append(wrapper);picker = {wrapper,caption,select,use,detail,signature:''};pickers.set(row,picker);
        select.addEventListener('change', () => { if (!rowCurrent(row,picker)) return; choices.set(row.identity,select.value); refresh(); });
        use.addEventListener('click', () => {
          if (!rowCurrent(row,picker) || !select.value || choices.get(row.identity) !== select.value) return;
          try { const value = sceneBehaviorAnimationClipValue(catalog, select.value); if (rowCurrent(row,picker)) onUse(row,value); }
          catch { catalog = null; message = '场景动画片段已变化，请重新读取；参数与审阅保持不变。'; refresh(); }
        });
      }
      if (!picker) continue;
      picker.wrapper.hidden = !clips.length;
      picker.caption.textContent = translate('可选动画片段'); picker.use.textContent = translate('填入动画片段编号');
      const signature = JSON.stringify([clips,translate('请选择动画片段'),translate('动画片段：{0} · {1}–{2} 秒 · {3}')]);
      if (picker.signature !== signature) {
        picker.signature = signature; const choice = choices.get(row.identity) || ''; picker.select.replaceChildren();
        for (const [id,text] of [['',translate('请选择动画片段')],...clips.map(clip=>[clip.clipId,translate('动画片段：{0} · {1}–{2} 秒 · {3}',clip.name,clip.startSeconds,clip.endSeconds,clip.clipId)])]) { const option=node('option',text);option.value=id;picker.select.append(option); }
        picker.select.value=clips.some(clip=>clip.clipId===choice)?choice:'';choices.set(row.identity,picker.select.value);
      }
      const selection=clips.find(clip=>clip.clipId===picker.select.value);
      picker.detail.textContent=selection?translate('动画片段：{0} · {1}–{2} 秒 · {3}',selection.name,selection.startSeconds,selection.endSeconds,selection.clipId):'';
      picker.select.disabled=!rowCurrent(row,picker);picker.use.disabled=!rowCurrent(row,picker)||!selection;
    }
  }
  async function read() {
    const context=getContext();if (!valid(context)||context.pending||loading)return false;
    refresh(); const request=++sequence, source=context.source, requestedRows=context.rows;
    const owns=()=>{const next=getContext();return request===sequence&&valid(next)&&next.source===source&&next.rows===requestedRows;};
    loading=true;message='正在读取已保存的场景动画片段…';refresh();
    try { const value=await getAnimationClips(source);if(!owns())return false;
      if(!isSceneBehaviorAnimationClips(value)||!sceneBehaviorAnimationClipsMatchSource(value,source)||!matchesScene(value,getContext()))throw Error('Invalid scene animation directory.');
      catalog=value;message=value.status==='empty'?'当前场景未关联已保存动画；文本参数仍可直接编辑。':!value.clips.length?'已保存动画没有命名片段；可在动画编辑器添加片段后重新读取。':'选择片段后，点击“填入动画片段编号”才会修改参数。';return true;
    }catch{if(owns()){catalog=null;message='无法读取动画片段；输入和审阅已保留，可以重试。';}return false;}
    finally{if(owns()){loading=false;refresh();}}
  }
  load.addEventListener('click',()=>void read());refresh();
  return Object.freeze({refresh,reset,dispose(){if(disposed)return;reset();disposed=true;container.replaceChildren();}});
}
