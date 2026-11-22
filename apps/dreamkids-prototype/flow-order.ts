import type {PrototypePreview} from "../../packages/core/prototype-preview.ts";

export function numberedFlow(flow: PrototypePreview["flow"]) {
  const start = flow.steps.find(node => node.kind === "START")!;
  const order = [start.id], seen = new Set(order);
  for (const id of order) for (const edge of flow.edges.filter(edge => edge.from === id)) {
    if (!seen.has(edge.to)) {order.push(edge.to); seen.add(edge.to);}
  }
  const nodes = new Map(flow.steps.map(node => [node.id, node]));
  return order.map((id, index) => ({...nodes.get(id)!, number: index + 1}));
}
