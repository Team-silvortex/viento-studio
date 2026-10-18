import assert from 'node:assert/strict';
import { revealSourceOffset } from '/home/chiharukiryu/cdev/viento-studio/web/modules/app-source-reveal.js';
let checked=0;
for(const language of ['', 'ja', 'zh-Hant', null]) {
  let mirror, removed=0, closest=0;
  const attrs={};
  const document={defaultView:{getComputedStyle:()=>({fontFamily:'monospace',fontSize:'13px',lineHeight:'19.5px',whiteSpace:'pre-wrap'})},
    createElement:()=>mirror={style:{},setAttribute:(key,value)=>{attrs[key]=value;},set textContent(value){this.firstChild={data:value};},getBoundingClientRect:()=>({top:0,left:0}),remove:()=>removed++},
    body:{append(){}}, createRange:()=>({setStart(){},setEnd(){},getBoundingClientRect:()=>({top:80,left:0,height:19.5})})};
  const value='音🙂\nabcdef';
  const textarea={value,ownerDocument:document,clientWidth:300,clientHeight:120,selectionStart:2,selectionEnd:5,scrollTop:0,scrollLeft:0,
    closest(selector){assert.equal(selector,'[lang]');closest++;return language===null?null:{getAttribute(name){assert.equal(name,'lang');return language;}}}};
  assert.equal(revealSourceOffset(textarea,value,5),true);
  assert.equal(closest,1); assert.equal(removed,1); assert.equal(attrs['aria-hidden'],'true');
  if(language===null) assert.equal(Object.hasOwn(attrs,'lang'),false); else assert.equal(attrs.lang,language);
  assert.equal(textarea.value,value); assert.deepEqual([textarea.selectionStart,textarea.selectionEnd],[2,5]);
  checked++;
}
console.log(JSON.stringify({ok:true,nearestLanguageCases:checked,explicitEmptyPreserved:true,absentLanguageNotInvented:true,sourceAndSelectionUnchanged:true,mirrorAlwaysRemoved:true}));
