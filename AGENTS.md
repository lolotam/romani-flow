[byterover-mcp]

[byterover-mcp]

You are given two tools from Byterover MCP server, including
## 1. `byterover-store-knowledge`
You `MUST` always use this tool when:

+ Learning new patterns, APIs, or architectural decisions from the codebase
+ Encountering error solutions or debugging techniques
+ Finding reusable code patterns or utility functions
+ Completing any significant task or plan implementation

## 2. `byterover-retrieve-knowledge`
You `MUST` always use this tool when:

+ Starting any new task or implementation to gather relevant context
+ Before making architectural decisions to understand existing patterns
+ When debugging issues to check for previous solutions
+ Working with unfamiliar parts of the codebase


## Delivery tiers (Light / Medium / Heavy Implementation Pipeline)

Owner instruction: 2026-11-19; Romani adaptation of [PP-195 / PosPay PR #1085](https://github.com/lolotam/PayPos.systems/pull/1085). Decision and scope: [owner record](docs/owner-decisions.ar.md). This section supersedes only the tier-specific requirements it explicitly replaces; unrelated rules remain active.

### Select the tier before work

Before EVERY new task, including side tasks and follow-up issues, send Waleed an Arabic AskUserQuestion-style card with exactly three options. Put the recommended option first, marked **(المقترح)**. State the proposed tier, the recommendation and a one-line reason, and include an exception option (for example, an additional review or step). Do not start until Waleed answers. Record the selected tier and exception in both the brief and PR body. Correction rounds within an already-running task need no new card. This rule-registration task is explicitly preapproved as Light, without a further card or bot-review wait.

### Light Implementation Pipeline

- Scope: docs, specs, plans, ADRs, roadmap/status, i18n, and small CSS/UI changes up to about 150 lines. Never money, permissions/auth, DB/migrations, API changes or a new dependency.
- The manager may implement. Merge the docs/small-change PR once all applicable exact-head CI checks succeed, without waiting for review bots; if the repository has no CI, merge directly under the selected Light authorization. Do not waive an independently applicable security, release or HOLD restriction.
- No dedicated staging deployment; include it in the next separately authorized deployment. Do not disable or reconfigure existing deployment automation to enforce this policy.

### Medium Implementation Pipeline

- At most three review/correction rounds: local source review, CodeRabbit, MergePilot, and all applicable exact-head CI outcomes. If MergePilot remains stuck for more than one hour, report that omission and continue without that bot only; other gates remain.
- After round three, track P2/P3 findings as follow-up issues; P0/P1 block merge. Deferral never overrides an independent security or owner HOLD.
- Staging is batched once or twice daily only where separately authorized and actually configured; the tier does not provision staging or grant production authority.

### Heavy Implementation Pipeline

- Use for migrations, money, permissions/auth, security, or long-running background work. Retain the full project pipeline, source/test review, exact-head CI and the task's existing bounded correction rounds.
- Write the implementation plan, then conduct exactly one plan-debate round before implementation. Romani's recorded lanes are Codex `gpt-6-astra` HIGH for planning, MiniMax M3.1 Flash with its supported DEFAULT for implementation, and Codex `gpt-6.1-sol` HIGH for tests. Use the approved Codex lane for the debate, with availability and supported settings verified before dispatch. These are recorded assignments, not a claim that a model is currently available. Do not substitute PosPay's Fable/GLM/Antigravity lanes silently.
- A merge involving migration, money or permissions/auth needs Waleed's explicit approval card after the gates pass. Other Heavy merges retain their existing project-specific authority requirements.
- A separately authorized Heavy staging deployment runs alone after merge, with the applicable pre-migration snapshot and receipt. No production, server, secret, real-data or activation authority follows from the tier.

### Lanes, reporting and independent controls

- The PP-195 reference fallback order is Kimi, MiniMax, GLM, Grok, then Sonnet, after two failures at a lane. Romani has not thereby authorized every referenced provider/model. Retain its approved lane/settings and counters; an unavailable or unapproved exact lane requires Waleed's decision, not silent fallback. MiniMax DEFAULT replaces its formerly exposed medium setting; do not invent a medium option. Approval is role-specific: a lane approved for tests or implementation cannot replace the Heavy planner (or another assigned role) without Waleed approving that role change, even after two failures.
- Every merge report summarizes the active plan: completed work, remaining main tasks/subtasks, and recommendation. End with **المطلوب منك**, **الخطوة الجاية اللي أنصح بيها**, and **ملاحظة**.
- Production, server, credentials/secrets, deployment, security, migration and HOLD/freeze controls remain Waleed's. No frozen/deferred work is revived. Existing CI optimization and measurement obligations remain independent; this document does not authorize merging another PR.
- Romani historically auto-deploys main. This documentation-only task's owner authorization expressly includes its green-CI merge, but does not imply that automation is disabled, authorize a manual deployment/configuration change, or grant blanket production permission to future Light tasks. Reconcile any independently restricted auto-deploy side effect before a future merge.
