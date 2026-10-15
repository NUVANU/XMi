# Interview stages and question style

These are coverage topics within a concrete product module, not instructions to change modules after each answer. Use [module design discussion](module-design-interview.md) to show and revise the design table across rounds. Canonical known answers and the Owner's current uncertainty guide the discussion; do not write a lifecycle transition just because you changed topics.

| Topic | Useful ordinary-language question |
|---|---|
| Intake | Who has this problem today, and what do they do instead? |
| Users and actors | Who uses it, and who helps manage it? |
| Core journey | What is the first useful thing someone should finish from start to end? |
| Scope and exclusions | What must the first version do, and what can it deliberately leave out? |
| State and data | What needs to be remembered, shared or removed later? |
| Roles and permissions | Can one customer see another customer's information? What can an administrator see? |
| Failure paths | What should happen when a request fails or the user changes their mind? |
| Integrations | Does this need to contact another service or cause a real-world change? |
| Non-functional constraints | Are there privacy, accessibility, reliability or budget needs we must not compromise? |
| Solution constraints | Does it need to work offline or with a particular existing system? |
| Acceptance | What could someone observe to tell that this feature works? |
| Closure | Which decisions are still unresolved? The later readiness/export gates are unavailable here. |

Intake stage suggestions retain up to three independent questions by default. Concrete modules use the complete review brief in module-design-interview.md: current design, important pending choices with host recommendations/reasons (up to eight unless the Owner explicitly requests fewer), effects/conflicts, and one numbered batch reply. Include related dependent choices as conditional options when useful. Prior tool counts and brief replies do not establish single-question preference. Return fewer when fewer choices matter; never add unrelated scope or repeat answered choices. Keep first activation short. Offer meaningful alternatives in ordinary language, with "I don't know" and "decide later" viable and unresolved state preserved.

Examples:

- For an item-design module, ask independent peers such as which item categories exist, what fields each item needs, and how stacking is determined; wait for their combined answer before asking questions that depend on those choices.

- Instead of “Do you need RBAC?”, ask “Will staff and customers be allowed to see or change different things?”
- For “Just a prototype, but it will take real payments,” explain that the payment scope still needs explicit risk review; ask whether the Owner intends a non-live demonstration or live payments. Do not silently choose a sandbox or mark payment risk resolved.
- For “You decide,” offer a short recommendation and the consequence of each alternative, then ask for the material choice.
- If styling is requested before the main behavior is clear, acknowledge it as a preference without letting colors replace the core journey discussion.
- If a supplied existing project already records its users and goal, ask about the next unresolved behavior rather than repeating intake.

The same workflow applies to web products, tools and digital games. Ask about actual capabilities rather than forcing web account or subscription questions onto a game. A game may need core loop, actions, outcomes, resources, saves, platform and online rules. Mode adjusts eventual depth, not truthfulness: prototype emphasizes the core journey and honest limits; controlled MVP adds main failure/data/permission decisions; product-grade work needs fuller lifecycle/NFR evidence. Do not describe any of these as already reviewed, audited or ready.

The current tools supply deterministic stage suggestions, risk evaluation and mode-gap records. Report those only when actually called. Use them as coverage checks, not a replacement for concrete module discussion or proof of semantic completeness. Never manufacture numeric readiness scores.
