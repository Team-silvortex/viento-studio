from pathlib import Path
import hashlib,json
r=Path.cwd();o=r/'docs/test-results/scene-composition-structure'
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=json.loads((o/'previous-source-hashes.json').read_text()); names=set(old)
for directory in ['engine','web','scripts','crates/viento-studio-core']:
 for p in (r/directory).rglob('*'):
  if p.is_file() and not any(part in ['target','node_modules','data'] or part.startswith('.') for part in p.relative_to(r/directory).parts) and p.suffix in ['.mjs','.js','.rs']:
   names.add(str(p.relative_to(r)))
source={name:h(r/name) for name in sorted(names)}
(o/'source-hashes.json').write_text(json.dumps(source,indent=2)+'\n')
core={str(p.relative_to(r)):h(p) for p in sorted((r/'crates/viento-studio-core/src').glob('*.rs'))}
for name in ['Cargo.toml','Cargo.lock']:core[f'crates/viento-studio-core/{name}']=h(r/'crates/viento-studio-core'/name)
(o/'core-source-hashes-final.json').write_text(json.dumps(core,indent=2)+'\n')
changed={name:{'before':old.get(name),'after':digest} for name,digest in source.items() if old.get(name)!=digest}
(o/'source-delta.json').write_text(json.dumps(changed,indent=2)+'\n')
print(json.dumps({'sourceFiles':len(source),'changedOrNew':len(changed),'coreFiles':len(core)}))
