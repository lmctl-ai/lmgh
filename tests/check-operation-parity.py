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
CASES = {
 'repo_view': 'gh.repo_view("octo", "demo").name()',
 'issue_view': 'gh.issue_view("octo", "demo", 3).title()',
 'pr_list': 'gh.pr_list("octo", "demo", "open", 30).at(0).title()',
 'release_list': 'gh.release_list("octo", "demo", 10).at(0).tag()',
 'search_repos': 'gh.search_repos("org:octo", 10).at(0).name()',
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
  source.write_text('program = _lmcode_ schema='+json.dumps(str(ROOT/'schema/lmgh.host.json'))+';\n$return = '+expression+';\nend _lmcode_\n')
  subprocess.run(['node',str(ROOT/'tests/compile-fixture.mjs'),str(source),str(output)],env=env,check=True)
  result = subprocess.run([str(HOST),'--lmcode',str(output)],env=env,capture_output=True)
  assert result.returncode==0 and not result.stderr,(name,result)
  frame=json.loads(result.stdout.decode().split('LMCODE_RETURN_BEGIN\n')[1].splitlines()[0])
  assert frame['ok'],frame
  results[name]=frame['result']
 if '--record-before' in sys.argv:
  BASE.write_text(json.dumps({'source':'a0c608f','values':results},indent=2)+'\n')
 else:
  expected=json.loads(BASE.read_text())['values']
  assert results==expected,(results,expected)
  print('PASS five same-input operations match pre-adoption structured results: '+', '.join(results))
