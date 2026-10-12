from pathlib import Path
import json,re
R=Path('/tmp/viento-scene3d-removal-71u64wrk/project')
entries={
'批量移除3D对象':('Remove multiple 3D objects','3Dオブジェクトを一括削除'),
'勾选要移除的对象，审阅待删除、保留对象和完整原文后应用到草稿；仍需普通保存。场景至少保留一个对象。':('Select objects to remove, review the removed and surviving declarations and complete source, then apply to the draft. Save normally afterward. Keep at least one object.','削除するオブジェクトを選び、削除対象・残す宣言・全文を確認して下書きに適用します。その後通常の保存が必要です。最低1個を残してください。'),
'搜索只过滤列表；隐藏的已选对象仍参与移除。默认不选择任何对象，全选不会自动保留或删减某个对象。':('Search only filters the list; hidden selections still participate. Nothing is selected initially. Selecting all never silently keeps or drops an object.','検索は一覧のみを絞り込み、非表示の選択対象も削除に含みます。初期選択はありません。全選択しても対象を自動調整しません。'),
'3D批量移除审阅':('Review bulk 3D removal','3D一括削除の確認'),
'待移除对象声明':('Declarations to remove','削除するオブジェクトの宣言'),
'保留对象声明':('Surviving declarations','残すオブジェクトの宣言'),
'移除只删除对象声明及必要分隔符，保留对象的顺序、身份和原文写法；不会删除素材。应用后仍需在编辑器保存。':('Removal deletes object declarations and required separators, preserving surviving order, identity and source spelling. Assets remain. Save in the editor after applying.','オブジェクト宣言と必要な区切りだけを削除し、残す対象の順序・識別子・元の記法を保ちます。素材は残ります。適用後はエディターで保存してください。'),
'检查3D移除':('Check 3D removal','3D削除を確認'),
'场景至少保留一个对象；当前只有一个对象。':('Keep at least one object; this scene currently has only one.','最低1個を残す必要があります。現在のシーンには1個だけあります。'),
'场景至少保留一个对象；请取消勾选一个对象。':('Keep at least one object; deselect one to continue.','最低1個を残す必要があります。1個の選択を解除してください。'),
'3D批量移除尚未应用到原文草稿。':('Bulk 3D removal has not been applied to the source draft.','3D一括削除はまだ原文の下書きに適用されていません。'),
'原文草稿已变化，请关闭后重新打开3D批量移除。':('The source draft changed. Close and reopen bulk 3D removal.','原文の下書きが変更されました。閉じて3D一括削除を開き直してください。'),
'当前核心不支持3D批量移除，原文编辑和其他3D功能仍可使用。':('This core does not support bulk 3D removal. Source editing and other 3D features remain available.','現在のコアは3D一括削除に未対応です。原文編集と他の3D機能は使用できます。'),
'当前核心不支持3D批量移除':('Bulk 3D removal is unavailable in this core','現在のコアは3D一括削除に未対応です'),
'本次最多移除数量':('Maximum removals this time','今回の削除上限'),
'保留对象数量':('Surviving object count','残すオブジェクト数'),
'丢弃本次3D批量移除？原文草稿不会改变。':('Discard this bulk 3D removal? The source draft will stay unchanged.','今回の3D一括削除を破棄しますか？原文の下書きは変更されません。'),
'正在读取可移除的3D对象…':('Loading 3D objects for removal…','削除可能な3Dオブジェクトを読み込み中…'),
'请选择要移除的对象；至少保留一个对象。':('Select objects to remove; keep at least one.','削除する対象を選んでください。最低1個は残してください。'),
'对象选择已变化，请重新确认后检查。':('The object selection changed. Confirm it again before checking.','オブジェクトの選択が変更されました。再確認してからチェックしてください。'),
'3D移除已检查，请审阅待删除、保留对象及完整原文后应用。':('Removal checked. Review the removed and surviving declarations and complete source before applying.','削除を確認しました。削除対象・残す対象・全文を確認してから適用してください。'),
'3D批量移除有误，请检查选择和保留对象后重试。':('Bulk removal is invalid. Check the selection and surviving objects, then retry.','一括削除が無効です。選択と残す対象を確認して再試行してください。'),
'正在应用3D批量移除到原文草稿…':('Applying bulk 3D removal to the source draft…','3D一括削除を原文の下書きに適用中…'),
'3D批量移除未确认应用。修改保留，请核对原文后重试。':('Bulk removal was not confirmed. Your changes remain; verify the source and retry.','一括削除の適用を確認できませんでした。変更内容は保持されています。原文を確認して再試行してください。'),
'3D批量移除已应用到原文草稿；尚未保存。':('Bulk 3D removal applied to the source draft; not saved yet.','3D一括削除を原文の下書きに適用しました。まだ保存されていません。'),
'3D批量移除已应用；文本与已保存版本一致。':('Bulk 3D removal applied; the text matches the saved version.','3D一括削除を適用しました。テキストは保存済みの版と一致しています。'),
}
for i,lang in enumerate(['en','ja']):
 p=R/f'web/i18n/{lang}.js';s=p.read_text();assert s.endswith('};\n');new=''.join('  '+json.dumps(k,ensure_ascii=False)+': '+json.dumps(v[i],ensure_ascii=False)+',\n' for k,v in entries.items());p.write_text(s[:-3]+new+'};\n')
p=R/'web/scene3d-removal.css';s=p.read_text();s='\n'.join(line for line in s.splitlines() if 'scene3d-removal-offset' not in line and ('scene3d-removal-axes' not in line or line.startswith('@media')) and 'scene3d-removal-mapping' not in line)+'\n';s=s.replace(',.scene3d-removal-dialog input[type=number]','').replace(' .scene3d-removal-axes { gap:6px; }','');p.write_text(s)
print('Added',len(entries),'English/Japanese removal keys; removed unused CSS')
