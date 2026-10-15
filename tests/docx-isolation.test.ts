import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import JSZip from "jszip";
import {extractDocxText} from "../packages/core/docx-parser.ts";
import {extractRawText as browserText} from "@xmi/mammoth-api/browser";

async function document(text: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type: "uint8array", compression: "DEFLATE"});
}

test("DOCX text including malicious precision syntax stays data; CLI dependencies are never loaded", async () => {
  const bytes = await document("玩家背包 %.999999999f");
  assert.match(await extractDocxText(bytes), /玩家背包 %\.999999999f/);
  const probe = `const Module=require('node:module');const load=Module._load;
    Module._load=function(id,...args){if(/argparse|sprintf-js/.test(id))throw Error('CLI dependency reached');return load.call(this,id,...args);};
    const parts=[];process.stdin.on('data',b=>parts.push(b));process.stdin.on('end',async()=>{
      const result=await require('@xmi/mammoth-api').extractRawText({buffer:Buffer.concat(parts)});
      if(Object.keys(require.cache).some(p=>/argparse|sprintf-js/.test(p)))throw Error('CLI dependency loaded');
      process.stdout.write(result.value);
    });`;
  assert.match(execFileSync(process.execPath, ["-e", probe], {input: bytes, encoding: "utf8", timeout: 10000}), /玩家背包/);
});

test("malformed and oversized documents fail without raw-content errors; next document still works", async () => {
  await assert.rejects(extractDocxText(Buffer.from("private-fixture-not-a-zip")), /^DomainError: DOCUMENT_PARSE_FAILED$/);
  assert.throws(() => extractDocxText(new Uint8Array(5 * 1024 * 1024 + 1)), /DOCUMENT_SIZE_INVALID/);
  await assert.rejects(extractDocxText(await document("x".repeat(1024 * 1024 + 1))), /DOCUMENT_PARSE_LIMIT/);
  assert.match(await extractDocxText(await document("next document")), /next document/);
});

test("local and rebuilt browser APIs preserve upstream Chinese, table, tab and paragraph extraction",async()=>{
  const zip=new JSZip();
  zip.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+ 
    '<w:p><w:r><w:t>中文标题😀</w:t><w:tab/><w:t>第二列</w:t><w:br/><w:t>下一行</w:t></w:r></w:p>'+ 
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>道具名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>效果 %.999999999f</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'+ 
    '<w:p><w:r><w:t>结尾</w:t></w:r></w:p></w:body></w:document>');
  const bytes=await zip.generateAsync({type:"uint8array"}),local=await extractDocxText(bytes);
  const browser=(await browserText({arrayBuffer:bytes.buffer as ArrayBuffer})).value;
  assert.equal(browser,local);
  // Upstream raw-text extraction flattens soft breaks; retain its existing behavior.
  assert.match(local,/中文标题😀\t第二列下一行/);
  for(const text of ["道具名称","效果 %.999999999f","结尾"])assert.ok(local.includes(text));
  assert.match(local,/下一行\n\n/);
});
