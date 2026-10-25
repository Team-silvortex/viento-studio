#!/usr/bin/env python3
"""Read-only repository Markdown link/anchor audit; run from any directory.
Checks inline and reference links, headings and explicit IDs outside code fences.
External URLs and vendored rustdoc intra-doc references are outside this check.
"""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re,json,unicodedata,html,argparse,subprocess
parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
parser.add_argument('--output',type=Path)
args=parser.parse_args();R=args.root.resolve()
raw=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=R)
files=sorted({p for p in raw.decode().split('\0') if p.endswith('.md') and (R/p).is_file()})
def content(name,baseline=False):
 p=R/name
 return p.read_text(encoding='utf8')
def strip_fences(src):
 lines=[]; marker=None
 for l in src.splitlines():
  m=re.match(r'^\s{0,3}(`{3,}|~{3,})',l)
  if m:
   if marker is None: marker=m.group(1)
   elif m.group(1)[0]==marker[0] and len(m.group(1))>=len(marker): marker=None
   lines.append('');continue
  lines.append('' if marker else l)
 return '\n'.join(lines)
def slug(s):
 s=re.sub(r'<[^>]+>','',s)
 s=re.sub(r'!?\[([^]]+)\]\([^)]*\)',r'\1',s)
 s=html.unescape(s).strip().lower()
 return ''.join(c for c in s if c in '-_ ' or unicodedata.category(c)[0] in 'LNM').replace(' ','-')
cache={}
def anchors(name,baseline=False):
 k=(name,baseline)
 if k in cache:return cache[k]
 s=strip_fences(content(name,baseline)); ids=set(re.findall(r'\bid=["\']([^"\']+)',s)); counts={}
 for m in re.finditer(r'^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$',s,re.M):
  key=slug(m.group(1)); n=counts.get(key,0); counts[key]=n+1
  ids.add(key+('-'+str(n) if n else ''))
 cache[k]=ids
 return ids
linkre=re.compile(r'!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["\'][^\n]*?["\'])?\s*\)')
def audit(baseline=False):
 issues=[]; checked=0; local=0
 for p in files:
  s=strip_fences(content(p,baseline))
  links=list(linkre.finditer(s))
  # Include reference-style definitions.
  links+=list(re.finditer(r'^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)',s,re.M))
  for m in links:
   raw=m.group(1).strip('<>'); parts=urlsplit(raw)
   if parts.scheme or parts.netloc or raw.startswith('/') or '$' in raw or '{' in raw:continue
   if p.startswith('src-tauri/vendor/') and re.match(r'^(struct|enum|trait|fn|macro|mod|type)@',raw):continue
   target=(R/p).parent/unquote(parts.path) if parts.path else R/p
   target=Path(__import__('os').path.normpath(target))
   if not target.is_relative_to(R):continue
   targetname=str(target.relative_to(R));line=s.count('\n',0,m.start())+1
   local+=1
   if not target.exists():
    issues.append({'source':p,'line':line,'target':raw,'kind':'missing-file'});continue
   if parts.fragment and target.suffix.lower()=='.md':
    checked+=1
    if unquote(parts.fragment) not in anchors(targetname,baseline):issues.append({'source':p,'line':line,'target':raw,'kind':'missing-anchor'})
 return {'files':len(files),'localLinks':local,'anchorLinks':checked,'issues':issues}
result=audit();result['scope']='Local repository Markdown files; external URLs and vendored rustdoc references excluded'
output=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
if args.output:args.output.write_text(output,encoding='utf8')
print(output,end='')
raise SystemExit(bool(result['issues']))
