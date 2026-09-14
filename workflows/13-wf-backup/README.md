# 13. Daily backup of the instance to git

Built from `SPEC.md`, with one substitution the spec did not anticipate: **there is no
shell**. The spec's step 5 was `Execute Command` running `git add` and `git commit`. That
cannot work here, for two independent reasons found by probing the live instance rather
than by reading documentation:

- Deploying a node of type `n8n-nodes-base.executeCommand` fails with *Unrecognized node
  type*. It is not excluded by `docker-compose.yml`; the image does not register it.
- Even if it did, the container mounts only `./workflows` at `/data/workflows`. There is no
  `.git` inside the container and the n8n image carries no git binary, so `git` would have
  had nothing to act on.

So the commit is made through the **GitHub Git Data API** instead: a tree, a commit, and a
ref update, over three HTTPS calls. No shell, no git binary, no working copy, no volume
mounts, and nothing to change in Docker. What the spec asked for - a commit on a separate
branch, readable diffs, no secrets, and no commit when nothing changed - is all delivered;
only the mechanism differs.

## Nodes

| Node | Type | Role |
|---|---|---|
| Every day at 03:00 | `scheduleTrigger` v1.3 | daily run |
| Prepare | `code` v2 | config, urls, the local date |
| List workflows | `httpRequest` v4.4 | every workflow on the instance |
| Fan out workflows | `code` v2 | one item each, plus the completeness guards |
| Fetch each workflow | `httpRequest` v4.4 | the full JSON, five at a time |
| Normalise | `code` v2 | strip, sort, scrub, scan |
| Get branch head | `httpRequest` v4.4 | the `backup` ref, 404 tolerated |
| Branch exists? | `if` v2.3 | first run or not |
| Get base commit | `httpRequest` v4.4 | yesterday's tree sha |
| Create tree | `httpRequest` v4.4 | uploads every file as one tree |
| Plan commit | `code` v2 | compares tree shas, builds the commit |
| Anything changed? | `if` v2.3 | the whole of "no commit when unchanged" |
| Create commit | `httpRequest` v4.4 | the commit object |
| Branch existed? | `if` v2.3 | move a ref or create one |
| Move branch / Create branch | `httpRequest` v4.4 | points `backup` at the new commit |
| Report | `code` v2 | the summary |
| Send report | `telegram` v1.2 | only when something changed |
| Nothing changed | `noOp` v1 | quiet end |

## The decisions that matter

**"Nothing changed" is a hash comparison, not a diff.** A git tree sha is a hash of the
content the tree holds, so identical content produces an identical sha. Uploading the tree
and comparing its sha to the previous commit's tree sha is the entire mechanism. There is
no diffing code to get subtly wrong, and the check is exact.

**The tree has no `base_tree`.** It is the complete content of the `backup` branch, not a
patch on top of it. That means a workflow deleted from the instance disappears from the
backup, instead of lingering for ever as a file nothing updates any more.

**The backup branch is an orphan.** On the first run the commit has no parents, so `backup`
shares no history with `main`. It holds backups and nothing else, which is what the spec
asked for and also what makes the "replace the whole tree" approach safe.

**An empty instance refuses to commit.** If the API returns no workflows - a key that lost
its permissions, an instance that was reset - the tree would be empty and the commit would
replace the entire backup branch with nothing. That is a backup deleting the thing it
exists to protect, so the run stops instead. The same reasoning stops a run when the list
is paginated, or when any single workflow could not be read: a backup that silently covers
less than the instance is worse than no backup, because it looks like it worked.

**The secret scan runs before anything is sent.** Eight patterns are checked against every
file's content, and any hit aborts the run. Scanning the diff afterwards, as the spec's
definition of done described, would mean finding the secret after it had already been
pushed to a remote. `state/secret-patterns.txt` is not reachable from inside n8n, so the
patterns live in the node; that is the deviation.

**`pinData` and `staticData` never leave.** `pinData` is real captured execution data and
`staticData` holds cursors and tokens. Both are dropped, and the API is separately asked
not to send pinned data at all - the strip does not depend on that parameter being honoured.

**Nodes are sorted by name.** n8n returns them in storage order, which shifts as a workflow
is edited, so an untouched workflow would otherwise produce a different file every time it
was saved. Names are unique in n8n and connections are keyed by name, so the order carries
no meaning for a restore. A test proves that shuffling the input produces a byte-identical
file, and that renaming one node moves at most two lines.

**`credentials.md` carries no date.** An obvious touch - "backed up on 2026-09-14" - would
have changed the file daily, changed the tree daily, and produced a commit every single day
regardless of whether anything happened. That would have quietly destroyed the one property
this workflow is supposed to have.

**The credential list comes from the workflows, not from the instance.** The n8n public API
offers credential create, delete and get-schema, but no listing. So the file records the
credentials the backed-up workflows actually reference - names and types only. Values are
never returned by the API in the first place.

**A failed backup is not reported here.** The spec asked for Telegram on change or failure.
Change is handled; failure is workflow 01's job, which reports any failing workflow on the
instance. Duplicating it here would mean two alerts for one problem, and the Telegram node
is left to fail loudly for the same reason.

## Verification

`validate_workflow` with the `strict` profile **against the live instance** (n8n-mcp
2.65.1): 19 nodes, 20 connections, 17 expressions, **zero errors**.

Three throwaway probe workflows were deployed, executed and deleted while building this:
one established that `executeCommand` is not registered, one that n8n can reach its own API
(a clean `401 X-N8N-API-KEY header required`, so the network path is fine), and an earlier
one that luxon's `DateTime` is available in Code nodes.

`tests/run.mjs` runs the Code nodes straight out of `workflow.json`. Fifty-six checks, all
passing:

```
npm i luxon
node tests/run.mjs
```

`tests/expected.md` lists all fifty-six.

## Definition of done

- [x] the diff carries no secrets
- [x] the diff is readable, not one line for the whole JSON
- [x] the backup goes to its own branch, never `main`

The first is enforced rather than checked after the fact: eight patterns are scanned before
anything is sent and any hit aborts the run, with a test for each pattern. The second is
measured, not asserted - a test renames one node and fails if more than two lines move. The
third is checked twice: by the branch name in the config and by a test that fails if the
string `refs/heads/main` appears anywhere in the file.

## What is left to a human

1. Create a GitHub token with **Contents: write** on this repository only, and store it as
   an n8n credential of type **GitHub API**. A fine-grained token scoped to the one
   repository is enough; a classic `repo` token grants far more than this needs.
2. Create an **n8n API** credential pointing at `http://localhost:5678` with an API key.
3. Create the `Telegram Bot (alerts)` credential.
4. Set `GITHUB_OWNER`, `GITHUB_REPO` and `ALERT_CHAT_ID` in "Prepare". The workflow refuses
   to run until you do.
5. Run it once by hand and check the `backup` branch on GitHub. Then run it again
   immediately and confirm the second run makes no commit.
6. Activate it.

## Limitations

- **The token can write to the repository.** It is scoped to contents, and the workflow
  only ever touches `refs/heads/backup`, but a token that can move one ref can move others.
  Scope it to this repository alone.
- **Everything is uploaded every day.** The tree is rebuilt from scratch on each run, so a
  hundred workflows means a hundred file bodies over the wire even when nothing changed.
  GitHub deduplicates the blobs, so no storage is wasted, but the request is not small.
- **One page only.** More than 250 workflows stops the run rather than paginating. Raising
  `PAGE_LIMIT` is a one-line change; paginating properly is not, and stopping is the honest
  behaviour in the meantime.
- **A restore is manual.** Nothing here reads the backup branch, by design.
- **Credential values are not backed up, and cannot be.** After a restore every credential
  has to be recreated by hand. `credentials.md` tells you which ones and of what type.
- **Archived workflows are included** if the API lists them, which is probably what you
  want from a backup but is worth knowing.
