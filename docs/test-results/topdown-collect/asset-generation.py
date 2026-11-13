from pathlib import Path
import math, wave, struct, hashlib, json, xml.etree.ElementTree as ET
root = Path('/tmp/viento-topdown-draft/assets')
license_note = '<!-- Original Viento topdown sample artwork. Dedicated to the public domain under CC0-1.0. -->\n'
svg = {
'player.svg': '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <ellipse cx="64" cy="111" rx="34" ry="8" fill="#08121e" fill-opacity=".55"/>
  <path d="M42 88h17v22H40l-3-7zM69 88h17l5 15-3 7H69z" fill="#256c67" stroke="#0b3035" stroke-width="4" stroke-linejoin="round"/>
  <path d="M36 52 23 65l-2 25 13 6 13-22zM92 52l13 13 2 25-13 6-13-22z" fill="#53c6ae" stroke="#0b3035" stroke-width="4" stroke-linejoin="round"/>
  <path d="m39 48 25-9 25 9 7 43-13 12H45L32 91z" fill="#75e7c3" stroke="#0b3035" stroke-width="4" stroke-linejoin="round"/>
  <path d="M64 47v48M43 80h42" fill="none" stroke="#2b9b88" stroke-width="4"/>
  <path d="M40 28 50 15h28l10 13 4 27-12 18H48L36 55z" fill="#a2f4d7" stroke="#0b3035" stroke-width="4" stroke-linejoin="round"/>
  <path d="M47 38h34v17L73 63H55l-8-8z" fill="#123d45"/>
  <path d="M53 43v7M75 43v7" stroke="#d9fff1" stroke-width="4" stroke-linecap="round"/>
  <path d="m54 27 10-5 10 5" fill="none" stroke="#d9fff1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M71 83h12v9H71z" fill="#ffda79" stroke="#357969" stroke-width="2"/>
</svg>''',
'crystal.svg': '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <ellipse cx="64" cy="111" rx="38" ry="8" fill="#08121e" fill-opacity=".55"/>
  <path d="m19 69 12-27 21 17 5 39-18 12z" fill="#e8a840" stroke="#5b411f" stroke-width="4" stroke-linejoin="round"/>
  <path d="m31 42 9 31-1 37M19 69l21 4 12-14" fill="none" stroke="#ffe6a2" stroke-width="3" stroke-linejoin="round"/>
  <path d="m76 61 22-17 12 27-20 38-19-11z" fill="#e8a840" stroke="#5b411f" stroke-width="4" stroke-linejoin="round"/>
  <path d="m98 44-9 31 1 34M76 61l13 14 21-4" fill="none" stroke="#ffe6a2" stroke-width="3" stroke-linejoin="round"/>
  <path d="m42 44 22-31 22 31-5 44-17 23-17-23z" fill="#ffd568" stroke="#5b411f" stroke-width="4" stroke-linejoin="round"/>
  <path d="m64 13 2 38-2 60-17-23-5-44z" fill="#ffe79c"/>
  <path d="m64 13 22 31-20 7-24-7M66 51l15 37-17 23-17-23z" fill="none" stroke="#d79835" stroke-width="3" stroke-linejoin="round"/>
  <path d="M23 22v12M17 28h12M106 18v10M101 23h10" stroke="#ffecad" stroke-width="3" stroke-linecap="round"/>
</svg>''',
'gate.svg': '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <ellipse cx="64" cy="115" rx="52" ry="7" fill="#08121e" fill-opacity=".55"/>
  <path d="M15 111V40l16-24h66l16 24v71H94V45l-7-9H41l-7 9v66z" fill="#285164" stroke="#0c2939" stroke-width="4" stroke-linejoin="round"/>
  <path d="m23 40 13-17h56l13 17M24 49v54M104 49v54" fill="none" stroke="#72e5ed" stroke-width="4" stroke-linejoin="round"/>
  <path d="M44 41v65M57 41v65M71 41v65M84 41v65" stroke="#2aaabc" stroke-width="6" stroke-linecap="round"/>
  <path d="M38 101h52" stroke="#7df3ed" stroke-width="4" stroke-linecap="round"/>
  <path d="M53 65v-8a11 11 0 0 1 22 0v8" fill="none" stroke="#d1ffff" stroke-width="6"/>
  <rect x="46" y="63" width="36" height="28" rx="6" fill="#56e1e4" stroke="#103b4c" stroke-width="4"/>
  <path d="M64 73v9" stroke="#124b5a" stroke-width="6" stroke-linecap="round"/>
  <path d="M9 110h30M89 110h30" stroke="#6ea8ba" stroke-width="5" stroke-linecap="round"/>
</svg>''',
'hazard.svg': '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <ellipse cx="64" cy="110" rx="50" ry="10" fill="#08121e" fill-opacity=".55"/>
  <path d="m13 95 12-14 17 5 14-8 17 9 20-7 22 15-9 18H24z" fill="#722c3d" stroke="#361e31" stroke-width="4" stroke-linejoin="round"/>
  <path d="m20 95 17-35 18 40z" fill="#f05b70" stroke="#642b3c" stroke-width="4" stroke-linejoin="round"/>
  <path d="m44 99 20-68 21 68z" fill="#ff7582" stroke="#642b3c" stroke-width="4" stroke-linejoin="round"/>
  <path d="m73 100 18-42 19 39z" fill="#f05b70" stroke="#642b3c" stroke-width="4" stroke-linejoin="round"/>
  <path d="m64 31-5 54 12-10M37 60l-3 25M91 58l-3 24" fill="none" stroke="#ffc2b6" stroke-width="3" stroke-linecap="round"/>
  <path d="M25 106h77" stroke="#ff927e" stroke-width="3" stroke-linecap="round"/>
  <path d="M26 34 20 24M100 34l7-10M64 17v-7" stroke="#f79a9f" stroke-width="4" stroke-linecap="round"/>
</svg>''',
'wall.svg': '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <path d="M9 16h110v96H9z" fill="#1a293c" stroke="#101b29" stroke-width="4" stroke-linejoin="round"/>
  <path d="m9 16 10-8h90l10 8z" fill="#7991a7"/>
  <path d="M9 18h110v28H9z" fill="#536b83"/>
  <path d="M9 49h110v28H9z" fill="#435b73"/>
  <path d="M9 80h110v27H9z" fill="#536b83"/>
  <path d="M11 20h106M11 51h106M11 82h106" stroke="#718a9f" stroke-width="3"/>
  <path d="M43 18v28M88 18v28M24 49v28M69 49v28M43 80v27M88 80v27" stroke="#24394f" stroke-width="5"/>
  <path d="M9 111h110v9H9z" fill="#101b29"/>
</svg>''',
'floor.svg': '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <path d="M0 0h128v128H0z" fill="#101b29"/>
  <path d="M0 0h64v64H0zM64 64h64v64H64z" fill="#132032"/>
  <path d="M0 0h128v128H0zM64 0v128M0 64h128" fill="none" stroke="#1b2c40" stroke-width="2"/>
  <path d="M11 14h10M79 81h10M108 47h6M43 108h6" stroke="#27394d" stroke-width="2" stroke-linecap="round"/>
</svg>'''
}
for name, text in svg.items():
    (root / name).write_text(license_note + text + '\n', encoding='utf-8')

sample_rate = 22050
# Quiet, short earcons. Exact durations include attack and release.
def smooth_envelope(t, duration, attack=.008, release=.04):
    return min(1., t / attack) * min(1., max(0., (duration - t) / release))
def pickup(t, duration):
    start, f, length = (0., 660., .085) if t < .085 else (.085, 990., duration-.085)
    local = t-start
    return .33 * smooth_envelope(local,length,attack=.006,release=.012) * (math.sin(2*math.pi*f*local) + .16*math.sin(4*math.pi*f*local))
def hurt(t, duration):
    # Analytic downward sweep, no randomness or external sample.
    phase = 2*math.pi*(280*t - 180*t*t/duration/2)
    return .31*smooth_envelope(t,duration,release=.065)*(math.sin(phase)+.22*math.sin(2.07*phase))
def win(t, duration):
    index = min(2,int(t/.105))
    f = [523.251,659.255,783.991][index]
    local = t-index*.105
    length = .105 if index < 2 else duration-.210
    envelope = smooth_envelope(local,length,attack=.006,release=.025)
    return .32*envelope*(math.sin(2*math.pi*f*local)+.12*math.sin(4*math.pi*f*local))
reports = []
for name, duration, fn in [('pickup.wav',.18,pickup),('hurt.wav',.23,hurt),('win.wav',.34,win)]:
    count = round(duration*sample_rate)
    values = [round(max(-1.,min(1.,fn(i/sample_rate,count/sample_rate)))*32767) for i in range(count)]
    with wave.open(str(root/name),'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sample_rate)
        wav.writeframes(struct.pack('<'+'h'*count,*values))
    with wave.open(str(root/name),'rb') as wav:
        assert (wav.getnchannels(),wav.getsampwidth(),wav.getframerate(),wav.getcomptype()) == (1,2,22050,'NONE')
        assert wav.getnframes()/wav.getframerate() <= .35
        restored = struct.unpack('<'+'h'*wav.getnframes(),wav.readframes(wav.getnframes()))
        assert max(map(abs,restored)) < 32767
        assert any(restored) and abs(restored[0]) <= 1 and abs(restored[-1]) < 100
        step = max(abs(b-a) for a,b in zip(restored,restored[1:]))/32767
        assert step < .13
        reports.append({'name':name,'frames':count,'durationSeconds':count/sample_rate,'peak':max(map(abs,restored))/32767,'rms':math.sqrt(sum(v*v for v in restored)/len(restored))/32767,'maximumAdjacentSampleStep':step})
ns = '{http://www.w3.org/2000/svg}'
allowed = {ns+x for x in ('svg','path','rect','circle','ellipse','g','polygon','polyline','line')}
for name in svg:
    node = ET.parse(root/name).getroot()
    assert node.tag == ns+'svg' and node.get('viewBox') == '0 0 128 128' and node.get('width') == node.get('height') == '128'
    for child in node.iter():
        assert child.tag in allowed, (name,child.tag)
        assert not any(k.startswith('on') or 'href' in k or k in ('style','font-family') or 'url(' in v for k,v in child.attrib.items()),(name,child.attrib)
    assert not any(x in (root/name).read_text() for x in ('<script','<text','<image','<foreignObject','@import'))
files = [{'name':p.name,'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(root.iterdir())]
report = {'license':'CC0-1.0; original artwork and analytic audio; no external references, fonts, scripts or source media', 'files':files,'totalBytes':sum(x['size'] for x in files),'svgValidation':'6/6 XML namespace,128px/viewBox,primitive allowlist; no event handlers/href/url/style/text/image/script','audioValidation':reports}
Path('/tmp/viento-topdown-asset-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
