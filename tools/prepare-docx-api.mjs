import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
export const upstream={name:'mammoth',version:'1.12.3',url:'https://registry.npmjs.org/mammoth/-/mammoth-1.12.3.tgz',
  integrity:'sha512-kkv2MrSFk3f/w3uLsz4FG/91LdWp2j+qmp7AjG2v7w2xgX5YDxiaFlaWourXrXtyUR6335+9guyIlPBnhHLvKw=='};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  assert.ok(!entry.isSymbolicLink(),'Refuse source symlinks');
  const path=join(directory,entry.name);return entry.isDirectory()?walk(path):[path];
});
export function verifyDocxSource(directory=join(root,'packages/mammoth-api')) {
  const manifest=JSON.parse(readFileSync(join(directory,'UPSTREAM.json')));
  assert.deepEqual(manifest.upstream,upstream);
  const actual=walk(directory).map(path=>path.slice(directory.length+1).replaceAll('\\','/')).sort();
  assert.deepEqual(actual,[...Object.keys(manifest.files),'UPSTREAM.json',...manifest.generated].sort());
  for(const [path,hash] of Object.entries(manifest.files))assert.equal(sha(readFileSync(join(directory,path))),hash,path);
  const pkg=JSON.parse(readFileSync(join(directory,'package.json')));
  assert.equal(pkg.name,'@xmi/mammoth-api');assert.equal(pkg.bin,undefined);
  assert.ok(!('argparse' in pkg.dependencies));
  for(const path of actual)assert.ok(!/(^|\/)(?:bin|main\.js|argparse|sprintf-js)(\/|$)/.test(path));
  return manifest;
}
export function prepareDocxSource(archive,directory=join(root,'packages/mammoth-api')) {
  const bytes=readFileSync(archive);
  assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),upstream.integrity,'Untrusted upstream archive');
  assert.ok(!existsSync(directory),'Refuse replacing an existing managed source; review an upstream change explicitly.');
  const names=execFileSync('tar',['-tf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
  assert.ok(names.every(name=>name.startsWith('package/')&&!name.includes('..')&&!name.includes('\\')));
  const read=name=>execFileSync('tar',['-xOf',archive,'package/'+name],{maxBuffer:4*1024*1024});
  const original=JSON.parse(read('package.json'));
  assert.equal(original.version,upstream.version);
  const selected=names.filter(name=>/^package\/(lib|browser)\/.+\.(js|ts)$/.test(name)&&name!=='package/lib/main.js')
    .map(name=>name.slice(8));
  const files=new Map(selected.map(name=>[name,read(name)]));
  files.set('LICENSE',read('LICENSE'));
  files.set('UPSTREAM-PACKAGE.json',read('package.json'));
  const dependencies={...original.dependencies};delete dependencies.argparse;
  const pkg={name:'@xmi/mammoth-api',version:'1.12.3-xmi.1',private:true,type:'commonjs',license:original.license,
    description:'XMi-managed API-only derivative of Mammoth 1.12.3; upstream parsing sources unchanged.',
    main:'./lib/index.js',types:'./lib/index.d.ts',browser:original.browser,
    exports:{'.':{types:'./lib/index.d.ts',default:'./lib/index.js'},'./browser':{types:'./lib/index.d.ts',default:'./browser.cjs'}},
    dependencies};
  files.set('package.json',Buffer.from(JSON.stringify(pkg,null,2)+'\n'));
  const manifest={upstream,changes:['Renamed and marked private; no registry publication.','Removed bin/, lib/main.js, argparse dependency and upstream build/test scripts.',
    'All retained upstream source/type files and LICENSE are byte-identical.','Browser artifact is rebuilt from these sources and current lockfile dependencies; no old prebundled dependency copy.'],
    files:Object.fromEntries([...files].map(([path,body])=>[path,sha(body)])),
    generated:['browser.cjs','browser.d.cts','browser.SBOM.json','THIRD-PARTY-NOTICES.txt']};
  files.set('UPSTREAM.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  for(const [path,body] of files){mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),body,{flag:'wx'});}
  return {source_files:files.size,upstream:upstream.version};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--check'){verifyDocxSource();console.log('DOCX_SOURCE_VERIFIED');}
  else {assert.equal(args.length,2);assert.equal(args[0],'--archive');console.log(JSON.stringify(prepareDocxSource(resolve(args[1]))));}
}
