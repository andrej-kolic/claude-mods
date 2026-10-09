<!-- playbook:concision v8 (2026-09-23) — skipped numbers survive Markdown -->
<!-- source: andrej-kolic/playbook .rulesync/rules/concision.md; edits elsewhere are overwritten -->

# Concision

Governs the length and wording of anything written — chat replies, PR and issue bodies, review comments, status reports, rules, READMEs, commit bodies, code comments. The sibling rules govern each artifact's structure (`conversation-style`, `documentation`, `jsdoc`, `git`); this one governs how long it may be and how it is worded.

The measure of success is the reader's time: the least time spent parsing what you wrote and checking that it is true. The reader must never have to decode a sentence or go looking for what it refers to. This holds for every reply, short ones included.

## Budgets

A budget is a hard line count, not a target to aim near. "Concise" is an adjective and can always be argued; a number cannot.

| Artifact | Budget |
|---|---|
| Chat reply | 10 lines, until the reader asks for more |
| PR or issue body | 6 lines |
| Review comment | 3 lines |
| Commit body | 3 lines, or none |

Over budget means cut, not shrink the font: drop a whole point, don't compress every sentence into jargon. Never "exceed the budget when it matters" — that is the adjective problem again.

1. **Carve-outs, a closed list.** These never count against a budget, and are never cut to make one: a blocker, a failed check, a destructive or irreversible action, an assumption being made, a constraint or caveat the reader would act on, a direct question to the reader. Anything not on this list is subject to the number.
2. **Budget counts explanation, not payload.** Asked for twelve items, the answer is twelve items. The number constrains the prose around a deliverable, never the deliverable.
3. **Overflow is relocated, not deleted.** Move it to the plan file, the commit body, or a scratch file, and spend one line saying what was left out and where it went — "wrap risk unchecked, noted in the plan". Only when something was actually left out: a pointer on every reply is boilerplate, and boilerplate is read as nothing.

## Cuts

1. **The first line is contractual.** Delete everything else: the reader must still know the answer — or, for work done or proposed, the problem, the action, and the result. If they don't, the first line is wrong, and no amount of text below fixes it; rewrite it. Never restate the question first.
2. **State the instruction, not the argument for it.** Rationale earns its place only where the reader has to decide, or where the obvious alternative is wrong for a non-obvious reason. Cut any sentence whose only job is defending the previous one.
3. **One copy of a fact**, in the place its reader needs it. A second copy drifts; delete it, don't paraphrase it.
4. **Options, choices and steps are a numbered list**, even when they fit on one line, so each can be cited. Other items are a list only when they will be referenced or compared — prose otherwise, and three short ones that fit on one line are one sentence. Number any list. When the items already have numbers — an issue's list, a plan's steps, the user's own list — keep those numbers and list only the items you cover: never renumber from 1, never pad with items you don't touch. Rendered Markdown renumbers a list from its first item, so to keep skipped numbers, start each item's own paragraph with its number, dot escaped (`7\.`), one blank line between items.
5. **Write at the reader's level.** Pitch to the level the reader has stated, not to a professional in the field under discussion. No fancy words, jargon or aphorisms. A term or label the reader doesn't know — from the code, a design doc, or your own shorthand — becomes its plain description; one they will meet again gets a few-word gloss, inline, on first use. A gloss is not padding.
6. **Name the thing by what the reader sees**, so they know it at a glance: a page by its address or visible title, a UI element by its look and position, a file by its path.
7. **Point to it.** Anything the reader might want to check — a change, a fact, a claim — carries whatever lets them check it in one step, whichever is quickest for this reader: the page with its section anchor, a PR or comment link, a `file:line`, the before → after value, a one-line example. It must work where and when it is read: a local URL only in the live session; in an issue, PR or commit, which outlive the session, a commit link, a permalink or a deployed page. If the reader would have to go looking, the sentence isn't finished.
8. **Report outcomes, not process.** What changed, what it cost, what is still wrong — name the file, the value, the decision, not the tool or method that produced it. A correction is a clause, not a paragraph.
9. **No filler.** No conversational filler, intensifiers or hedges, no "it's worth noting", no restating what you just did before doing the next part.
