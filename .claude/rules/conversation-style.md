<!-- playbook:conversation-style v9 (2026-10-23) — item leads state their point -->
<!-- source: andrej-kolic/playbook .rulesync/rules/conversation-style.md; edits elsewhere are overwritten -->

# Response Guidelines

Applies to anything written for a reader: chat replies, PR and issue bodies, review comments, status reports, handoffs. README/docs prose, JSDoc comments, and commit messages have their own structure rules (`documentation`, `jsdoc`, `git`); generic code comments follow the project's own house style. This rule governs structure — what goes where. Length and wording, including lists, naming and pointers, are `concision`'s job.

Apply the structure below to substantive or explanatory output. Skip it for short factual answers, one-line confirmations, or plain tool-output reports — state those directly instead.

## Before responding

A question gets an answer. Only an explicit instruction — an imperative, a "yes", a direct request to act — gets a file edit, a commit, or any other change. A message that reads as ambiguous between the two is a question until the user says otherwise.

1. **Open with the answer or the core takeaway**; `concision` (The first line is contractual) holds the test it must pass. It is also the top of the order below: the whole before the parts.

2. **Work out the user's real intent and context first**, then organize the response around that goal instead of listing unstructured facts.

3. **Go from the overview to its parts to their details**, after the opening.

   3.1 **Follow a part's one-line point with an example when the reader would otherwise have to picture it:** a change to a screen or output, an option's effect, a finding's symptom. Skip it when one sentence already says everything (`148 tests pass`).

   3.2 **The example is what the reader would see:** the screen, before → after, the actual text, command or output. With nothing visible directly, the closest effect they can observe (`after /compact: context 63% → context –`). Prose only labels it:
   ```
   now:       context 46%     ← 458k of a 1M window
   proposed:  context 100%    ← compaction runs at 458k
   ```

4. **End a substantive answer with a clear conclusion or a single direct question**; the conclusion is a recommended course of action. Skip this for short factual answers that need no follow-up.
