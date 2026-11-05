import {cpSync,existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync,openSync,closeSync,unlinkSync,statSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

export const nativeTools=['xmi_module_review_prepare','xmi_module_review_status','xmi_module_review_commit',
  'xmi_item_review_prepare','xmi_item_review_status','xmi_item_review_commit'];
export const workbuddyProfile='\n## WorkBuddy platform profile\n\nThis host uses generic MCP form elicitation, not Codex hooks. Do not call xmi_module_review_* or xmi_item_review_* or request a Codex session ID. Discuss complete modules with current rules/tables, relevant context, open decisions and recommendations. Save grounded drafts through tools; use xmi_item_confirm and genuine host forms for adoption. If CONSENT_UNAVAILABLE, retain discussion and report the limitation; never fabricate authority or write the database directly. This platform profile overrides Codex-specific instructions below.\n';
const inside=(parent,child)=>{const p=relative(parent,child);return p===''||(!p.startsWith('..')&&!isAbsolute(p));};
export function configure(root,input,host,cloudConfig) {
  if(process.versions.node!=='24.20.0')throw new Error('Use Node 24.20.0.');
  if(!['codex','workbuddy'].includes(host))throw new Error('Choose --host codex or --host workbuddy.');
  if(!isAbsolute(input)||input.startsWith('\\\\')||input.startsWith('//'))throw new Error('Choose an absolute local data directory.');
  root=realpathSync(root);
  let cloudPath;
  if(cloudConfig) {
    try {
      if(!isAbsolute(cloudConfig)||cloudConfig.startsWith('\\\\')||cloudConfig.startsWith('//')||!statSync(cloudConfig).isFile()||statSync(cloudConfig).size>4096)throw new Error('invalid');
      cloudPath=realpathSync(cloudConfig);
      const value=JSON.parse(readFileSync(cloudPath,'utf8')),url=new URL(value.endpoint);
      if(value.schema_version!=='XMI-HYBRID-CONNECTION/1'||!/^XMIK-[A-Za-z0-9_-]{43}$/.test(value.project_key)||
        Object.keys(value).some(key=>!['schema_version','endpoint','project_key'].includes(key))||url.username||url.password||url.search||url.hash||
        (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('invalid');
      if(inside(root,cloudPath)||inside(resolve(input),cloudPath))throw new Error('invalid');
    }catch {throw new Error('Invalid private cloud connection file: keep it outside installation and product data; no values logged.');}
  }
  const directory=resolve(input),output=join(root,'.xmi-install',host+(cloudPath?'-hybrid':''));
  if(inside(root,directory))throw new Error('Keep product data outside the XMi installation.');
  if(existsSync(output))throw new Error('Configuration already exists; it will not be overwritten. Continue using that configuration.');
  if(existsSync(join(directory,'xmi-state.sqlite')))throw new Error('Data already exists here; this first-run helper will not take it over.');
  mkdirSync(directory,{recursive:true});
  const actual=realpathSync(directory);
  if(inside(root,actual))throw new Error('Data directory resolves inside the XMi installation.');
  if(cloudPath&&inside(actual,cloudPath))throw new Error('Keep the private cloud connection file outside product data.');
  const probe=join(actual,'.xmi-write-check-'+randomUUID());closeSync(openSync(probe,'wx'));unlinkSync(probe);
  mkdirSync(dirname(output),{recursive:true});mkdirSync(output);
  const json=(p,value)=>writeFileSync(join(output,p),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const server={command:process.execPath,args:[join(root,'apps','mcp-server',host==='codex'?'main.ts':'generic.ts'),'--db',join(actual,'xmi-state.sqlite')]};
  if(cloudPath) {
    server.args[0]=join(root,'apps','hybrid-connector','main.ts');
    server.env={XMI_CLOUD_CONFIG:cloudPath,XMI_HYBRID_HOST:host==='codex'?'native':'generic'};
  }
  if(host==='codex') {
    cpSync(join(root,'plugins','xmi'),output,{recursive:true});
    writeFileSync(join(output,'.mcp.json'),JSON.stringify({mcpServers:{xmi:{...server,env_vars:['CODEX_HOME']}}},null,2)+'\n');
    writeFileSync(join(output,'hooks','runtime.json'),JSON.stringify({source_root:root},null,2)+'\n');
  } else {
    json('mcp.json',{mcpServers:{xmi:{...server,type:'stdio',cwd:root,disabledTools:nativeTools}}});
    cpSync(join(root,'plugins','xmi','skills'),join(output,'skills'),{recursive:true});
    for(const skill of ['xmi-discovery','xmi-audit-export']) {
      const path=join(output,'skills',skill,'SKILL.md'),text=readFileSync(path,'utf8');
      writeFileSync(path,text.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/,'$1'+workbuddyProfile));
    }
  }
  return {status:'CONFIGURED_NOT_CONNECTED',host,configuration:join(output,host==='codex'?'.mcp.json':'mcp.json'),
    plugin_directory:host==='codex'?output:null,skills_directory:join(output,'skills'),database:join(actual,'xmi-state.sqlite'),
    note:'Import through the host-supported UI/CLI and complete its trust/consent step. Keep the installation directory in place.'};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const args=process.argv.slice(2);
    if(![4,6].includes(args.length)||args[0]!=='--host'||args[2]!=='--data-dir'||(args.length===6&&args[4]!=='--cloud-config'))throw new Error('Usage: node tools/configure.mjs --host codex|workbuddy --data-dir <absolute-local-directory> [--cloud-config <absolute-private-connection-file>]');
    console.log(JSON.stringify(configure(resolve(dirname(fileURLToPath(import.meta.url)),'..'),args[3],args[1],args[5]),null,2));
  } catch(error){console.error(error.message);process.exitCode=1;}
}
