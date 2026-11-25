import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";

import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ProjectService, replay} from "../packages/core/project-service.ts";
import {itemFingerprint} from "../packages/core/validation.ts";

import type {DomainEvent} from "../packages/shared-types/domain.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";

import {createXmiServer} from "../apps/mcp-server/server.ts";
import {createSingleReviewRouter} from "../apps/local-module-review/single.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";


import {reviewProjectService} from "./fixtures/spec-review-project.ts";

type ClosingResult = {ok: boolean; data: {model_version: number; owner_action: string; user_message: string;
  owner_review?: {review_id: string; review_text: string; base_version: number};
  technical: {repair_item_ids: string[]; candidate_available: boolean; needs_blueprint_check: boolean}}};

async function fixture(t: TestContext, events: DomainEvent[]) {
  const folder = mkdtempSync(join(tmpdir(), "xmi-finalize-")), path = join(folder, "state.sqlite");
  const store = new SqliteProjectStore(path), service = new ProjectService(store), project = replay(events);
  store.transaction(tx => {for (const event of events) tx.append(event); tx.save(project);});
  const router = createSingleReviewRouter(folder, path, undefined, service);
  const server = createXmiServer(service, {singleReview: router});
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: "xmi-finalize-replay", version: "1"});
  await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); store.close(); rmSync(folder, {recursive: true, force: true});});
  const close = async (extra: object = {}) => {
    const result = await client.callTool({name: "xmi_finalize", arguments: {schema_version: "0.1.0", project_id: project.project_id,
      expected_version: project.model_version, idempotency_key: "finish", ...extra}});
    return result.structuredContent as ClosingResult;
  };
  return {client, close, project, service, folder};
}

test("finalization is a native tool and the default receipt keeps engineering jargon out of chat", async t => {
  const seed = reviewProjectService();
  const events = seed.service.history(seed.project.project_id); seed.store.close();
  const f = await fixture(t, events);
  assert((await f.client.listTools()).tools.some(tool => tool.name === "xmi_finalize" && tool.annotations?.destructiveHint === false));
  const result = await f.close();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.owner_action, "NONE");
  assert.doesNotMatch(result.data.user_message, /M8|XSpec|ABI|sha|权限|蓝图|版本|ABORT/u);
  assert.equal(result.data.technical, undefined);
});

test("a genuine new choice uses one bound reply and leaves no extra owner action", async t => {
  const seed = reviewProjectService(), original = seed.project;
  const draft = {id: "REQ-TRY-AGAIN", type: "functional_requirement", status: "PROPOSED", statement: "Show a Retry button when starting fails.",
    source_refs: [{type: "conversation_turn", ref: "test:retry-choice"}]};
  seed.service.execute({project_id: original.project_id, expected_version: original.model_version, idempotency_key: "draft",
    command: {kind: "CANDIDATE_EXTRACTED", candidate: draft}});
  const events = seed.service.history(original.project_id); seed.store.close();
  const f = await fixture(t, events), session = "00000000-0000-4000-8000-000000000101", turn = "00000000-0000-4000-8000-000000000102";
  const log = join(f.folder, "chat.jsonl"), candidate = f.project.items.find(item => item.id === draft.id)!;
  const prompt = (text: string) => processUserPrompt({hook_event_name: "UserPromptSubmit", session_id: session, turn_id: turn,
    prompt: text, transcript_path: log}, f.folder, f.folder);
  prompt("继续");
  const first = await f.close({session_id: session, decision_requests: [{schema_version: "0.1.0", operation: "xmi_item_confirm",
    project_id: f.project.project_id, expected_version: f.project.model_version, idempotency_key: "one-real-choice",
    item_id: candidate.id, item_version: candidate.version, fingerprint: itemFingerprint(candidate), intent: "CONFIRM"}]});
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.owner_action, "PRODUCT_CHOICE");
  assert.equal((await f.close({session_id: session})).data.owner_review, undefined);
  const review = first.data.owner_review!;
  writeFileSync(log, JSON.stringify({type: "session_meta", payload: {id: session}}) + "\n" +
    JSON.stringify({type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer",
      content: [{type: "output_text", text: review.review_text}]}}) + "\n");
  prompt("确认");
  const commit = await f.client.callTool({name: "xmi_item_review_commit", arguments: {schema_version: "0.1.0",
    project_id: f.project.project_id, expected_version: review.base_version, review_id: review.review_id, session_id: session}});
  assert.equal((commit.structuredContent as {ok?: boolean} | undefined)?.ok, true, JSON.stringify(commit.structuredContent));
  const next = f.service.get(f.project.project_id);
  assert.equal(next.items.find(item => item.id === candidate.id)?.status, "CONFIRMED");
  assert.equal((await f.close({session_id: session, expected_version: next.model_version, idempotency_key: "after-choice"})).data.owner_action, "NONE");
});
