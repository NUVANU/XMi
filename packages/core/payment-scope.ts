import type {Item, Project} from "../shared-types/domain.ts";
import {explicitlyExcludesScope, withoutExplicitScopeExclusions} from "./scope-exclusions.ts";

const active = (item: Item) => item.status !== "REJECTED" && item.status !== "SUPERSEDED";
const paymentWords = /\b(?:payments?|checkout|charges?|refunds?|stripe|subscriptions?)\b|支付|付款|扣款|退款|收款|充值|内购|付费抽卡|收取(?:服务费|月费|年费)|(?:收取|执行|自动|启用|实现|开始|支持|进行|发起|本期|首期|平台|立即)(?:实际|真实)?收费/i;
const legacyWords = /payment|billing|subscription|charge|refund|支付|账单|订阅|扣款|付款|收款|退款|充值/i;
const failureWords = /payment fail|card declined|billing fail|charge fail|支付失败|扣款失败|付款失败|充值失败/i;

function withoutInactivePayments(sentence: string, wholeOnly = false): string {
  if (/[?？]|是否|待定/u.test(sentence)) return sentence;
  return sentence.replace(/(?:正式手机版首发|正式首发|首发|首期|本期|当前|原型|V0)?\s*(?:暂时?|仍|继续)?(?:不|未)(?:接入|启用|支持|提供|实现|增加|新增)(?:首发|首期|本期|当前|原型|V0)?(?:真实|实际)?(?:支付(?:系统|功能)?|付款|充值|内购|付费抽卡|付费洗点)(?:(?:、|及|与|和|或)(?:首发|首期|本期|当前|原型|V0)?(?:真实|实际)?(?:支付(?:系统|功能)?|付款|充值|内购|付费抽卡|付费洗点|广告))*/giu,
    (match, offset: number) => {
      if (/(?:不能|不允许|禁止|不应(?:该|当)?|不得|不要|无需|不要求|并非|(?:并)?不是)\s*$/u.test(sentence.slice(0, offset))) return match;
      // Adding a fee, SDK or failure handler is narrower than adding checkout.
      // Consume only a complete disabled feature/list, leaving later live actions visible.
      if (/(?:不|未)(?:增加|新增)/u.test(match) &&
        !/^\s*(?:$|[。；;，,、：:\n]|但是|但|同时|并且|而|且|或|和|与|及)/u.test(sentence.slice(offset + match.length))) return match;
      if (wholeOnly && /^\s*(?:SDK|信息|数据|密钥|接口|凭证|失败|方式)/iu.test(sentence.slice(offset + match.length))) return match;
      if (wholeOnly && !/支付/u.test(match) && !["充值", "内购", "付费抽卡"].every(word => match.includes(word))) return match;
      return " ";
    });
}

// Only an explicit whole real-payment exclusion authorizes the narrower check.
// A refund-only or failure-only deferral cannot switch off checkout requirements.
function paymentExclusion(item: Item): boolean {
  const explicit = explicitlyExcludesScope(item, "payment");
  if ((!explicit && item.type !== "exclusion") || item.status !== "CONFIRMED" || /[?？]|是否|待定/i.test(item.statement)) return false;
  const disabled = explicit || /^(?:本期|首期|当前)?\s*真实支付(?:及其配套扣款、退款与失败处理流程)?(?:功能|能力|流程)?(?:均|保持)?(?:后置|延期|关闭|禁用|排除)[。\s]*$/u.test(item.statement) ||
    /^(?:all )?(?:real|live) payments?(?: and (?:their )?(?:charges?, refunds? and failure handling))? (?:are |is )?(?:deferred|excluded|disabled)[.\s]*$/i.test(item.statement) ||
    withoutInactivePayments(item.statement, true) !== item.statement;
  return disabled && !paymentWords.test(currentPaymentText(item));
}

function currentPaymentText(item: Item): string {
  let statement = withoutExplicitScopeExclusions(item.statement);
  // A negative acceptance test is not a successful charge. Remove just its
  // rejected Given/When input; any subsequent affirmative operation stays.
  if (item.type === "acceptance_criterion") statement = statement.replace(
    /Given[：:][^]*?When[：:][^]*?Then[：:][^。；;\n]{0,80}?(?:拒绝(?:执行)?|阻止合并|被拒|reject(?:ed)?|deny|block)/gi, match =>
      /尝试|请求|发现|attempt|request|detect/i.test(match) && !/成功|successful|completed payment/i.test(match.split(/Then[：:]/i)[0]!)
        ? match.slice(match.search(/Then[：:]/i)) : match);
  if (item.type === "acceptance_criterion") statement = statement.replace(
    /发现[^。；;\n]{0,60}导入[^。；;\n]{0,60}(?:阻止合并|拒绝)/gu,
    match => match.replace(/支付\s*[/／]?\s*(?:模型\s*)?SDK/giu, " "));
  if (item.type === "acceptance_criterion" && /付款被拒/u.test(statement))
    statement = statement.replace(/尝试付款|付款被拒/gu, " ");
  statement = statement.replace(/(?:禁止|不得|不依赖)(?:导入)?(?:模型\/)?支付\s*SDK|(?:禁止|不得|不依赖)(?:导入)?支付\s*\/\s*模型SDK|\b(?:forbid|prohibit|must not import)\s+payment\s*SDK\b/gi, " ");
  statement = statement.replace(/支付(?:密钥|凭证)|计价支付分离/gu, " ");
  // BYOK attribution describes a customer's external model bill, not platform
  // collection. Do not erase other platform payment clauses in the same item.
  if (/\bBYOK\b/i.test(statement)) statement = statement.replace(/客户直接支付的模型费用|customer(?:s)? (?:directly )?pay(?:s)? (?:the )?(?:external )?model provider/gi, " ");
  // Resolve only explicit non-live clauses before comma splitting separates
  // an action list from its disabled/denied disposition. Mixed live text stays.
  statement = statement.split(/([。；;\n])/u).map(sentence => {
    if (/[?？]|是否|待定/u.test(sentence)) return sentence;
    sentence = withoutInactivePayments(sentence).split(/[，,]/u).map(clause => {
      // Provider expenses are retained by the financial-risk engine, but are not player checkout.
      if (/云|服务器|邮件服务|cloud|hosting|infrastructure/iu.test(clause) && /费用|账单|预算|成本|支出|budget|cost|bill|spend/iu.test(clause) &&
        !/玩家|用户|客户|代收|收款|扣款|退款|充值|内购|付费抽卡|收费|收取(?:服务费|月费|年费)|customer|checkout/iu.test(clause)) return " ";
      if (/(?:不|未)(?:采集|收集)/u.test(clause)) return clause.replace(/支付(?:信息|数据|凭证)/gu, " ");
      return clause;
    }).join("，");
    return sentence
      .replace(/(?:真实|实际)?(?:支付|付费抽卡|内购|充值)(?:(?:、|及|与|和|或)(?:支付|付费抽卡|内购|充值|交易))*(?:不在|不属于)(?:本期|首期|当前|原型|首发)(?:交付)?范围(?:内)?/gu, " ")
      .replace(/(?:真实|实际)?(?:支付|付款|扣款|退款|收款|充值)(?:(?:、|及其配套|及|与|和|或)(?:真实|实际)?(?:支付|付款|扣款|退款|收款|充值))*(?:(?:及|与)(?:其)?(?:配套)?(?:支付流程|失败处理(?:流程)?))?(?:V0|本期|首期|当前|均|保持|仍|继续|功能|能力|流程|\s)*(?:关闭|禁用|后置|延期|排除)/giu,
        (match, offset: number) => /(?:不|未|不要|不能|不应|不应该|不允许|不准|禁止|无需|不要求)(?:再)?(?:把|将)?\s*$/u.test(sentence.slice(0, offset)) ? match : " ")
      .replace(/(?:请求|尝试)(?:(?!但是|但|同时|并且|随后|然后|接着)[^。；;\n]){0,400}?时[，,]?(?:由)?(?:相应)?(?:功能)?闸门拒绝执行/gu,
        match => /成功|已(?:执行|完成|扣款|收款)|successful|completed payment/i.test(match) ? match : "拒绝执行")
      .replace(/(?:以后|未来|后续)(?:启用|开放)(?:(?!但是|但|同时|并且)[^。；;，,\n]){0,80}?(?:须|需)(?:要)?另行(?:审核|批准|确认)/gu, " ");
  }).join("");
  return statement.split(/[。；;，,\n]|但是|但|同时|并且|\b(?:but|while)\b/iu).map(clause => clause
    .replace(/payment fail(?:ure)?|card declined|billing fail(?:ure)?|charge fail(?:ure)?|支付失败|扣款失败|付款失败|充值失败/gi, " ")
    .replace(/(?:真实)?支付(?:V0|本期|首期|当前|保持|仍|功能|能力|\s|\/正式报价)*(?:关闭|禁用|后置|延期)/giu, " ")
    .replace(/(?:首期)?不(?:生成正式报价或执行)?扣款/gu, " ")
    .replace(/不能因影子修订产生实际扣款/gu, " ")
    .replace(/(?:real |live )?payments? (?:is |are |remains? )?(?:disabled|excluded|deferred)/gi, " ")
    .replace(/(?:no|without) (?:real |live )?(?:payments?|charging)/gi, " ")
  ).join(";");
}

/** Shared by profile and audit; never changes the wider financial risk scope. */
export function paymentScope(project: Project, wholeFinancialScopeDeferred: boolean) {
  const items = project.items.filter(active).filter(item => item.type !== "solution_blueprint");
  const exclusions = items.filter(paymentExclusion);
  const failure = items.filter(item => item.status === "CONFIRMED" &&
    ["functional_requirement", "acceptance_criterion", "decision"].includes(item.type) &&
    failureWords.test(item.statement) && !/[?？]|是否|待定|后置|延期|排除|禁用|\b(?:defer|exclude|disable)|不(?:处理|支持|实现)(?:支付|扣款|付款|充值)失败|(?:无需|不需要).{0,12}(?:支付|扣款|付款|充值)失败|(?:payment|billing|charge) failure.{0,20}(?:not required|not handled)/i.test(item.statement));
  const current = wholeFinancialScopeDeferred ? [] : items.filter(item => !exclusions.includes(item) &&
    (paymentWords.test(currentPaymentText(item)) || !exclusions.length && legacyWords.test(currentPaymentText(item))));
  return {not_applicable: wholeFinancialScopeDeferred || exclusions.length > 0 && current.length === 0,
    conflict: exclusions.length > 0 && current.length > 0,
    exclusion_ids: exclusions.map(item => item.id), current_ids: current.map(item => item.id),
    confirmed_current_ids: current.filter(item => item.status === "CONFIRMED").map(item => item.id),
    failure_ids: failure.map(item => item.id)};
}
