from pathlib import Path
import os
repo = Path(os.environ['VIENTO_TEST_REPO']).resolve()
driver_dir = Path(os.environ['VIENTO_TEST_DRIVER_DIR']).resolve()
source=(repo/'desktop/tests/native-smoke.py').read_text()
source=source.replace('from project_settings_navigation import exercise_project_settings_navigation', f"sys.path.insert(0, {str(repo / 'desktop/tests')!r})\nfrom project_settings_navigation import exercise_project_settings_navigation")
source=source.replace('ROOT = Path(__file__).resolve().parents[2]', f'ROOT = Path({str(repo)!r})')
old='''            assert '通用 OC 项目' in script('return document.querySelector("#createDialog").textContent')'''
new='''            templates = script('return [...document.querySelector("#projectTemplate").options].map(o=>({id:o.value,label:o.textContent}))')
            assert templates == [
                {'id':'org.viento.blank','label':'空白工程'},
                {'id':'org.viento.oc-game','label':'游戏'},
                {'id':'org.viento.oc-literature','label':'文学'},
                {'id':'org.viento.oc-drama','label':'戏剧'},
                {'id':'org.viento.software-design','label':'软件设计'},
            ], templates
            print('PASS: new library dialog exposes all five current template identities and Chinese labels', flush=True)'''
assert source.count(old)==1
source=source.replace(old,new)
(driver_dir / 'native-generic-smoke.py').write_text(source)
