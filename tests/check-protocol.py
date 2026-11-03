#!/usr/bin/env python3
"""Real compiled programs exercise host manifests, dry effects and terminal frames."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HOST = Path(sys.argv[1]).resolve()
COMPILER = os.environ['LMSCRIPT_BIN']

def frame(result, code):
    assert result.returncode == code, (result.returncode, code, result.stdout, result.stderr)
    assert not result.stderr, result.stderr
    text = result.stdout.decode()
    assert text.count('LMCODE_RETURN_BEGIN\n') == text.count('LMCODE_RETURN_END\n') == 1, text
    start = text.index('LMCODE_RETURN_BEGIN\n')
    assert text.endswith('LMCODE_RETURN_END\n'), text
    return json.loads(text[start:].splitlines()[1])

with tempfile.TemporaryDirectory(prefix='lmgh protocol 水 ') as directory:
    work = Path(directory).resolve()
    env = dict(os.environ)
    env.pop('LMCODE_INVOCATION_FILE', None)
    # An actual process fixture: records dispatch, including version probes.
    fake = work / ('gh.exe' if os.name == 'nt' else 'gh')
    subprocess.run(['go', 'build', '-o', str(fake), './tests/fixture-gh'], cwd=ROOT, check=True)
    calls = work / 'calls'
    env.update(LMGH_GH=str(fake), LMGH_CALLS=str(calls))
    def compile(name, body):
        source = work / (name+'.lms')
        output = work / (name+'.dslb')
        source.write_text('program = _lmcode_ schema='+json.dumps(str(ROOT/'schema/lmgh.host.json'))+';\n'+body+'\nend _lmcode_\n')
        result = subprocess.run(['node', str(ROOT/'tests/compile-fixture.mjs'), str(source), str(output)], env=env, capture_output=True)
        assert result.returncode == 0, (result.stdout, result.stderr)
        assert output.read_bytes()[:4] == b'DSLB'
        assert int.from_bytes(output.read_bytes()[4:6], 'big') == 6
        return output
    def execute(files, *, dry=False, metadata=None, flags=None):
        manifest = work/'invocation.json'
        value = {'version':1,'mode':'builder' if len(files)>1 else 'single','dry':dry,
                 'parts':[{'index':i,'file':str(f)} for i,f in enumerate(files)]}
        if metadata is not None: value = metadata(value)
        manifest.write_text(json.dumps(value))
        actual = dict(env, LMCODE_INVOCATION_FILE=str(manifest))
        argv = flags if flags is not None else [arg for f in files for arg in ('--lmcode',str(f))]
        return subprocess.run([str(HOST),*argv], env=actual, capture_output=True, cwd=work)
    first = compile('first', '$return = 11;')
    second = compile('second', '$return = 22;')
    assert frame(execute([first]),0) == {'ok':True,'result':11}
    assert frame(execute([first,second]),0) == {'ok':True,'result':[11,22],'parts':2}
    # Command roles may reorder execution; result indices belong to manifest order.
    actual = frame(execute([first,second],flags=['--first',str(second),'--last',str(first)]),0)
    assert actual == {'ok':True,'result':[11,22],'parts':2}, actual
    print('PASS single/builder, manifest identity across reordered argv')
    write = compile('write', 'gh.dry_run(false); let i = gh.issue_create("octo", "demo", "test", "body"); $return = i.number();')
    for corrupt in [lambda x: {k:v for k,v in x.items() if k!='dry'}, lambda x: dict(x,dry='yes'),
                    lambda x: dict(x,unknown=True),lambda x: dict(x,version=2)]:
        calls.unlink(missing_ok=True)
        result = frame(execute([write],metadata=corrupt),2)
        assert not result['ok'] and result['phase']=='cli', result
        assert not calls.exists(), 'invalid invocation dispatched gh'
    print('PASS missing/nonboolean dry and malformed manifests reject before dispatch')
    calls.unlink(missing_ok=True)
    actual = frame(execute([write],dry=True),0)
    assert actual == {'ok':True,'result':0,'dry':True}, actual
    assert not calls.exists(), 'dry invoked gh'
    read = compile('read', 'let r = gh.repo_view("octo", "demo"); $return = r.name();')
    assert frame(execute([read],dry=True),0) == {'ok':True,'result':'','dry':True}
    assert not calls.exists(), 'dry read invoked gh'
    actual = frame(execute([write]),0)
    assert actual == {'ok':True,'result':42}, actual
    assert 'issue create' in calls.read_text()
    print('PASS immutable dry, typed object/primitive dummies, live dispatch')
    failure = compile('fail', 'gh.issue_list("octo", "demo", "invalid", 1);')
    calls.unlink(missing_ok=True)
    actual = frame(execute([first,failure,write]),3)
    assert not actual['ok'] and actual['part']==1 and 'result' not in actual, actual
    assert not calls.exists(), 'failure dispatched subsequent write part'
    app = compile('app', 'report.add("x", "y", "z"); report.fail_if_any();')
    actual = frame(execute([app]),4)
    assert actual['phase']=='app' and actual['code']=='APP_FAIL' and 'result' not in actual, actual
    missing = work/'missing.dslb'
    assert frame(execute([missing]),4)['phase']=='app'
    junk = work/'junk.dslb'; junk.write_bytes(b'not bytecode')
    assert frame(execute([junk]),3)['phase']=='load'
    print('PASS exit 0/2/3/4, first failure part, no failure payload, one terminal frame')
