import {existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {requireCondition} from "../../packages/core/errors.ts";
import {fingerprint} from "../../packages/core/validation.ts";
import type {CompiledArtifact} from "../../packages/core/xspec-service.ts";
import {projectDirectory, projectPath} from "../../packages/storage/project-files.ts";
import {SqliteProjectStore} from "../../packages/storage/sqlite.ts";

function verifyPackage(directory: string, artifact: CompiledArtifact) {
  const expected = artifact.files.map(file => file.path).sort();
  requireCondition(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink() &&
    readdirSync(directory).sort().join("\n") === expected.join("\n"), "XSPEC_EXPORT_PACKAGE_MISMATCH");
  for (const {path, content} of artifact.files) {
    const file = projectPath(directory, path);
    requireCondition(lstatSync(file).isFile() && readFileSync(file).equals(Buffer.from(content)), "XSPEC_EXPORT_PACKAGE_MISMATCH");
  }
}

function exportRoot(directory: string) {
  const root = projectDirectory(directory);
  mkdirSync(root, {recursive: true});
  return root;
}

export function openPrototypeConfirmationStore(directory: string) {
  const path = projectPath(exportRoot(directory), ".xmi-prototype-confirmations.sqlite");
  requireCondition(!existsSync(path) || lstatSync(path).isFile(), "XSPEC_EXPORT_DESTINATION_INVALID");
  return new SqliteProjectStore(path);
}

export function publishPrototypeExport(directory: string, artifact: CompiledArtifact): string {
  // The host supplies this directory; the draft and chat reply cannot choose a path.
  const root = exportRoot(directory);
  const digest = fingerprint(artifact.files.map(({path, sha256}) => [path, sha256]));
  const target = projectPath(root, "DreamKids-XSpec-" + digest.slice(0, 32));
  if (existsSync(target)) {
    verifyPackage(target, artifact);
    return target;
  }
  const staging = mkdtempSync(join(root, ".xmi-stage-"));
  const written: string[] = [];
  try {
    for (const {path, content} of artifact.files) {
      const file = projectPath(staging, path);
      // Record the path first so a failed write can also clean up a partial file.
      written.push(file);
      writeFileSync(file, content, {flag: "wx", mode: 0o600, flush: true});
    }
    verifyPackage(staging, artifact);
    try {renameSync(staging, target);}
    catch (error) {if (!existsSync(target)) throw error;}
    verifyPackage(target, artifact);
    return target;
  } finally {
    if (existsSync(staging)) {
      for (const file of written) if (existsSync(file)) unlinkSync(file);
      rmdirSync(staging);
    }
  }
}
