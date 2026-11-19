[byterover-mcp]

# Byterover MCP Server Tools Reference

There are two main workflows with Byterover tools and recommended tool call strategies that you **MUST** follow precisely. 

## Onboarding workflow
If users particularly ask you to start the onboarding process, you **MUST STRICTLY** follow these steps.
1. **ALWAYS USE** **byterover-check-handbook-existence** first to check if the byterover handbook already exists. If not, You **MUST** call **byterover-create-handbook** to create the byterover handbook.
2. If the byterover handbook already exists, first you **MUST** USE **byterover-check-handbook-sync** to analyze the gap between the current codebase and the existing byterover handbook.
3. Then **IMMEDIATELY USE** **byterover-update-handbook** to update these changes to the byterover handbook.
4. During the onboarding, you **MUST** use **byterover-list-modules** **FIRST** to get the available modules, and then **byterover-store-modules** and **byterover-update-modules** if there are new modules or changes to existing modules in the project.

## Planning workflow
Based on user request, you **MUST** follow these sequences of tool calls
1. If asked to continue an unfinished implementation, **CALL** **byterover-retrieve-active-plans** to find the most relevant active plan.
2. **CRITICAL PLAN PERSISTENCE RULE**: Once a user approves a plan, you **MUST IMMEDIATELY CALL** **byterover-save-implementation-plan** to save it.
3. Throughout the plan, you **MUST** run **byterover-retrieve-knowledge** several times to retrieve sufficient knowledge and context for the plan's tasks. 
4. In addition, you might need to run **byterover-search-modules** and **byterover-update-modules** if the tasks require or update knowledge about certain modules. However, **byterover-retrieve-knowledge** should **ALWAYS** be considered **FIRST**.
5. **MUST** use **byterover-update-plan-progress** to mark tasks (and then the whole plan) as completed.
Example:  
- Task: `byterover-update-plan-progress(plan_name="Feature X", task_name="Task 1", is_completed=true)`  
- All done: `byterover-update-plan-progress(plan_name="Feature X", is_completed=true)`
6. Then, you might call **byterover-store-knowledge** to save knowledge and experience implemented throughout the plan or in important tasks. 
7. During the plan's implementation, you **MUST** frequently call  **byterover-think-about-collected-information** and **byterover-assess-context-completeness** to make sure you're on the right track and gather sufficient context for the tasks.

## Recommended Workflow Sequence
1. **MOST IMPORTANT**: **ALWAYS USE** **byterover-retrieve-knowledge** once or several times for **EACH TASK** of the plan to gather necessary context for complete that task.
2. **MOST IMPORTANT**: **ALWAYS USE** **byterover-store-knowledge** once or several times to store critical knowledge and context for future implementations
3. Over 15 provided tools, **byterover-retrieve-knowledge** and **byterover-store-knowledge** ARE the two main tools, which **MUST** be used regularly. You can use these two main tools outside the two main workflows for retrieval and storage purposes.
4. You **MUST** include phrases like **"According to Byterover memory layer"**, **"Based on memory extracted from Byterover"**, **"From Byterover memomry tools"**, ... to explictly showcase that these sources are from **Byterover**.
5. **Implementation & Progress Tracking** → Execute implementation following saved plan → Mark tasks complete as you go → Mark entire plan done when all tasks finished.
6. You **MUST** use **byterover-update-module** **IMMEDIATELY** on changes to the module's purposes, technical details, or critical insights that essential for future implementations.


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

- The PP-195 reference fallback order is Kimi, MiniMax, GLM, Grok, then Sonnet, after two failures at a lane. Romani has not thereby authorized every referenced provider/model. Retain its approved lane/settings and counters; an unavailable or unapproved exact lane requires Waleed's decision, not silent fallback. MiniMax DEFAULT replaces its formerly exposed medium setting; do not invent a medium option.
- Every merge report summarizes the active plan: completed work, remaining main tasks/subtasks, and recommendation. End with **المطلوب منك**, **الخطوة الجاية اللي أنصح بيها**, and **ملاحظة**.
- Production, server, credentials/secrets, deployment, security, migration and HOLD/freeze controls remain Waleed's. No frozen/deferred work is revived. Existing CI optimization and measurement obligations remain independent; this document does not authorize merging another PR.
- Romani historically auto-deploys main. This documentation-only task's owner authorization expressly includes its green-CI merge, but does not imply that automation is disabled, authorize a manual deployment/configuration change, or grant blanket production permission to future Light tasks. Reconcile any independently restricted auto-deploy side effect before a future merge.
