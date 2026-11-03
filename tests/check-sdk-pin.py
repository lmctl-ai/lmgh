#!/usr/bin/env python3
"""The human-reviewed full SHA and Go's checksummed module resolve together."""
import json
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent.parent
lock = dict(line.split('=', 1) for line in (root/'sdk.lock').read_text().splitlines())
assert len(lock['commit']) == 40 and lock['repo'] == 'https://github.com/lmctl-ai/lmcode-go'
module = json.loads(subprocess.check_output(['go','list','-m','-json',lock['module']],cwd=root))
assert module['Version'] == lock['version'] and module['Version'].endswith(lock['commit'][:12]), module
assert not module.get('Replace'), 'SDK replacement bypasses reviewed pin'
assert not any(name in (root/'go.mod').read_text() for name in ['lmapi','lmgitcli','lmrust','lmcpp'])
print('PASS reviewed SDK full SHA and checksummed module pin')
