import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {workbuddyProfile} from './configure.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=root=>path=>readFileSync(join(root,path));
const walk=(root,directory)=>readdirSync(join(root,directory),{withFileTypes:true}).flatMap(entry=>{
  const p=directory+'/'+entry.name;
  if(entry.isSymbolicLink())throw new Error('Public package refuses symlinks: '+p);
  return entry.isDirectory()?walk(root,p):[p];
});
export function publicFiles(root) {
  const load=read(root),files=new Map();
  const paths=['package.json','package-lock.json','tsconfig.json','eslint.config.mjs','.node-version','LICENSE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md',
    ...['packages','schemas','samples','apps/mcp-server','apps/local-module-review','plugins/xmi','tests','tools','.github','docs/public','docs/adr'].flatMap(p=>walk(root,p)),
    ...readdirSync(join(root,'docs')).filter(p=>/^\d\d-.*\.md$/.test(p)).map(p=>'docs/'+p),
    ...['M0-CAPABILITY-REPORT.md','M0-IMPLEMENTATION-DECISION.md','M0-MILESTONE-REPORT.md','M10-MILESTONE-REPORT.md','M11-OWNER-ACCEPTANCE.md'].map(p=>'docs/'+p),
    'docs/evidence/M3-FORWARD-TESTS.json'];
  const redact=text=>text.replace(/\b[A-Za-z]:[/\\][^\s"'`<>]+/g,'/local/redacted-path')
    .replace(/01a[0-9a-f]{5}-[0-9a-f-]{27}/gi,'redacted-session-id')
    .replace(/XMI-[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}/g,'XMI-REDACTED')
    .replace(/https:\/\/chatgpt\.com\/c\/[^\s"'`<>]+/g,'https://example.invalid/private-conversation')
    .replace(/\bEAMI\b|Blazing Warband/g,'private-test-project')
    .replace(/MarcoTsui1\/XMi/g,'NUVANU/XMi');
  for(const path of new Set(paths)) {
    if(/\.bak-|\.xmem-backup-|runtime\.json$/.test(path)) {
      if(path.endsWith('hooks/runtime.json'))files.set(path,Buffer.from('{"source_root":"<abs-path-to-xmi-repo>"}\n'));
      continue;
    }
    // Preserve byte-identical third-party provenance and generated bundle checksums.
    if(path.startsWith('packages/mammoth-api/')){files.set(path,load(path));continue;}
    let text=load(path).toString('utf8').replaceAll('\r\n','\n');
    if(path.startsWith('docs/')&&!path.startsWith('docs/public/'))text=redact(text);
    if(text.length&&!path.endsWith('ADR-006-XMI-XDEV-DELIVERY-HANDOFF-ENVELOPE.md'))text=text.trimEnd()+'\n';
    files.set(path,Buffer.from(text));
  }
  files.set('README.md',load('docs/public/README.md'));
  files.set('AGENTS.md',Buffer.from(load('AGENTS.md').toString().split('## XMem project continuity')[0].trimEnd()+'\n'));
  files.set('.gitignore',Buffer.from(load('.gitignore').toString().trimEnd()+'\n\n# Never publish personal host state or product data\n.codex/\n.xmi-install/\n.env\n.env.*\n*.sqlite\n*.sqlite-wal\n*.sqlite-shm\n*.jsonl\n'));
  files.set('.gitattributes',Buffer.from('* text=auto eol=lf\n*.zip binary\n*.png binary\n# Upstream provenance hashes require original bytes on every checkout.\npackages/mammoth-api/** -text\n'));
  for(const [path,bytes] of files) {
    if(path.split('/').includes('..')||isAbsolute(path)||/^(\.git|\.codex|exports|node_modules)\//.test(path)||/\.(sqlite|jsonl)$/.test(path))throw new Error('Private package path: '+path);
    if(/[A-Za-z]:[/\\]+Users[/\\]+[^\s"'`<>]+|[A-Za-z]:[/\\]+(?:backup|XMem)[/\\]+/i.test(bytes.toString()))throw new Error('Unredacted private marker: '+path);
  }
  return files;
}
export async function packageRelease(root,output) {
  root=resolve(root);output=resolve(output);
  const scope=relative(root,output);if(scope.startsWith('..')||isAbsolute(scope)||!/^exports(?:[/\\]|$)/.test(scope))throw new Error('Output must be under this source exports directory.');
  const version=JSON.parse(readFileSync(join(root,'package.json'))).version,prefix='xmi-'+version;
  const source=join(output,prefix+'-source');if(existsSync(source))throw new Error('Candidate exists; choose a new --out directory instead of overwriting it.');
  const files=publicFiles(root);mkdirSync(source,{recursive:true});
  for(const [path,body]of files){mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),body,{flag:'wx'});}
  async function archive(name,entries) {
    const zip=new JSZip();const sums=Object.fromEntries([...entries].map(([p,b])=>[p,hash(b)]));
    for(const [p,b]of entries)zip.file(name+'/'+p,b);
    zip.file(name+'/SHA256SUMS.json',JSON.stringify(sums,null,2)+'\n');
    const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),path=join(output,name+'.zip');
    writeFileSync(path,bytes,{flag:'wx'});writeFileSync(path+'.sha256',hash(bytes)+'  '+name+'.zip\n',{flag:'wx'});
    // Inspect archive bytes, not just the source map.
    const packed=await JSZip.loadAsync(readFileSync(path));
    for(const [p,b]of entries)if(hash(await packed.file(name+'/'+p).async('nodebuffer'))!==hash(b))throw new Error('Archive mismatch: '+p);
    return {path,bytes:bytes.length,sha256:hash(bytes),files:entries.size+1};
  }
  const sourceArchive=await archive(prefix+'-source',files);
  const lite=new Map([...files].filter(([p])=>!p.startsWith('tests/')&&!p.startsWith('.github/')&&(!p.startsWith('docs/')||p.startsWith('docs/public/'))&&p!=='tools/package-release.mjs'));
  // Lean installer uses production dependencies; release construction remains in the source archive.
  const litePackage=JSON.parse(lite.get('package.json'));delete litePackage.scripts['package:release'];
  lite.set('package.json',Buffer.from(JSON.stringify(litePackage,null,2)+'\n'));
  for(const name of ['xmi-discovery','xmi-audit-export']) {
    const skill=new JSZip(),base='plugins/xmi/skills/'+name+'/';
    for(const [p,b]of files)if(p.startsWith(base)) {
      const body=p.endsWith('/SKILL.md')?Buffer.from(b.toString().replace(/^(---\n[\s\S]*?\n---\n)/,'$1'+workbuddyProfile)):b;
      skill.file(name+'/'+p.slice(base.length),body);
    }
    lite.set('workbuddy-skills/'+name+'.zip',await skill.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  }
  const liteArchive=await archive(prefix+'-lite',lite);
  const report={version,status:'LOCAL_RELEASE_CANDIDATE_NOT_PUBLISHED',source_directory:source,source_archive:sourceArchive,lite_archive:liteArchive,
    private_git_history_included:false,node_or_node_modules_included:false,remote_or_marketplace_published:false,github_ci_executed:false};
  writeFileSync(join(output,'RELEASE-MANIFEST.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'))throw new Error('Usage: npm run package:release -- [--out exports/<new-directory>]');
    console.log(JSON.stringify(await packageRelease(dirname(dirname(fileURLToPath(import.meta.url))),args[1]??'exports/releases'),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
