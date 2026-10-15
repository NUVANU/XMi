import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build,version} from 'esbuild';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function browserArtifacts() {
  const result=await build({absWorkingDir:root,entryPoints:['packages/mammoth-api/lib/index.js'],bundle:true,platform:'browser',
    format:'cjs',target:'es2022',minify:true,legalComments:'eof',metafile:true,write:false,outfile:'packages/mammoth-api/browser.cjs',logLevel:'silent'});
  const code=result.outputFiles[0].contents;
  const components=new Map(),inputs={};
  for(const path of Object.keys(result.metafile.inputs).sort()) {
    assert.ok(!/(argparse|sprintf-js|lib\/main\.js)/.test(path),'CLI code reached browser bundle');
    assert.ok(!result.metafile.inputs[path].imports.some(entry=>entry.external),'Unexpected external browser import');
    inputs[path.replaceAll('\\','/')]=sha(readFileSync(resolve(root,path)));
    let directory=dirname(resolve(root,path));
    while(!existsSync(join(directory,'package.json'))||!JSON.parse(readFileSync(join(directory,'package.json'))).name){
      const next=dirname(directory);assert.notEqual(next,directory);directory=next;
    }
    const pkg=JSON.parse(readFileSync(join(directory,'package.json')));
    const key=pkg.name+'@'+pkg.version;
    if(components.has(key))continue;
    const licenses=readdirSync(directory).filter(name=>/^(license|licence|copying)(\.|$|-)/i.test(name)&&!name.endsWith('.json'))
      .sort().map(name=>({path:name,text:readFileSync(join(directory,name),'utf8')}));
    assert.ok(licenses.length,'Missing license text: '+key);
    components.set(key,{name:pkg.name,version:pkg.version,license:pkg.license,licenses});
  }
  const list=[...components.values()].sort((a,b)=>a.name.localeCompare(b.name,'en'));
  const sbom={format:'XMI-BROWSER-COMPONENTS/1',builder:{name:'esbuild',version},
    upstream:'mammoth@1.12.3',source_manifest_sha256:sha(readFileSync(join(root,'packages/mammoth-api/UPSTREAM.json'))),
    artifact_sha256:sha(code),components:list.map(({licenses,...pkg})=>({...pkg,license_files:licenses.map(entry=>entry.path)})),inputs};
  const notices=list.map(pkg=>pkg.name+'@'+pkg.version+' — '+pkg.license+'\n'+pkg.licenses.map(entry=>entry.path+'\n'+entry.text).join('\n')).join('\n\n');
  return new Map([['browser.cjs',Buffer.from(code)],['browser.SBOM.json',Buffer.from(JSON.stringify(sbom,null,2)+'\n')],
    ['browser.d.cts',Buffer.from('export function extractRawText(input:{arrayBuffer:ArrayBuffer}):Promise<{value:string;messages:unknown[]}>;\n')],
    ['THIRD-PARTY-NOTICES.txt',Buffer.from(notices.trimEnd()+'\n')]]);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===1&&args[0]==='--check'));
  for(const [file,body] of await browserArtifacts()) {
    const path=join(root,'packages/mammoth-api',file);
    if(args[0]==='--check')assert.equal(sha(readFileSync(path)),sha(body),relative(root,path));
    else writeFileSync(path,body);
  }
  console.log(args[0]==='--check'?'DOCX_BROWSER_REPRODUCED':'DOCX_BROWSER_BUILT');
}
