import test from "node:test";
import assert from "node:assert/strict";
import {cpSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {publicFiles} from "../tools/package-release.mjs";

function fixture(t: {after: (fn: () => void) => void}) {
  const base=mkdtempSync(join(tmpdir(),"xmi-installer-")),root=join(base,"install"),data=join(base,"my-data");
  mkdirSync(join(root,"tools"),{recursive:true});
  cpSync("tools/configure.mjs",join(root,"tools/configure.mjs"));
  mkdirSync(join(root,"plugins"));cpSync("plugins/xmi",join(root,"plugins/xmi"),{recursive:true});
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const run=(host: string,path=data)=>spawnSync(process.execPath,[join(root,"tools/configure.mjs"),"--host",host,"--data-dir",path],{encoding:"utf8"});
  return {base,root,data,run};
}
test("public configuration generates independent Codex and generic-host routes without creating a database",t=>{
  const f=fixture(t),result=f.run("codex");assert.equal(result.status,0,result.stderr);
  const record=JSON.parse(result.stdout),config=JSON.parse(readFileSync(record.configuration,"utf8"));
  assert.equal(config.mcpServers.xmi.command,process.execPath);
  assert.equal(config.mcpServers.xmi.args[0],join(f.root,"apps/mcp-server/main.ts"));
  assert.equal(JSON.parse(readFileSync(join(record.plugin_directory,"hooks/runtime.json"),"utf8")).source_root,f.root);
  assert.equal(existsSync(record.database),false);
  const other=f.run("workbuddy",join(f.base,"other-data"));assert.equal(other.status,0,other.stderr);
  const otherRecord=JSON.parse(other.stdout),generic=JSON.parse(readFileSync(otherRecord.configuration,"utf8"));
  assert.equal(generic.mcpServers.xmi.args[0],join(f.root,"apps/mcp-server/generic.ts"));
  assert.equal(generic.mcpServers.xmi.disabledTools.length,6);
  assert.match(readFileSync(join(otherRecord.skills_directory,"xmi-discovery/SKILL.md"),"utf8"),/WorkBuddy platform profile/);
});
test("public configuration refuses invalid paths, existing databases and configuration overwrite",t=>{
  const f=fixture(t);
  for(const path of ["relative",f.root,join(f.root,"data"),"//server/share"])assert.notEqual(f.run("codex",path).status,0);
  mkdirSync(f.data);writeFileSync(join(f.data,"xmi-state.sqlite"),"fixture preserve");
  assert.notEqual(f.run("codex").status,0);assert.equal(readFileSync(join(f.data,"xmi-state.sqlite"),"utf8"),"fixture preserve");
  assert.notEqual(f.run("unknown",join(f.base,"unknown")).status,0);
  const created=f.run("codex",join(f.base,"fresh"));assert.equal(created.status,0,created.stderr);
  const record=JSON.parse(created.stdout),before=readFileSync(record.configuration,"utf8");
  assert.notEqual(f.run("codex",join(f.base,"another")).status,0);assert.equal(readFileSync(record.configuration,"utf8"),before);
});
test("native module guidance requires durable grant and commit, never direct hook canonical writes",()=>{
  const skill=readFileSync(resolve("plugins/xmi/skills/xmi-discovery/SKILL.md"),"utf8"),workflow=readFileSync(resolve("plugins/xmi/skills/xmi-discovery/references/tool-workflow.md"),"utf8");
  for(const text of [skill,workflow]){assert.match(text,/xmi_module_review_commit/);assert.match(text,/GRANTED/);assert.doesNotMatch(text,/writes Owner events atomically|bridge may turn that actual reply into Owner events/);}
});

test("public source preserves audited parser bytes while excluding personal state and diagnostic identities",()=>{
  const files=publicFiles(resolve('.'));
  assert.match(files.get('.gitattributes')!.toString(),/^packages\/mammoth-api\/\*\* -text$/m);
  for(const [path,bytes] of files) {
    assert.doesNotMatch(path,/^(?:apps\/cloud-site|exports|\.git|\.codex|\.xmem|node_modules)\/|\.(?:sqlite|jsonl)$/);
    if(path.startsWith('docs/')&&!path.startsWith('docs/public/')) {
      assert.doesNotMatch(bytes.toString(),/\bEAMI\b|Blazing Warband|chatgpt\.com\/c\/|MarcoTsui1\/XMi/);
    }
    if(path.startsWith('packages/mammoth-api/'))assert.deepEqual(bytes,readFileSync(path));
  }
  assert.match(files.get('README.md')!.toString(),/https:\/\/github\.com\/NUVANU\/XMi/);
});
