from pathlib import Path
R=Path('/tmp/viento-scene3d-removal-71u64wrk/project');src=(R/'web/modules/app-scene3d-copy.js').read_text();s=src.replace('Copy','Removal').replace('copy','removal').replace('复制','移除')
a=s.index('  dialog.innerHTML =');b=s.index('\n  document.body.append(dialog);',a)
s=s[:a]+'''  dialog.innerHTML = `<header class="scene3d-removal-header"><h2 id="scene3dRemovalTitle" data-i18n="批量移除3D对象"></h2><button id="scene3dRemovalClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-removal-note" data-i18n="勾选要移除的对象，审阅待删除、保留对象和完整原文后应用到草稿；仍需普通保存。场景至少保留一个对象。"></p>
    <p id="scene3dRemovalPath" class="scene3d-removal-note"></p><p id="scene3dRemovalStatus" role="status" aria-live="polite"></p><p id="scene3dRemovalDiagnostic" class="scene3d-removal-diagnostic"></p>
    <section id="scene3dRemovalFields"><label class="scene3d-removal-search"><span data-i18n="按名称或UUID查找对象"></span><input id="scene3dRemovalSearch" type="search" autocomplete="off" spellcheck="false"></label>
      <div class="scene3d-removal-selection-controls"><p id="scene3dRemovalSelection" role="status" aria-live="polite"></p><button id="scene3dRemovalSelectResults" type="button" class="doc-btn doc-btn-ghost" data-i18n="选中当前结果"></button><button id="scene3dRemovalClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清空选择"></button></div>
      <p class="scene3d-removal-note" data-i18n="搜索只过滤列表；隐藏的已选对象仍参与移除。默认不选择任何对象，全选不会自动保留或删减某个对象。"></p><p id="scene3dRemovalNoResults" class="scene3d-removal-note" hidden data-i18n="没有匹配的对象。请修改名称或UUID筛选。"></p>
      <ul id="scene3dRemovalObjects" class="scene3d-removal-objects"></ul><p id="scene3dRemovalCapacity" role="status"></p><p id="scene3dRemovalBlocked" class="scene3d-removal-diagnostic"></p></section>
    <section id="scene3dRemovalReview" hidden><h3 data-i18n="3D批量移除审阅"></h3><p id="scene3dRemovalImpact" class="scene3d-removal-note"></p>
      <div class="scene3d-removal-comparison"><section><h4 data-i18n="待移除对象声明"></h4><pre id="scene3dRemovalBefore"></pre></section><section><h4 data-i18n="保留对象声明"></h4><pre id="scene3dRemovalAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dRemovalChangedPaths"></ul><details id="scene3dRemovalSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dRemovalSource" tabindex="0"></pre></details></section>
    <p class="scene3d-removal-note" data-i18n="移除只删除对象声明及必要分隔符，保留对象的顺序、身份和原文写法；不会删除素材。应用后仍需在编辑器保存。"></p>
    <footer class="scene3d-removal-footer"><button id="scene3dRemovalCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D移除"></button><button id="scene3dRemovalApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button><button id="scene3dRemovalCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;'''+s[b:]
s=s.replace('selected = new Set(), allocated = new Map(),','selected = new Set(),')
a=s.index('  const copies =');b=s.index('  const changed =',a)
s=s[:a]+'''  const ids = () => selectedObjects().map(object => object.instanceId);
  const consistentIntent = () => consistentSelection();
  const maximum = () => session ? session.model.objects.length - 1 : 0;
  const blocked = () => !session ? '' : session.model.objects.length === 1 ? '场景至少保留一个对象；当前只有一个对象。' : selected.size > maximum() ? '场景至少保留一个对象；请取消勾选一个对象。' : '';
'''+s[b:]
s=s.replace("const changed = () => selected.size > 0 || ['X', 'Y', 'Z'].some(axis => el(axis).value !== '0');","const changed = () => selected.size > 0;")
a=s.index('  const signature =');b=s.index('\n  const approvalMatches',a);s=s[:a]+"  const signature = () => JSON.stringify({ selected: ids(), query: el('Search').value, choices: rawChoices() });"+s[b:]
a=s.index('        invalidate(); try { if (checkbox.checked)');b=s.index('\n      });',a);s=s[:a]+"        invalidate(); if (checkbox.checked) selected.add(object.instanceId); else selected.delete(object.instanceId); refresh();"+s[b:]
a=s.index('  function renderMapping()');b=s.index('  function refresh()',a);s=s[:a]+s[b:]
s=s.replace("    for (const axis of ['X', 'Y', 'Z']) el(axis).disabled = locked;\n",'').replace('proposal.beforeObjects','proposal.removedObjects').replace('proposal.afterObjects','proposal.remainingObjects')
a=s.index("    el('Capacity').textContent =");b=s.index("    el('ChangedPaths')",a)
s=s[:a]+'''    el('Capacity').textContent = session ? t('对象数量') + '：' + session.model.objects.length + ' → ' + (session.model.objects.length - selected.size) + ' · ' + t('本次最多移除数量') + '：' + maximum() : ''; el('Blocked').textContent = t(blocked());
    el('Impact').textContent = proposal ? `${t('已选对象')}：${proposal.instanceIds.length} · ${t('保留对象数量')}：${proposal.remainingObjects.length}` : '';
'''+s[b:]
s=s.replace('renderObjects(); renderMapping();','renderObjects();').replace(' allocated.clear();','')
s=s.replace(" for (const axis of ['X', 'Y', 'Z']) el(axis).value = '0';",'')
a=s.index('  function offset()');b=s.index('  function check()',a);s=s[:a]+s[b:]
a=s.index('      const pairs =');b=s.index('    } catch (error)',a)
s=s[:a]+'''      const selectedIds = ids(), remainingObjects = session.model.objects.filter(object => !selected.has(object.instanceId));
      const candidate = createScene3DRemovalProposal(session.snapshot, { instanceIds: selectedIds });
      if (!current() || !consistentIntent() || signature() !== raw) return false;
      const paths = session.model.objects.flatMap((object, index) => selected.has(object.instanceId) ? ['/objects/' + index] : []);
      if (!isScene3DRemovalProposal(candidate) || candidate.kind !== 'scene3d-removal' || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.baseSourceRevision !== session.snapshot.baseSourceRevision || candidate.sourceRevision !== session.snapshot.sourceRevision
        || candidate.beforeContent !== session.snapshot.content || JSON.stringify(candidate.instanceIds) !== JSON.stringify(selectedIds)
        || JSON.stringify(candidate.removedObjects) !== JSON.stringify(selectedObjects()) || JSON.stringify(candidate.remainingObjects) !== JSON.stringify(remainingObjects)
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || JSON.stringify(candidate.changedPaths) !== JSON.stringify(paths)) throw Error('The complete removal proposal was not confirmed.');
      const afterModel = parseScene3DSource(candidate.afterContent).model;
      if (!remainingObjects.length || JSON.stringify(afterModel.objects) !== JSON.stringify(remainingObjects)) throw Error('The surviving object inventory was not confirmed.');
      proposal = candidate; approved = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); message = '3D移除已检查，请审阅待删除、保留对象及完整原文后应用。'; el('SourceReview').open = true; return true;
'''+s[b:]
s=s.replace('对象选择或新UUID映射已变化，请重新确认后检查。','对象选择已变化，请重新确认后检查。').replace('3D批量移除有误，请检查选择、UUID、容量和移除件位置后重试。','3D批量移除有误，请检查选择和保留对象后重试。').replace('请选择来源对象并设置移除件位移。','请选择要移除的对象；至少保留一个对象。').replace('正在读取3D移除对象…','正在读取可移除的3D对象…')
a=s.index("  el('SelectResults').addEventListener");b=s.index("  button.addEventListener",a)
s=s[:a]+'''  el('SelectResults').addEventListener('click', () => { if (!pending && current()) { invalidate(); for (const object of matches()) selected.add(object.instanceId); refresh(); } });
  el('ClearSelection').addEventListener('click', () => { if (!pending && current()) { selected.clear(); invalidate(); refresh(); } });
'''+s[b:]
assert 'allocate' not in s and 'Mapping' not in s and 'offset' not in s and 'copies' not in s
(R/'web/modules/app-scene3d-removal.js').write_text(s)
css=(R/'web/scene3d-copy.css').read_text().replace('scene3d-copy','scene3d-removal').replace('scene3dCopy','scene3dRemoval');(R/'web/scene3d-removal.css').write_text(css)
print('Independent removal controller and scoped CSS created')
