from pathlib import Path
import hashlib,json
r=Path.cwd();o=r/'docs/test-results/scene-composition-definition-authoring'
old=json.loads((o/'source-baseline.json').read_text());names=set(old)
for prefix in ['engine','web','scripts']:
 names.update(str(p.relative_to(r)) for p in (r/prefix).rglob('*') if p.is_file() and p.suffix in ['.mjs','.js'])
names.update(str(p.relative_to(r)) for p in (r/'crates/viento-studio-core').rglob('*.rs') if 'target' not in p.parts)
current={name:hashlib.sha256((r/name).read_bytes()).hexdigest() for name in sorted(names)}
changed={name:{'before':old.get(name),'after':digest} for name,digest in current.items() if old.get(name)!=digest}
(o/'source-hashes.json').write_text(json.dumps(current,indent=2)+'\n')
(o/'source-delta.json').write_text(json.dumps(changed,indent=2)+'\n')
print(json.dumps({'sources':len(current),'delta':len(changed),'new':sum(item['before'] is None for item in changed.values())}))
