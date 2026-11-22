import type {Item} from "../shared-types/domain.ts";

const zhFeature = "账号|账户|登录|鉴权|认证|支付|付款|外部(?:服务|接口|集成|\\s*API)|API|云端(?:服务)?|后端(?:服务)?";
const enFeature = "user accounts?|accounts?|sign[- ]?in|login|authentication|payments?|checkout|external (?:services?|integrations?|apis?)|cloud(?: services?)?|back[- ]?end(?: services?)?";
const zhExclusion = new RegExp(
  `(?:^|[：:，,。；;\\n])\\s*(?:不需要|无需|无须|不要求|不接入|不支持|不使用|无)(?:${zhFeature})(?:\\s*(?:、|或|与|和|及)\\s*(?:${zhFeature}))*(?=\\s*(?:$|[。；;，,\\n]|但是|但|同时|并且))`,
  "giu",
);
const enExclusion = new RegExp(
  `(?:^|[:;,\\n.])\\s*(?:(?:does not require|no|without)\\s+)(?:${enFeature})(?:\\s*(?:,\\s*(?:or |and )?|(?:or|and)\\s+)(?:${enFeature}))*(?:\\s+(?:(?:are |is )?(?:used|required|included|supported)\\s+)?(?:in|for)\\s+(?:the )?(?:(?:first|current) (?:version|release)(?: scope)?|V0))?(?=\\s*(?:$|[.;,\\n]|\\bbut\\b))`,
  "gi",
);
const uncertain = /[?？]|是否|待定/u;

/** Remove only explicit feature exclusions. Independent positive clauses remain evidence. */
export function withoutExplicitScopeExclusions(statement: string): string {
  if (uncertain.test(statement)) return statement;
  return statement.replace(zhExclusion, " ").replace(enExclusion, " ");
}

const excludedScopeWords = {
  account: /\b(?:user )?accounts?\b|账号|账户/i,
  payment: /\bpayments?\b|支付|付款/i,
  integration: /\bexternal (?:services?|integrations?|apis?)\b|外部(?:服务|接口|集成|\s*API)/i,
};

function hasExclusion(statement: string, feature: keyof typeof excludedScopeWords): boolean {
  if (uncertain.test(statement)) return false;
  const exclusions = [...statement.matchAll(zhExclusion), ...statement.matchAll(enExclusion)];
  const words = excludedScopeWords[feature];
  return exclusions.some(([clause]) => words.test(clause));
}

export function explicitlyExcludesScope(item: Item, feature: keyof typeof excludedScopeWords): boolean {
  return item.status === "CONFIRMED" && ["exclusion", "constraint", "solution_constraint", "integration"].includes(item.type) &&
    hasExclusion(item.statement, feature);
}

export function hasAccountOrPrivateScope(item: Item): boolean {
  if (item.type === "solution_blueprint") return false;
  const statement = withoutExplicitScopeExclusions(item.statement);
  const text = statement === item.statement ? `${statement} ${(item.tags ?? []).join(" ")}` : statement;
  return item.type === "permission_rule" ||
    /account|login|sign.?in|private data|tenant|role|permission|账号|账户|登录|私有数据|租户|角色|权限/i.test(text);
}

export function hasExternalIntegrationScope(item: Item): boolean {
  if (item.type === "solution_blueprint") return false;
  const statement = withoutExplicitScopeExclusions(item.statement);
  const text = statement === item.statement ? `${statement} ${(item.tags ?? []).join(" ")}` : statement;
  return item.type === "integration" && !hasExclusion(item.statement, "integration") ||
    /integration|provider|\bapi\b|email|notification|webhook|oauth|map|ai service|集成|供应商|接口|邮件|通知|地图|外部服务/i.test(text);
}

/** Deliberately local matching, retaining any positive clause in a mixed statement. */
export function hasOnlineGameScope(statement: string): boolean {
  const explicitExclusion = /^(?:本版|原型|首版)?\s*(?:无|不支持|不接入|不包含|无需)\s*(?:多人联机|联机|多人)(?:模式|功能)?\s*$/u;
  const signal = /online|multiplayer|network|matchmaking|server|联机|多人|网络|匹配|服务器|各自(?:的)?设备.{0,28}(?:同一|一起|共享|对战|竞技)|(?:两台|不同|多台)设备.{0,24}(?:同一|一起|共享|同步)|跨设备.{0,16}(?:同局|同步|对战)/i;
  return statement.split(/[。；;，,\n]|但是|但/u).some(clause =>
    !explicitExclusion.test(clause.trim()) && signal.test(clause));
}
