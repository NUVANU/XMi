// Isolated STDIO host fixture. Only test-owned paths are passed by mcp.test.ts;
// synthetic native events are delivered by the parent test, never to real user data.
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {SqliteProjectStore} from "../../packages/storage/sqlite.ts";
import {ProjectService} from "../../packages/core/project-service.ts";
import {createXmiServer} from "../../apps/mcp-server/server.ts";
import {createSingleReviewRouter} from "../../apps/local-module-review/single.ts";
const [db, directory] = process.argv.slice(2);
if (!db || !directory) throw new Error("TEST_PATHS_REQUIRED");
const store = new SqliteProjectStore(db);
const service = new ProjectService(store);
const server = createXmiServer(service, {singleReview:createSingleReviewRouter(directory,db,undefined,service)});
server.onclose = () => store.close();
await server.connect(new StdioServerTransport(process.stdin,process.stdout));
