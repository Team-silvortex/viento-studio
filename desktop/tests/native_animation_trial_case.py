"""Optional installed Tauri/WebKit manual-animation regression.

Call only inside native-smoke.py's isolated workspace/editor session. This module
uses the served installed app, never a source-tree Node service or injected domain
implementation. Inputs dispatch UI events; buttons use the host WebDriver click.
File input and export Blob bytes are explicitly instrumented transport checks,
not claims about the operating-system file chooser or a saved download.
"""
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def exercise_animation_trial_case(*, script, click, command, wait_for,
                                  workspace, screenshots, display_environment=None):
    workspace, screenshots = Path(workspace), Path(screenshots)
    manifest = json.loads((workspace / 'workspace.json').read_text())
    roots = [workspace / manifest['paths'][name] for name in ['documents', 'templates', 'metadata']]
    roots += [workspace / store['path'] for store in manifest.get('assetStores', {}).values() if 'path' in store]
    report = dict(status='running', startedAt=datetime.now(timezone.utc).isoformat(), harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), steps=[], screenshots=[], layout={}, limitations=[
        'Actual installed Linux Tauri/WebKit under tauri-driver/Xvfb, using the host-created disposable workspace and isolated XDG paths.',
        'This tests the new-script form with a local two-state table; it cancels creation without saving or registering an author document.',
        'Manual event/assumed-completion predictions are not runtime observations. This extension does not execute Godot, prove actual delivery, or test saved-script re-editing.',
        'Inputs dispatch DOM input/change; buttons use WebDriver. Language refresh uses the installed i18n module; IME is a synthetic guard check, not an actual IME device.',
        'Blob export and File input are scoped front-end transport checks. Native save/open dialogs and on-disk downloads are not claimed.',
        'The production editor window has a 760px minimum width. This extension records the actual native narrow viewport; it does not claim a 390px native viewport.',
    ])
    prefix = '#animationStateScript'
    p, c, e = prefix + 'EventPreview', prefix + 'EventPreviewCase', prefix + 'EventPreviewCaseEditor'
    original_language = None

    def author_tree():
        files = {workspace / 'workspace.json'}
        for root in roots:
            if root.exists():
                files.update(file for file in root.rglob('*') if file.is_file())
        return {str(file.relative_to(workspace)): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(files)}

    def enabled(selector):
        return wait_for(lambda: script('const e=document.querySelector(arguments[0]);return !!e && !e.disabled && !e.hidden', selector))

    def press(selector):
        enabled(selector)
        script('document.querySelector(arguments[0]).scrollIntoView({block:"center"});return true', selector)
        click(selector)

    def fill(selector, value, event='input'):
        script('const e=document.querySelector(arguments[0]);if(!e)throw Error(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(arguments[2],{bubbles:true}));return true', selector, value, event)

    def value(selector):
        return script('return document.querySelector(arguments[0]).value', selector)

    def text(selector):
        return script('return document.querySelector(arguments[0]).textContent', selector)

    def hidden(selector):
        return script('return document.querySelector(arguments[0]).hidden', selector)

    def disabled(selector):
        return script('return document.querySelector(arguments[0]).disabled', selector)

    def history_count():
        return script('return document.querySelector(arguments[0]).children.length', p + 'HistoryList')

    def case_statuses():
        return script('return Array.from(document.querySelector(arguments[0]).children,n=>n.dataset.status)', c + 'Steps')

    def screenshot(name):
        (screenshots / name).write_bytes(base64.b64decode(command('GET', '/screenshot')))
        report['screenshots'].append(name)

    def run_sample():
        press(p + 'Run')
        assert not hidden(p + 'Result')
        return script('return Array.from(document.querySelector(arguments[0]).children,n=>({status:n.dataset.status,leaves:Array.from(n.querySelectorAll(".animation-state-event-preview-leaf"),e=>({status:e.dataset.status,text:e.textContent}))}))', p + 'Candidates')

    def apply_case():
        press(e + 'Check')
        press(e + 'Apply')
        assert hidden(e + 'Panel') and not hidden(c + 'Loaded')
        assert hidden(c + 'Result'), 'Apply must not run the case'

    def check_author_unchanged():
        assert author_tree() == initial, 'Manual editing must not write author files'
        assert text('#scriptCreateSource') == reviewed, 'Manual samples/cases must not modify source review'
        assert not disabled('#scriptCreateApply'), 'Manual samples/cases must not revoke valid source approval'
        assert value('#docSourceEditor') == original_source, 'Manual case editing must not replace the author buffer'

    def language(code):
        script('window.__nativeTrialLanguage=null;import("/web/i18n/index.js").then(m=>{m.applyLanguage(arguments[0]);window.__nativeTrialLanguage={ok:true}}).catch(e=>window.__nativeTrialLanguage={error:String(e)});return true', code)
        state = wait_for(lambda: script('return window.__nativeTrialLanguage'))
        assert state.get('ok'), state
        wait_for(lambda: script('return document.documentElement.lang===arguments[0]', code))

    def export_blob(selector):
        # Capture only this fixed-name anchor. Prevent its default here to avoid
        # downloads outside the isolated XDG workspace; the report says so.
        script('''window.__nativeTrialExport={};const saved=URL.createObjectURL;
          const blobs=new Map();const wrapped=function(blob){const url=saved.call(URL,blob);blobs.set(url,blob);return url;};
          URL.createObjectURL=wrapped;
          const listen=event=>{const a=event.target.closest?.('a[download="animation-state-trial-case.json"]');if(!a)return;
            event.preventDefault();const blob=blobs.get(a.href);if(!blob){window.__nativeTrialExport={error:'No Blob'};return;}
            blob.text().then(raw=>window.__nativeTrialExport={name:a.download,mime:blob.type,raw,prevented:true}).catch(error=>window.__nativeTrialExport={error:String(error)});};
          document.addEventListener('click',listen,true);
          window.__nativeTrialExportCleanup=()=>{document.removeEventListener('click',listen,true);if(URL.createObjectURL===wrapped)URL.createObjectURL=saved;};return true''')
        try:
            press(selector)
            record = wait_for(lambda: script('const v=window.__nativeTrialExport;return v && (v.raw||v.error) ? v : null'))
            assert 'error' not in record, record
            assert record['name'] == 'animation-state-trial-case.json' and record['prevented']
            return record
        finally:
            script('window.__nativeTrialExportCleanup?.();delete window.__nativeTrialExportCleanup;return true')

    def import_file(raw, name):
        # The application's Import button still creates its real chooser ticket;
        # only the OS picker activation is suppressed, then a native File is set.
        script('const f=document.querySelector(arguments[0]);window.__nativeTrialPicker={f,own:Object.hasOwn(f,"click"),old:f.click};f.click=()=>{};return true', c + 'File')
        try:
            press(c + 'Import')
        finally:
            script('const s=window.__nativeTrialPicker;if(s.own)s.f.click=s.old;else delete s.f.click;delete window.__nativeTrialPicker;return true')
        script('const transfer=new DataTransfer();transfer.items.add(new File([arguments[1]],arguments[2],{type:"application/json"}));const f=document.querySelector(arguments[0]);f.files=transfer.files;f.dispatchEvent(new Event("change",{bubbles:true}));return true', c + 'File', raw, name)
        wait_for(lambda: not disabled(c + 'Run'))

    initial = author_tree()
    report['initialAuthorFiles'] = initial
    try:
        command('POST', '/window/rect', dict(width=1440, height=1100))
        report['client'] = script('return {version:document.querySelector("#appVersion")?.textContent,origin:location.origin,userAgent:navigator.userAgent,tauri:!!window.__TAURI__}')
        assert report['client']['tauri'], report['client']
        if os.environ.get('VIENTO_EXPECT_APP_VERSION'):
            assert report['client']['version'] == os.environ['VIENTO_EXPECT_APP_VERSION'], report['client']
        original_language = script('return document.documentElement.lang')
        language('zh-CN')
        # The existing 2D chain may leave view mode; source creation is available
        # in either clean mode, but the source buffer must already be loaded.
        enabled('#scriptCreateBtn')
        original_source = value('#docSourceEditor')
        press('#scriptCreateBtn')
        fill('#scriptCreateStarter', 'godot-project-animation-state-table', 'change')
        enabled('#scriptCreateApply')
        fill(prefix + 'State2Key', 'attack')
        condition = prefix + 'Transition1Condition'
        fill(condition + 'Mode', 'shared', 'change')
        fill(condition + 'Key', 'combat.enabled')
        fill(condition + 'Type', 'boolean', 'change')
        fill(condition + 'Boolean', 'true', 'change')
        fill(condition + 'Combination', 'all', 'change')
        press(condition + 'AddItem')
        fill(condition + 'Item2Type', 'number', 'change')
        fill(condition + 'Item2Operator', 'gte', 'change')
        fill(condition + 'Item2Number', '3')
        enabled('#scriptCreateApply')
        reviewed = text('#scriptCreateSource')
        assert reviewed and 'combat.enabled' in reviewed
        report['sourcePreview'] = dict(sha256=hashlib.sha256(reviewed.encode()).hexdigest(), bytes=len(reviewed.encode()))
        press(p + 'Toggle')
        fill(p + 'PayloadType', 'number', 'change')
        fill(p + 'PayloadNumber', '3')
        missing = run_sample()
        report['missingSharedTrial'] = missing
        assert [row['status'] for row in missing] == ['rejected'], missing
        assert [leaf['status'] for leaf in missing[0]['leaves']] == ['evaluated', 'not-evaluated'], missing
        assert '缺失' in missing[0]['leaves'][0]['text'], missing
        shared = p + 'SharedStates .animation-state-event-preview-shared-row[data-key="combat.enabled"]'
        fill(shared + ' select[id$="Type"]', 'boolean', 'change')
        fill(shared + ' select[id$="Boolean"]', 'true', 'change')
        assert [row['status'] for row in run_sample()] == ['selected']
        assert value(p + 'CurrentState') == 'idle' and history_count() == 0
        press(p + 'Adopt')
        assert value(p + 'CurrentState') == 'attack' and history_count() == 1
        fill(p + 'PayloadNumber', 'invalid-hidden-number')
        fill(p + 'TriggerKind', 'completed', 'change')
        assert [row['status'] for row in run_sample()] == ['selected']
        press(p + 'Adopt')
        assert value(p + 'CurrentState') == 'idle' and history_count() == 2
        press(p + 'Undo')
        assert value(p + 'CurrentState') == 'attack' and history_count() == 1
        assert value(p + 'TriggerKind') == 'completed' and value(p + 'PayloadNumber') == 'invalid-hidden-number'
        run_sample()
        press(p + 'Adopt')
        fill(p + 'TriggerKind', 'event', 'change')
        fill(p + 'PayloadNumber', '3')
        assert [row['status'] for row in run_sample()] == ['selected']
        check_author_unchanged()
        screenshot('native-animation-trial-sequence.png')
        report['steps'].append('Installed WebKit/WASM: missing shared key short-circuits all; explicit matching event adoption; assumed completion ignores hidden invalid payload; Undo restores the original buffer; source remains unchanged.')

        press(c + 'Create')
        assert not hidden(e + 'Panel') and hidden(c + 'Loaded')
        baseline = json.loads(value(e + 'Text'))
        assert baseline['format'] == 'viento.animation-state-trial-case' and baseline['version'] == 1
        assert [step['expected'] for step in baseline['steps']] == [dict(stateKey='attack', transition=True), dict(stateKey='idle', transition=True)]
        apply_case()
        press(c + 'Run')
        assert case_statuses() == ['passed', 'passed']
        press(c + 'Edit')
        fill(e + 'Text', '{')
        press(e + 'Check')
        assert value(e + 'Text') == '{' and disabled(e + 'Apply') and not hidden(e + 'Error')
        for suffix in ['Import', 'Create', 'Run', 'Clear', 'ExportLoaded', 'Export']:
            assert disabled(c + suffix), suffix
        press(e + 'Cancel')
        assert case_statuses() == ['passed', 'passed']
        press(c + 'Edit')
        changed = json.loads(json.dumps(baseline))
        changed['steps'][0]['input']['event']['value'] = 2
        changed_raw = json.dumps(changed, ensure_ascii=False, indent=2)
        fill(e + 'Text', changed_raw)
        press(e + 'Check')
        enabled(e + 'Apply')
        fill(e + 'Text', changed_raw + '\n')
        assert disabled(e + 'Apply'), 'Editing after Check must revoke Apply'
        apply_case()
        press(c + 'Run')
        assert case_statuses() == ['failed', 'not-run']
        report['firstMismatch'] = case_statuses()
        press(c + 'Edit')
        changed['steps'][0]['expected'] = dict(stateKey='idle', transition=False)
        changed['steps'][1]['expected'] = dict(stateKey='idle', transition=False)
        fill(e + 'Text', json.dumps(changed, ensure_ascii=False, indent=2))
        apply_case()
        press(c + 'Run')
        assert case_statuses() == ['passed', 'passed']
        assert history_count() == 2 and value(p + 'CurrentState') == 'idle'
        check_author_unchanged()
        screenshot('native-animation-case-edited.png')
        report['steps'].append('Create from two adopted steps → Check/Apply → explicit passing replay; invalid JSON and Cancel preserve loaded result; changed payload stops at first mismatch; editing manual expectations produces a new passing case without changing the original path.')

        exported_loaded, exported_path = export_blob(c + 'ExportLoaded'), export_blob(c + 'Export')
        assert json.loads(exported_loaded['raw']) == changed
        assert json.loads(exported_path['raw']) == baseline
        report['blobTransports'] = dict(loaded=exported_loaded, path=exported_path, nativeDownloadClaimed=False)
        import_file(exported_path['raw'], 'native-roundtrip.json')
        assert hidden(c + 'Result') and history_count() == 2
        press(c + 'Run')
        assert case_statuses() == ['passed', 'passed']
        import_file('{"format":"unknown"}', 'invalid.json')
        assert not hidden(c + 'Error') and case_statuses() == ['passed', 'passed']
        report['steps'].append('Scoped front-end transports only: export loaded/path Blob JSON differ as expected; real File.text import roundtrip is atomic; invalid import preserves the earlier result. OS pickers and download delivery are deliberately outside this result.')

        press(c + 'Edit')
        press(e + 'Check')
        enabled(e + 'Apply')
        checked_raw = value(e + 'Text')
        press(p + 'Toggle')
        assert hidden(p + 'Body')
        press(p + 'Toggle')
        assert value(e + 'Text') == checked_raw and disabled(e + 'Apply')
        fill(e + 'Text', '{\n  ')
        script('window.__nativeTrialText=document.querySelector(arguments[0]);window.__nativeTrialText.focus();window.__nativeTrialText.setSelectionRange(0,1);return true', e + 'Text')
        command('POST', '/window/rect', dict(width=760, height=900))
        for code in ['zh-CN', 'en', 'ja']:
            language(code)
            script('document.querySelector(arguments[0]).scrollIntoView({block:"center"});return true', e + 'Text')
            layout = script('const d=document.querySelector("#scriptCreateDialog"),t=document.querySelector(arguments[0]);return {width:innerWidth,height:innerHeight,noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,same:t===window.__nativeTrialText,focused:document.activeElement===t,range:[t.selectionStart,t.selectionEnd],raw:t.value,buttons:Array.from(document.querySelector(arguments[1]).querySelectorAll("button"),b=>b.textContent)}', e + 'Text', e + 'Panel')
            assert layout['noHorizontalOverflow'] and layout['same'] and layout['focused'], layout
            assert layout['range'] == [0, 1] and layout['raw'] == '{\n  ', layout
            assert layout['width'] >= 760, layout
            report['layout'][code] = layout
            screenshot('native-animation-case-editor-' + code + '.png')
        language('zh-CN')
        # Observe the actual constructor fields before dispatch. WebKit may
        # derive a dialog cancel from Escape; intercept only confirm transport
        # during this diagnostic, record every attempt, and still fail on it.
        probe = script('''const target=document.querySelector(arguments[0]),dialog=document.querySelector('#scriptCreateDialog');
          const event=new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true});
          const fields=e=>({type:e.type,key:e.key??null,keyCode:e.keyCode??null,isComposing:e.isComposing??null,isTrusted:e.isTrusted,defaultPrevented:e.defaultPrevented});
          const probe={constructor:fields(event),cancels:[],confirms:[],keydown:[],done:false};
          const saved=window.confirm, confirm=message=>{probe.confirms.push(String(message));return false;};
          const onCancel=e=>probe.cancels.push(fields(e)), onKey=e=>{if(e===event)probe.keydown.push(fields(e));};
          dialog.addEventListener('cancel',onCancel,true);target.addEventListener('keydown',onKey,true);window.confirm=confirm;
          window.__nativeTrialIME={probe,event,target,cleanup:()=>{dialog.removeEventListener('cancel',onCancel,true);target.removeEventListener('keydown',onKey,true);if(window.confirm===confirm)window.confirm=saved;}};
          return probe;''', e + 'Text')
        report['compositionProbe'] = probe
        try:
            assert probe['constructor']['isComposing'] is True, probe
            assert probe['constructor']['key'] == 'Escape', probe
            script('const s=window.__nativeTrialIME;s.target.dispatchEvent(s.event);s.probe.afterDispatch={defaultPrevented:s.event.defaultPrevented,childHidden:document.querySelector(arguments[0]).hidden,parentOpen:document.querySelector("#scriptCreateDialog").open};setTimeout(()=>s.probe.done=true,50);return true', e + 'Panel')
            report['compositionProbe'] = wait_for(lambda: script('const s=window.__nativeTrialIME;return s?.probe.done?s.probe:null'))
        finally:
            script('window.__nativeTrialIME?.cleanup();delete window.__nativeTrialIME;return true')
        assert not report['compositionProbe']['confirms'], report['compositionProbe']
        assert not report['compositionProbe']['cancels'], report['compositionProbe']
        assert report['compositionProbe']['afterDispatch']['defaultPrevented'] is True, report['compositionProbe']
        assert not hidden(e + 'Panel'), 'Composition Escape must preserve child editing'
        assert script('return document.querySelector("#scriptCreateDialog").open'), 'Composition Escape must preserve the parent dialog'
        command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'animation-trial-escape', 'actions': [{'type': 'keyDown', 'value': '\ue00c'}, {'type': 'keyUp', 'value': '\ue00c'}]}]})
        if not hidden(e + 'Panel') and display_environment:
            tool = os.environ.get('VIENTO_TEST_XDOTOOL') or shutil.which('xdotool')
            assert tool, 'WebDriver Escape did not cancel; xdotool is unavailable'
            environment = display_environment()
            window = subprocess.check_output([tool, 'getwindowfocus'], env=environment, text=True, timeout=10).strip()
            title = subprocess.check_output([tool, 'getwindowname', window], env=environment, text=True, timeout=10).strip()
            assert 'Viento Studio' in title, title
            subprocess.run([tool, 'windowfocus', '--sync', window, 'key', '--clearmodifiers', 'Escape'], env=environment, check=True, timeout=10)
            report['physicalEscape'] = dict(window=window, title=title)
        wait_for(lambda: hidden(e + 'Panel'))
        assert script('return document.querySelector("#scriptCreateDialog").open')
        assert script('return document.activeElement.id') == c[1:] + 'Edit'
        assert case_statuses() == ['passed', 'passed']
        check_author_unchanged()
        report['steps'].append('Fold retains raw JSON but revokes Check; Chinese/English/Japanese retain textarea identity, focus, selection and incomplete draft at the actual native minimum viewport. Synthetic composing Escape is ignored; real Escape cancels only the child editor and restores its opener.')

        press('#scriptCreateCancel')
        alert = wait_for(lambda: command('GET', '/alert/text'))
        assert '丢弃' in alert, alert
        command('POST', '/alert/accept', {})
        wait_for(lambda: not script('return document.querySelector("#scriptCreateDialog").open'))
        assert author_tree() == initial and value('#docSourceEditor') == original_source
        # Narrow-dialog assertions are complete. Restore the desktop viewport
        # before reopening so its responsive directory drawer cannot cover the button.
        command('POST', '/window/rect', dict(width=1440, height=1100))
        wait_for(lambda: script('return innerWidth >= 1280'))
        report['reopenViewport'] = script('return {width:innerWidth,height:innerHeight}')
        press('#scriptCreateBtn')
        fill('#scriptCreateStarter', 'godot-project-animation-state-table', 'change')
        press(p + 'Toggle')
        assert hidden(c + 'Loaded') and hidden(c + 'Result') and hidden(e + 'Panel') and history_count() == 0
        press('#scriptCreateCancel')
        wait_for(lambda: command('GET', '/alert/text'))
        command('POST', '/alert/accept', {})
        wait_for(lambda: not script('return document.querySelector("#scriptCreateDialog").open'))
        assert author_tree() == initial and value('#docSourceEditor') == original_source
        report['finalAuthorFiles'] = author_tree()
        report['authorBytesUnchanged'] = True
        report['status'] = 'passed'
        print('PASS: installed Tauri/WebKit animation manual sequence → case JSON editor → Check/Apply/replay → scoped Blob/File roundtrip → three languages/native narrow view → cancellation preserves author bytes', flush=True)
        return report
    except Exception as error:
        report['status'], report['error'] = 'failed', repr(error)
        try:
            report['pageAtFailure'] = script('return document.body.innerText')
            screenshot('native-animation-case-failure.png')
            report['finalAuthorFiles'] = author_tree()
            report['authorBytesUnchanged'] = report['finalAuthorFiles'] == initial
        except Exception as capture_error:
            report['captureError'] = repr(capture_error)
        raise
    finally:
        try:
            if original_language:
                language(original_language)
            command('POST', '/window/rect', dict(width=1280, height=900))
        except Exception as restore_error:
            report['restoreError'] = repr(restore_error)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (screenshots / 'native-animation-trial-case.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
