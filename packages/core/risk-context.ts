import type {Item} from "../shared-types/domain.ts";

// Remove only specific operational terms, never the rest of a mixed statement.
// Negation, future plans and ambiguous intent still require Owner review.
export function riskContext(statement: string): string {
  return statement
    .split(/[。；;\n]/u).map(clause => {
      const operational = /系统|服务|运行|接口|平台|readiness|\b(?:system|service|operational|endpoint)\b/i.test(clause);
      const personal = /用户|玩家|个人|患者|病人|身体|医疗|\b(?:user|player|personal|patient|medical)\b/i.test(clause);
      return operational && !personal
        ? clause.replace(/健康(?:页|检查|状态|监控)|\bhealth(?: check| page| endpoint| dashboard| status| monitoring)s?\b/gi, " ")
        : clause;
    }).join(";")
    .replace(/破坏性(?:版本)?(?:变化|变更)|\bbreaking changes?\b/gi, " ");
}

// DEFER_OR_EXCLUDE removes whole item IDs in the existing handoff contract.
// Mixed prose must be split and reviewed; rationale cannot narrow that operation.
export function unsafeExclusionItems(items: Item[], pattern: RegExp): string[] {
  return items.filter(item => {
    if (item.decision_detail || item.blueprint_detail) return true;
    if (/(?:保留|仍需|继续|retain|keep)/i.test(item.statement) && /延期|后置|后续|未来|排除|关闭|defer|exclud|future/i.test(item.statement)) return true;
    if (/本期|首期|当前|\bcurrent\b|first release/i.test(item.statement) && /后续|未来|以后|后置|延期|\blater\b|\bfuture\b|\bdefer/i.test(item.statement)) return true;
    if (/影子|合成|模拟|\b(?:shadow|synthetic|sandbox)\b|dry.?run/i.test(item.statement) && /真实|实际|\b(?:real|live)\b|收费|扣款/i.test(item.statement)) return true;
    const clauses = riskContext(item.statement).split(/[。；;，,\n]|\b(?:and|but|while|plus)\b|以及|同时|并且|和/iu)
      .map(value => value.trim()).filter(Boolean);
    return !clauses.length || clauses.some(clause => !pattern.test(clause));
  }).map(item => item.id);
}
