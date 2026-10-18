import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {ProjectWorkspaces} from '../apps/mcp-server/project-workspaces.ts';
import {projectDirectory,boundedProjectJson,projectPath} from '../packages/storage/project-files.ts';

// Explicit recovery of generated reading files only. Never changes product events.
export function rebuildProjectContext(directory) {
  const root=projectDirectory(directory),manifest=boundedProjectJson(projectPath(root,'.xmi','project.json'));
  const manager=new ProjectWorkspaces(projectPath(root,'.xmi','locations.sqlite'));
  const binding=manager.resolve(manifest.project_id,root);
  try {const result=manager.sync(binding,false);if(result.context_status!=='CURRENT')throw new Error('PROJECT_CONTEXT_STALE');return result;}
  finally{binding.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--project-dir')throw new Error('Use --project-dir <absolute-project-directory>');
    console.log(JSON.stringify(rebuildProjectContext(args[1])));
  }catch{console.error('PROJECT_CONTEXT_REBUILD_FAILED: verify the project directory and canonical database. No product decisions were changed.');process.exitCode=1;}
}
