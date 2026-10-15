import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";

const directory="packages/mammoth-api";
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
test("API-only derivative retains upstream source hashes and license while removing CLI install metadata",()=>{
  const upstream=JSON.parse(readFileSync(join(directory,"UPSTREAM.json"),"utf8"));
  assert.equal(upstream.upstream.version,"1.12.3");
  assert.equal(upstream.upstream.integrity,"sha512-kkv2MrSFk3f/w3uLsz4FG/91LdWp2j+qmp7AjG2v7w2xgX5YDxiaFlaWourXrXtyUR6335+9guyIlPBnhHLvKw==");
  for(const [path,hash] of Object.entries(upstream.files))assert.equal(sha(readFileSync(join(directory,path))),hash,path);
  const pkg=JSON.parse(readFileSync(join(directory,"package.json"),"utf8"));
  assert.equal(pkg.name,"@xmi/mammoth-api");assert.equal(pkg.private,true);assert.equal(pkg.bin,undefined);assert.equal(pkg.scripts,undefined);
  assert.equal(pkg.dependencies.argparse,undefined);assert.equal(pkg.dependencies["sprintf-js"],undefined);
  assert.equal(existsSync(join(directory,"bin")),false);assert.equal(existsSync(join(directory,"lib/main.js")),false);
  assert.match(readFileSync(join(directory,"LICENSE"),"utf8"),/Copyright \(c\) 2013, Michael Williamson/);
});

test("installed lockfile contains no vulnerable CLI packages and tracks the honest local derivative identity",()=>{
  const pkg=JSON.parse(readFileSync("package.json","utf8")),lock=JSON.parse(readFileSync("package-lock.json","utf8"));
  assert.equal(pkg.dependencies.mammoth,undefined);assert.equal(pkg.dependencies["@xmi/mammoth-api"],"file:packages/mammoth-api");
  for(const path of Object.keys(lock.packages))assert.doesNotMatch(path,/(^|\/)node_modules\/(mammoth|argparse|sprintf-js)$/);
  assert.equal(lock.packages["packages/mammoth-api"].name,"@xmi/mammoth-api");
  assert.equal(lock.packages["node_modules/@xmi/mammoth-api"].link,true);
});

test("browser component inventory binds exact bundle bytes and has no hidden old CLI or ZIP copy",()=>{
  const sbom=JSON.parse(readFileSync(join(directory,"browser.SBOM.json"),"utf8"));
  assert.equal(sbom.artifact_sha256,sha(readFileSync(join(directory,"browser.cjs"))));
  assert.equal(sbom.source_manifest_sha256,sha(readFileSync(join(directory,"UPSTREAM.json"))));
  assert.equal(sbom.components.find((entry:{name:string})=>entry.name==="jszip").version,"3.10.2");
  for(const component of sbom.components) {
    assert.ok(component.license_files.length>0);assert.ok(!["mammoth","argparse","sprintf-js"].includes(component.name));
    assert.ok(readFileSync(join(directory,"THIRD-PARTY-NOTICES.txt"),"utf8").includes(component.name+"@"+component.version));
  }
  for(const [path,hash] of Object.entries(sbom.inputs))assert.equal(sha(readFileSync(path)),hash,path);
});

test("source checker and browser build reproduce checked-in artifacts without network access",()=>{
  assert.match(execFileSync(process.execPath,["tools/prepare-docx-api.mjs","--check"],{encoding:"utf8"}),/DOCX_SOURCE_VERIFIED/);
  assert.match(execFileSync(process.execPath,["tools/build-docx-browser.mjs","--check"],{encoding:"utf8"}),/DOCX_BROWSER_REPRODUCED/);
});

test("public source collection preserves third-party bytes and includes the file dependency in lean layouts",()=>{
  const probe=`import {publicFiles} from './tools/package-release.mjs';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
    const files=publicFiles(process.cwd()),manifest=JSON.parse(readFileSync('packages/mammoth-api/UPSTREAM.json','utf8'));
    for(const file of [...Object.keys(manifest.files),...manifest.generated,'UPSTREAM.json']) {
      const path='packages/mammoth-api/'+file;assert.deepEqual(files.get(path),readFileSync(path));
    } console.log('PUBLIC_DEPENDENCY_BYTES_VERIFIED');`;
  assert.match(execFileSync(process.execPath,["--input-type=module","-e",probe],{encoding:"utf8"}),/PUBLIC_DEPENDENCY_BYTES_VERIFIED/);
});
