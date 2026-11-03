#!/usr/bin/env python3
"""Compare five same-input operation documents to the pre-adoption binary."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HOST = Path(sys.argv[1]).resolve()
BASE = ROOT/'tests/expected/operation-parity.json'
def document(setup, fields):
 # Fixture values are deliberately quote/newline-free, so this small builder
 # tests domain facts without adding a general serialization implementation.
 chunks = [json.dumps('{')]
 for i,(key,expression,kind) in enumerate(fields):
  chunks.append(json.dumps((',' if i else '')+json.dumps(key)+':'))
  if kind=='string': chunks += [json.dumps('"'),expression,json.dumps('"')]
  else: chunks.append('str('+expression+')')
 chunks.append(json.dumps('}'))
 return setup+'\n$return = json_parse('+' + '.join(chunks)+');'

CASES = {
 'repo_view': document('let r = gh.repo_view("octo", "demo");',[
  ('name','r.name()','string'),('full_name','r.full_name()','string'),('url','r.url()','string'),('stars','r.stars()','int')]),
 'issue_view': document('let r = gh.issue_view("octo", "demo", 3);',[
  ('number','r.number()','int'),('title','r.title()','string'),('state','r.state()','string'),('url','r.url()','string')]),
 'pr_list': document('let rows = gh.pr_list("octo", "demo", "open", 30); let r = rows.at(0);',[
  ('count','rows.len()','int'),('number','r.number()','int'),('title','r.title()','string'),('state','r.state()','string'),('url','r.url()','string')]),
 'release_list': document('let rows = gh.release_list("octo", "demo", 10); let r = rows.at(0);',[
  ('count','rows.len()','int'),('tag','r.tag()','string'),('name','r.name()','string'),('url','r.url()','string')]),
 'search_repos': document('let rows = gh.search_repos("org:octo", 10); let r = rows.at(0);',[
  ('count','rows.len()','int'),('name','r.name()','string'),('full_name','r.full_name()','string'),('stars','r.stars()','int'),('url','r.url()','string')]),
}
with tempfile.TemporaryDirectory(prefix='lmgh parity ') as directory:
 work = Path(directory)
 fake = work/'gh'
 fake.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(ROOT/'tests/fake-gh.py'))+' "$@"\n')
 fake.chmod(0o700)
 env = dict(os.environ, LMGH_GH=str(fake))
 env.pop('LMCODE_INVOCATION_FILE',None)
 results = {}
 for name, expression in CASES.items():
  source, output = work/(name+'.lms'), work/(name+'.dslb')
  source.write_text('program = _lmcode_ schema='+json.dumps(str(ROOT/'schema/lmgh.host.json'))+';\n'+expression+'\nend _lmcode_\n')
  subprocess.run(['node',str(ROOT/'tests/compile-fixture.mjs'),str(source),str(output)],env=env,check=True)
  result = subprocess.run([str(HOST),'--lmcode',str(output)],env=env,capture_output=True)
  assert result.returncode==0 and not result.stderr,(name,result)
  frame=json.loads(result.stdout.decode().split('LMCODE_RETURN_BEGIN\n')[1].splitlines()[0])
  assert frame['ok'],frame
  results[name]=frame['result']
 if '--record-before' in sys.argv:
  BASE.write_text(json.dumps({'source':'a0c608f29ec2d1da4aa199d7310612f293df0fb8','values':results},indent=2)+'\n')
 else:
  expected=json.loads(BASE.read_text())['values']
  assert results==expected,(results,expected)
  print('PASS five same-input operations match pre-adoption structured results: '+', '.join(results))
