# Expected behaviour

Run the suite with `node tests/run.mjs` from this folder's parent. It needs Node 18 or
newer and `luxon`, which n8n injects into every Code node as `DateTime` and plain Node does
not have. No n8n, no network and no GitHub token are needed.

Every test pulls the code it exercises out of `workflow.json`, so a test can only pass
against the file that actually ships.

## The 56 checks

**Prepare (6).** Refuses to run without a repository and without an alert chat, and all
three placeholders are still blank in the shipped file. The backup branch is `backup` and
no url in the node points at a trunk branch. The listing asks n8n not to send captured run
data. The date is taken in the configured timezone rather than UTC.

**Fan out workflows (5).** One item per workflow, each carrying its own url. Three refusals
that all protect the same property - a backup that silently covers less than the instance
is worse than none, because it looks like it worked: an empty instance refuses rather than
replacing the branch with nothing, a second page of results refuses rather than backing up
a subset, and an absurd workflow count refuses. A response that is not a list refuses too.

**Normalise (25).** One file per workflow, named by id and slug. Every volatile field is
stripped (`updatedAt`, `createdAt`, `versionId`, `triggerCount`, `meta`, `shared`) and
captured run data never reaches the backup - neither `pinData` nor `staticData`. A
credential keeps its name and loses its id. Nodes come out in a stable order whatever order
n8n returned them in, object keys are sorted, the file is many lines rather than one, it
ends with a newline, and renaming a single node moves at most two lines. Node positions are
left alone, as the spec required. `credentials.md` lists type and name, leaks no id, and
deliberately carries no date - a file that changed daily would produce a commit daily and
destroy the one property this workflow exists to have. A workflow referencing no
credentials still produces the file. A workflow that could not be read, or that came back
without nodes, stops the whole backup rather than committing a partial one. Seven separate
secret shapes each stop the backup: a JSON web token, an OpenAI-style key, a GitHub token,
an AWS key id, a Telegram bot token, a private key block and a bearer header. An ordinary
workflow passes the scan. The tree replaces the branch rather than merging into it, so a
deleted workflow disappears instead of lingering. Files come out in a stable order, and an
awkward workflow name still yields a usable filename.

**Plan commit (8).** A changed tree is a commit, an identical tree is not. A missing branch
becomes a first commit with no parent. An unreadable base commit commits rather than
skipping the backup - the safe direction is an extra commit, never a missed one. Any other
GitHub answer stops the run, as does a missing tree sha. The commit message is
`backup: YYYY-MM-DD` as the spec asked. The file payloads are dropped once GitHub has them,
so the rest of the run does not carry a copy of every workflow.

**Report (2).** The summary names the repository, branch, date and counts, and carries the
short commit sha. A newly created branch is called out.

**Workflow file (10).** It runs at 03:00. No reference to `main` or `master` appears
anywhere in the file. Nothing is written to GitHub before the tree comparison: the commit
and both ref nodes sit behind the changed check, and the only earlier write is the tree
upload, which creates blobs but moves no ref. The n8n API and GitHub use separate
credentials, and only the two read nodes use the n8n one. Every GitHub call declares an
`Accept` header and an API version. Exactly two calls tolerate an error status - reading a
possibly-missing branch, and fetching each workflow - and no others do. The workflow ships
inactive with no credentials. Nothing writes back to the n8n instance, so nothing can
restore from a backup, which the spec put out of scope. Every node is reachable from the
trigger, and nothing in the file is written in anything but English.
