from pathlib import Path
import os
repo = Path(os.environ['VIENTO_TEST_REPO']).resolve()
driver_dir = Path(os.environ['VIENTO_TEST_DRIVER_DIR']).resolve()
source=(repo/'desktop/tests/native-smoke.py').read_text()
source=source.replace('from project_settings_navigation import exercise_project_settings_navigation', f"sys.path.insert(0, {str(repo / 'desktop/tests')!r})\nfrom project_settings_navigation import exercise_project_settings_navigation")
source=source.replace("ROOT = Path(__file__).resolve().parents[2]", f"ROOT = Path({str(repo)!r})")
needle='''        if animation_trial_case:
            exercise_animation_trial_case'''
assert source.count(needle)==1
insert='''        if os.environ.get('VIENTO_TEST_NONE_LABEL') == '1':
            # Isolated fixture prepared by the 2D workflow. No authoring is applied.
            before_labels = {str(file.relative_to(workspace)): hashlib.sha256(file.read_bytes()).hexdigest()
                for file in workspace.rglob('*') if file.is_file() and '.viento' not in file.relative_to(workspace).parts}
            wait_for(lambda: script('return !document.querySelector("#projectBuildBtn").disabled'))
            click('#projectBuildBtn')
            wait_for(lambda: script('return !document.querySelector("#projectBuildCreateScene").disabled'))
            click('#projectBuildCreateScene')
            wait_for(lambda: script('return !!document.querySelector("#sceneActor0Controls") && !document.querySelector("#sceneActor0Controls").disabled'))
            script('const s=document.querySelector("#sceneActor0Controls");s.value="none";s.dispatchEvent(new Event("change",{bubbles:true}));return true')
            labels = {}
            for language, expected in [('zh-CN', '无内置控制'), ('en', 'No built-in controls'), ('ja', '組み込み操作なし')]:
                script('import("/web/i18n/index.js").then(m=>m.applyLanguage(arguments[0]));return true', language)
                wait_for(lambda: script('return document.documentElement.lang') == language)
                observed = script('const s=document.querySelector("#sceneActor0Controls");return {value:s.value,label:s.selectedOptions[0].textContent}')
                assert observed == {'value': 'none', 'label': expected}, (language, observed)
                labels[language]=observed
                (screenshots / f'native-none-scene-{language}.png').write_bytes(base64.b64decode(command('GET', '/screenshot')))
            script('import("/web/i18n/index.js").then(m=>m.applyLanguage("zh-CN"));return true')
            wait_for(lambda: script('return document.documentElement.lang') == 'zh-CN')
            click('#sceneCreateCancel')
            wait_for(lambda: command('GET', '/alert/text'))
            command('POST', '/alert/accept', {})
            wait_for(lambda: not script('return document.querySelector("#sceneCreateDialog").open'))
            click('#projectBuildClose')
            wait_for(lambda: not script('return document.querySelector("#projectBuildDialog").open'))
            wait_for(lambda: script('return !!document.querySelector("#scriptCreateBtn") && !document.querySelector("#scriptCreateBtn").disabled'))
            click('#scriptCreateBtn')
            wait_for(lambda: script('return !!document.querySelector("#scriptCreateStarter") && !document.querySelector("#scriptCreateStarter").disabled'))
            script('const s=document.querySelector("#scriptCreateStarter");s.value="godot-character-intent";s.dispatchEvent(new Event("change",{bubbles:true}));return true')
            starter_source=script('return document.querySelector("#scriptCreateSource").textContent')
            assert '_intent.submit(' in starter_source, starter_source
            starters={}
            for language, expected in [('zh-CN', 'Godot / 角色运动意图'), ('en', 'Godot / Character movement intent'), ('ja', 'Godot / キャラクター移動意図')]:
                script('import("/web/i18n/index.js").then(m=>m.applyLanguage(arguments[0]));return true', language)
                wait_for(lambda: script('return document.documentElement.lang') == language)
                observed=script('const s=document.querySelector("#scriptCreateStarter");return {value:s.value,label:s.selectedOptions[0].textContent,description:document.querySelector("#scriptCreateDescription").textContent,source:document.querySelector("#scriptCreateSource").textContent}')
                assert observed['value']=='godot-character-intent' and observed['label']==expected and observed['source']==starter_source, (language, observed)
                assert 'none' in observed['description'], (language, observed)
                starters[language]={'label':observed['label'],'description':observed['description']}
                (screenshots / f'native-intent-starter-{language}.png').write_bytes(base64.b64decode(command('GET', '/screenshot')))
            script('import("/web/i18n/index.js").then(m=>m.applyLanguage("zh-CN"));return true')
            wait_for(lambda: script('return document.documentElement.lang') == 'zh-CN')
            click('#scriptCreateCancel')
            wait_for(lambda: command('GET', '/alert/text'))
            command('POST', '/alert/accept', {})
            wait_for(lambda: not script('return document.querySelector("#scriptCreateDialog").open'))
            after_labels = {str(file.relative_to(workspace)): hashlib.sha256(file.read_bytes()).hexdigest()
                for file in workspace.rglob('*') if file.is_file() and '.viento' not in file.relative_to(workspace).parts}
            assert before_labels == after_labels, 'Cancel changed author files'
            (screenshots / 'native-character-intent-labels.json').write_text(json.dumps({'labels':labels,'starters':starters,'authorFiles':len(before_labels)},ensure_ascii=False,indent=2))
            print('PASS: scene controls=none and character intent template translated in three languages; choice and draft preserved, cancel preserves author files', flush=True)
'''
source=source.replace(needle,insert+needle)
(driver_dir / 'native-label-smoke.py').write_text(source)
