"""Optional packaged WebKit regression for the recently connected 2D workflow.

Fixture files are prepared before native launch. Every authoring/build operation
below uses the authenticated editor's actual GUI; GETs only observe job state.
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
import uuid


def prepare_2d_workflow(workspace, repository):
    manifest = json.loads((workspace / 'workspace.json').read_text())
    document_root = manifest['paths']['documents']
    recipe_id, actor_id, asset_id = [str(uuid.uuid4()) for _ in range(3)]
    recipe_path = f'{document_root}/native-2d/recipe.json'
    actor_path = f'{document_root}/native-2d/traveler.md'
    recipe = json.loads((repository / 'examples/scene-composition/recipe.json').read_text())
    recipe['scene']['title'] = 'Native workflow recipe'
    for actor in recipe['fragments'][0]['actors']:
        actor['objectId'], actor['imageResourceId'] = actor_id, asset_id
    (workspace / recipe_path).parent.mkdir(parents=True)
    (workspace / recipe_path).write_bytes(('\ufeff' + json.dumps(recipe, ensure_ascii=False, indent=2).replace('\n', '\r\n') + '\r\n').encode())
    (workspace / actor_path).write_bytes('\ufeff# Native workflow traveler\r\n\r\n背景保留在角色本身。\r\n'.encode())
    image = (repository / 'examples/scene2d/assets/traveler.svg').read_bytes()
    image_path = 'assets/native-2d-traveler.svg'
    (workspace / image_path).write_bytes(image)
    descriptor_root = workspace / 'metadata/documents'
    descriptor_root.mkdir(parents=True, exist_ok=True)
    for identity, source, kind, relations, bindings in [
        (actor_id, actor_path, 'character', [], [dict(assetId=asset_id, role='sprite')]),
        (recipe_id, recipe_path, 'document', [dict(kind='references', targetId=actor_id, slot='')], [dict(assetId=asset_id, role='image')]),
    ]:
        (descriptor_root / f'{identity}.json').write_text(json.dumps(dict(format='viento-document', version=1,
            id=identity, sourcePath=source, documentType=kind, parserProfile='structured',
            relations=relations, assetBindings=bindings), indent=2) + '\n')
    assets = workspace / 'metadata/assets'
    assets.mkdir(parents=True, exist_ok=True)
    (assets / f'{asset_id}.json').write_text(json.dumps(dict(format='viento-asset', version=1, id=asset_id,
        name='Native traveler', kind='image', tags=[], location=dict(store='main', path='native-2d-traveler.svg'),
        content=dict(size=len(image), sha256=hashlib.sha256(image).hexdigest()), legacyPaths=[image_path]), indent=2) + '\n')
    return dict(recipeId=recipe_id, actorId=actor_id, assetId=asset_id, recipePath=recipe_path,
        scenePath=f'{document_root}/native-2d/materialized.json', recipe=recipe)


def exercise_2d_workflow(*, script, click, command, wait_for, workspace, screenshots, fixture, display_environment):
    report = dict(status='running', steps=[], jobs=[], screenshots=[], fixture={k: v for k, v in fixture.items() if k != 'recipe'}, limitations=[
        'OC, registered image and saved composition are prepared as fixture files before native startup. Their upstream GUI authoring is not exercised.',
        'Installed Linux Tauri/WebKit through tauri-driver and Xvfb. Form values dispatch input/change events; buttons and keyboard use WebDriver.',
        'Godot build and finite headless execution are exercised; rendered gameplay, author scripts, standalone distribution and other platforms are not claimed.',
    ])
    destination = workspace / fixture['scenePath']

    def author_tree():
        return {str(file.relative_to(workspace)): hashlib.sha256(file.read_bytes()).hexdigest()
                for file in workspace.rglob('*') if file.is_file() and '.viento' not in file.relative_to(workspace).parts}

    def enabled(selector):
        wait_for(lambda: script('const e=document.querySelector(arguments[0]);return e && !e.disabled && !e.hidden', selector))

    def fill(selector, value, event='input'):
        script('const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(arguments[2],{bubbles:true}));return true', selector, value, event)

    def value(selector):
        return script('return document.querySelector(arguments[0]).value', selector)

    def screenshot(name):
        (screenshots / name).write_bytes(base64.b64decode(command('GET', '/screenshot')))
        report['screenshots'].append(name)

    def service():
        script('window.native2dState=null;fetch("/api/project-build",{cache:"no-store"}).then(async r=>{if(!r.ok)throw Error(r.status);const p=await r.json();window.native2dState={data:p.data||p}}).catch(e=>window.native2dState={error:String(e)});return true')
        state = wait_for(lambda: script('return window.native2dState'))
        assert 'error' not in state, state
        return state['data']

    def save():
        enabled('#docSaveBtn')
        click('#docSaveBtn')
        wait_for(lambda: script('return !document.querySelector("#docSaveBtn").disabled && !document.querySelector("#docEditDirtyIndicator").classList.contains("is-unsaved")'))

    def perform(selector, kind):
        previous = (service().get('job') or {}).get('id')
        enabled(selector)
        click(selector)
        def finished():
            job = service().get('job')
            return job if job and job['id'] != previous and job['kind'] == kind and job['status'] not in ['running', 'queued'] else False
        job = wait_for(finished, timeout=120)
        report['jobs'].append(job)
        return job

    def open_source(path):
        fill('#searchInput', '')
        # The list key is the generated index identity, not sourcePath.
        selector = '#docList button[data-path-key][title=' + json.dumps(Path(path).stem) + ']'
        wait_for(lambda: script('return !!document.querySelector(arguments[0])', selector))
        click(selector)
        enabled('#docEditBtn')
        if not script('return document.querySelector("#workspaceShell").classList.contains("is-writing")'):
            click('#docEditBtn')
        if script('return !!document.querySelector("#docEditSourceModeBtn").offsetParent'):
            enabled('#docEditSourceModeBtn')
            click('#docEditSourceModeBtn')
        wait_for(lambda: script('const e=document.querySelector("#docSourceEditor");return !e.disabled && !e.readOnly'))

    def replace_literal(needle, replacement):
        if script('return document.querySelector("#sourceSearchPanel").hidden'):
            enabled('#sourceSearchOpen')
            click('#sourceSearchOpen')
        fill('#sourceSearchQuery', needle)
        fill('#sourceSearchReplacement', replacement)
        wait_for(lambda: script('return document.querySelector("#sourceSearchStatus").dataset.count === "1"'))
        click('#sourceSearchNext')
        enabled('#sourceSearchReplace')
        before = value('#docSourceEditor')
        click('#sourceSearchReplace')
        expected = before.replace(needle, replacement, 1)
        wait_for(lambda: value('#docSourceEditor') == expected)
        assert script('return document.querySelector("#docEditDirtyIndicator").classList.contains("is-unsaved")')
        return before, expected

    def history_state():
        return script('const e=document.querySelector("#docSourceEditor");return {undo:document.queryCommandEnabled("undo"),redo:document.queryCommandEnabled("redo"),focus:document.activeElement.id,speed:e.value.match(/"speed"\\s*:\\s*([^,\\n]+)/)?.[1],events:window.native2dEditEvents||[]}')

    def physical_key(combination):
        tool = os.environ.get('VIENTO_TEST_XDOTOOL') or shutil.which('xdotool')
        assert tool, 'The native workflow needs xdotool for physical keyboard verification'
        environment = display_environment()
        window = subprocess.check_output([tool, 'getwindowfocus'], env=environment, text=True, timeout=10).strip()
        title = subprocess.check_output([tool, 'getwindowname', window], env=environment, text=True, timeout=10).strip()
        assert 'Viento Studio' in title, title
        subprocess.run([tool, 'windowfocus', '--sync', window, 'key', '--clearmodifiers', combination], env=environment, check=True, timeout=10)
        report.setdefault('physicalKeys', []).append(dict(key=combination, window=window, title=title))

    initial = author_tree()
    report['initialAuthorFiles'] = initial
    try:
        command('POST', '/window/rect', dict(width=1440, height=1100))
        enabled('#projectBuildBtn')
        click('#projectBuildBtn')
        enabled('#projectBuildTabPreview')
        click('#projectBuildTabPreview')
        fill('#projectBuildScene', fixture['recipeId'], 'change')
        enabled('#projectBuildMaterialize')
        click('#projectBuildMaterialize')
        enabled('#sceneMaterializeCheck')
        fill('#sceneMaterializeName', 'Native generated scene')
        types = script('return [...document.querySelector("#sceneMaterializeType").options].map(o=>o.value)')
        fill('#sceneMaterializeType', 'document' if 'document' in types else types[0], 'change')
        fill('#sceneMaterializePath', fixture['scenePath'])
        click('#sceneMaterializeCheck')
        enabled('#sceneMaterializeSave')
        reviewed = script('return document.querySelector("#sceneMaterializeSource").textContent')
        expanded = json.loads(reviewed)
        assert expanded['format'] == 'viento-scene2d' and expanded['schemaVersion'] == 3
        expected_ids = sorted(identity for placement in fixture['recipe']['placements'] for identity in placement['actorIds'].values())
        assert sorted(actor['instanceId'] for actor in expanded['actors']) == expected_ids
        assert len(expanded['groups']) == 4
        assert author_tree() == initial, 'Review must not write author files'
        screenshot('native-2d-materialize-review.png')
        click('#sceneMaterializeCancel')
        assert '丢弃' in wait_for(lambda: command('GET', '/alert/text'))
        command('POST', '/alert/accept', {})
        wait_for(lambda: not script('return document.querySelector("#sceneMaterializeDialog").open'))
        assert author_tree() == initial, 'Cancel must preserve all author files'
        click('#projectBuildMaterialize')
        enabled('#sceneMaterializeCheck')
        fill('#sceneMaterializeName', 'Native generated scene')
        fill('#sceneMaterializeType', 'document' if 'document' in types else types[0], 'change')
        fill('#sceneMaterializePath', fixture['scenePath'])
        click('#sceneMaterializeCheck')
        enabled('#sceneMaterializeSave')
        reviewed = script('return document.querySelector("#sceneMaterializeSource").textContent')
        click('#sceneMaterializeSave')
        wait_for(lambda: destination.is_file() and destination.read_bytes() == reviewed.encode())
        enabled('#sceneMaterializeClose')
        click('#sceneMaterializeClose')
        wait_for(lambda: bool(value('#projectBuildScene')) and value('#projectBuildScene') != fixture['recipeId'])
        scene_id = value('#projectBuildScene')
        assert scene_id != fixture['recipeId']
        report['sceneId'] = scene_id
        after_create = author_tree()
        assert sorted(set(after_create) - set(initial)) == sorted([fixture['scenePath'], f'metadata/documents/{scene_id}.json'])
        assert all(after_create.get(name) == digest for name, digest in initial.items())
        report['steps'].append('GUI preview of registered recipe → review four instances/four groups → cancel preserves files → save independent Scene2D and descriptor with preserved instance IDs.')
        click('#projectBuildClose')
        open_source(fixture['scenePath'])
        script('''window.native2dEditEvents=[];for(const type of ['keydown','beforeinput','input'])document.addEventListener(type,event=>{if(event.target?.id==='docSourceEditor')native2dEditEvents.push({type,key:event.key,ctrl:event.ctrlKey,shift:event.shiftKey,trusted:event.isTrusted,inputType:event.inputType,defaultPrevented:event.defaultPrevented});},true);return true''')
        before, invalid = replace_literal('"speed": 160', '"speed": -1')
        assert before == reviewed and destination.read_bytes() == reviewed.encode()
        # Native WebKit undo/redo must own the replacement transaction.
        script('document.querySelector("#docSourceEditor").focus();return true')
        report['history'] = []
        for redo, expected in [(False, before), (True, invalid)]:
            observed = dict(action='redo' if redo else 'undo', before=history_state())
            actions = [{'type': 'keyDown', 'value': '\ue009'}]
            if redo:
                actions.append({'type': 'keyDown', 'value': '\ue008'})
            actions.extend([{'type': 'keyDown', 'value': 'z'}, {'type': 'keyUp', 'value': 'z'}])
            if redo:
                actions.append({'type': 'keyUp', 'value': '\ue008'})
            actions.append({'type': 'keyUp', 'value': '\ue009'})
            command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': actions}]})
            time.sleep(.2)
            observed['afterWebDriver'] = history_state()
            observed['webDriverWorked'] = value('#docSourceEditor') == expected
            report['history'].append(observed)
            if not observed['webDriverWorked']:
                physical_key('ctrl+shift+z' if redo else 'ctrl+z')
                time.sleep(.2)
                observed['afterPhysical'] = history_state()
                observed['physicalWorked'] = value('#docSourceEditor') == expected
            wait_for(lambda: value('#docSourceEditor') == expected)
        for combination, expected in [('ctrl+z', before), ('ctrl+shift+z', invalid)]:
            physical_key(combination)
            wait_for(lambda: value('#docSourceEditor') == expected)
        report['physicalHistoryRoundtrip'] = dict(exactUndo=True, exactRedo=True, final=history_state())
        screenshot('native-2d-source-search.png')
        click('#sourceSearchClose')
        save()
        assert destination.read_bytes() == invalid.encode()
        click('#projectBuildBtn')
        enabled('#projectBuildTabBuild')
        click('#projectBuildTabBuild')
        fill('#projectBuildScene', scene_id, 'change')
        failed = perform('#projectBuildPlan', 'plan')
        assert failed['status'] == 'failed', failed
        diagnostic = next(d for d in failed['diagnostics'] if d['code'] == 'build_actor_value' and d.get('propertyPath') == '/actors/0/speed')
        assert diagnostic['sourcePath'] == fixture['scenePath'] and diagnostic['sourceRange']['exact']
        fill('#projectBuildProblemsSearch', '/actors/0/speed')
        wait_for(lambda: script('return [...document.querySelectorAll("#projectBuildDiagnostics li.build-diagnostic")].filter(e=>!e.hidden).length === 1'))
        fill('#projectBuildProblemsSeverity', 'warning', 'change')
        assert script('return !document.querySelector("#projectBuildProblemsEmpty").hidden')
        fill('#projectBuildProblemsSeverity', 'error', 'change')
        script('document.querySelector("#projectBuildProblems").scrollIntoView({block:"center"});return true')
        screenshot('native-2d-task-problems.png')
        click('#projectBuildDiagnostics li[data-code="build_actor_value"] button')
        wait_for(lambda: script('return !document.querySelector("#projectBuildDialog").open && !document.querySelector("#sourceDiagnosticPanel").hidden'))
        assert script('const e=document.querySelector("#docSourceEditor");return e.value.slice(e.selectionStart,e.selectionEnd)') == '-1'
        assert script('return document.querySelector("#sourceDiagnosticPanel").dataset.status') == 'exact'
        _, corrected = replace_literal('"speed": -1', '"speed": 160')
        assert corrected == reviewed
        assert script('return document.querySelector("#sourceDiagnosticPanel").dataset.status') == 'changed'
        screenshot('native-2d-diagnostic-repair.png')
        click('#sourceSearchClose')
        save()
        assert destination.read_bytes() == reviewed.encode()
        report['steps'].append('Native search replacement → WebKit undo/redo → explicit save → failed static plan → problem filters → exact source navigation → replace repair → explicit save, restoring reviewed scene bytes.')
        click('#projectBuildBtn')
        enabled('#projectBuildTabBuild')
        click('#projectBuildTabBuild')
        fill('#projectBuildScene', scene_id, 'change')
        fill('#projectBuildProblemsSearch', '')
        fill('#projectBuildProblemsSeverity', 'all', 'change')
        for selector, kind in [('#projectBuildPlan', 'plan'), ('#projectBuildGenerate', 'build'), ('#projectBuildHeadless', 'run')]:
            job = perform(selector, kind)
            assert job['status'] == 'succeeded', job
        finished = next(event for event in job['events'] if event['event'] == 'finished')
        assert sorted(actor['instanceId'] for actor in finished['actors']) == expected_ids
        report['runtimeActors'] = finished['actors']
        wait_for(lambda: script('return document.querySelector("#projectBuildStatus").textContent.includes("已完成") && document.querySelector("#projectBuildRuntimePhase").textContent.includes("结束位置") && !document.querySelector("#projectBuildHeadless").disabled'))
        rendered_ids = script('return [...document.querySelectorAll("#projectBuildRuntimeObjectList > li")].map(e=>e.dataset.instanceId)')
        assert sorted(rendered_ids) == expected_ids
        report['visibleRuntime'] = dict(status=script('return document.querySelector("#projectBuildStatus").textContent'),
            phase=script('return document.querySelector("#projectBuildRuntimePhase").textContent'), instanceIds=rendered_ids)
        script('document.querySelector("#projectBuildRuntimeObjects").scrollIntoView({block:"start"});return true')
        screenshot('native-2d-godot-run.png')
        assert author_tree() == after_create, 'Build and headless execution must preserve all author files'
        report['finalAuthorFiles'] = author_tree()
        report['steps'].append('GUI plan → Godot project generation → real finite headless run; all four instance IDs retained and all author files unchanged by execution.')
        click('#projectBuildClose')
        if script('return document.querySelector("#workspaceShell").classList.contains("is-writing")'):
            click('#docEditBtn')
        fill('#searchInput', '')
        command('POST', '/window/rect', dict(width=1280, height=900))
        report['status'] = 'passed'
        print('PASS: installed WebKit recipe → independent Scene2D → native find/replace + undo/redo → failed task → filtered exact source repair → Godot generation/headless → author bytes preserved', flush=True)
    except Exception as error:
        report['status'], report['error'] = 'failed', repr(error)
        try:
            report['page'] = script('return document.body.innerText')
            report['historyAtFailure'] = history_state()
            if report.get('history') and report['history'][-1]['action'] == 'undo':
                # Diagnostic only: an explicit DOM history command cannot make
                # a failed user shortcut pass. Restore its invalid draft, record
                # exact bytes, and propagate the original failure below.
                experiment = dict(diagnosticOnly=True, guiPassed=False)
                experiment['undo'] = script('const e=document.querySelector("#docSourceEditor");e.focus();const result=document.execCommand("undo");return {result,exact:e.value===arguments[0],undo:document.queryCommandEnabled("undo"),redo:document.queryCommandEnabled("redo")}', before)
                experiment['redo'] = script('const e=document.querySelector("#docSourceEditor");e.focus();const result=document.execCommand("redo");return {result,exact:e.value===arguments[0],undo:document.queryCommandEnabled("undo"),redo:document.queryCommandEnabled("redo")}', invalid)
                report['nativeStackDiagnostic'] = experiment
            screenshot('native-2d-failure.png')
        except Exception:
            pass
        raise
    finally:
        (screenshots / 'native-2d-workflow.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
