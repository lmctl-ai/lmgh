import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work=await fs.mkdtemp(path.join(os.tmpdir(),'lmgh proposal 水 '));
const compiler=process.env.LMSCRIPT_ROOT;if(!compiler)throw Error('LMSCRIPT_ROOT must name the private compiler package');
const host=path.resolve(process.argv[2]);const calls=[];
const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));res.end('https://github.com/octo/demo/pull/42\n');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,HOME:work,USERPROFILE:work,LMCTL_HOME:path.join(work,'state'),LMCTL_DB:path.join(work,'state.db'),LMGH_MOCK_URL:`http://127.0.0.1:${server.address().port}`};
delete env.GH_TOKEN;delete env.GITHUB_TOKEN;delete env.LMCODE_INVOCATION_FILE;
function run(command,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env,cwd:work,...options});let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});}
try{
 const fake=path.join(work,process.platform==='win32'?'gh.exe':'gh');
 assert.equal((await run('go',['build','-o',fake,'./tests/proposal-gh'],{cwd:root})).code,0);env.LMGH_GH=fake;
 let original=(await fs.readFile(path.join(root,'examples/toml-pr.lms'),'utf8')).replace('"../schema/lmgh.host.json"',JSON.stringify(path.join(root,'schema/lmgh.host.json')));
 // Published 0.2.458 predates opaque Data. CI always tests the real host's
 // string boundary; PROPOSAL_DATA_BLOCKS=1 additionally qualifies the actual
 // example with a main-built compiler, without mocking language methods.
 if(process.env.PROPOSAL_DATA_BLOCKS!=='1') original=original.replace(/proposal = _toml_;\r?\n([\s\S]*?)\r?\nend _toml_/,(_,text)=>`proposal = ${JSON.stringify(text)};`).replace('proposal.toString()','proposal');
 const source=path.join(work,'proposal.lms');await fs.writeFile(source,original);
 const invoke=mode=>run(process.execPath,[path.join(compiler,'bin/lmscript'),...(mode?[mode]:[]),source,host]);
 const check=await invoke('--check');assert.equal(check.code,0,JSON.stringify(check));assert.equal(calls.length,0);
 const dry=await invoke('--dry-run');assert.equal(dry.code,0,JSON.stringify(dry));assert.match(dry.stdout,/PR proposal \(validated; nothing sent\)/);assert.match(dry.stdout,/"reviewers":/);assert.equal(calls.length,0);
 const replaceText=(source,from,to)=>source.replace(process.env.PROPOSAL_DATA_BLOCKS==='1'?from:JSON.stringify(from).slice(1,-1),process.env.PROPOSAL_DATA_BLOCKS==='1'?to:JSON.stringify(to).slice(1,-1));
 for(const [changed,needle] of [
  [replaceText(original,'title = "Preserve proposals"\n',''),'pr.title: required'],
  [replaceText(original,'draft = true','surprise = true'),'pr.surprise: unknown field'],
  [replaceText(original,'draft = true','draft = "yes"'),'pr.draft: expected boolean']]){
  await fs.writeFile(source,changed);for(const mode of ['--dry-run','']){const result=await invoke(mode);assert.match(result.stdout+result.stderr,new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(calls.length,0);}
 }
 await fs.writeFile(source,original);const real=await invoke('');assert.equal(real.code,0,JSON.stringify(real));assert.equal(calls.length,1);
 assert.deepEqual(calls[0],['pr','create','-R','octo/demo','--title','Preserve proposals','--body','Exact proposal body: Unicode 水 and quoted text.','--base','main','--head','proposal','--draft','--label','review','--label','docs','--reviewer','octocat']);
 // A mutation of the expected boundary must be caught, not merely a successful process.
 assert.throws(()=>assert.equal(calls[0][5],'WRONG TITLE'),assert.AssertionError);
 console.log(dry.stdout);console.log('PASS check: zero requests; dry: exact preview, zero requests; 3 invalid proposals in both modes; real: exact argv, one loopback request; wrong-title control caught');
}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(work,{recursive:true,force:true});}
