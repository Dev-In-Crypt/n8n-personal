# 13. Daily backup of the instance to git

- **slug:** `wf-backup`
- **category:** ops
- **depends_on:** 01

**Goal.** The instance lives in a docker volume on one machine. One `docker volume rm`
and it is gone. A backup removes that risk and gives a change history as a side effect.

**Trigger.** `Schedule Trigger`, daily at 03:00.

**Flow.**
1. Ask the n8n API for every workflow, then for each one in full.
2. Normalise before writing so the diff is readable: sort keys, drop volatile fields
   (`updatedAt`, `versionId`; leave node positions alone), strip every credential value
   and keep only names.
3. One file per workflow at `backup/workflows/<id>-<slug>.json`.
4. A separate list of credentials, names and types only, at `backup/credentials.md`.
5. Commit the result to the `backup` branch, with `backup: YYYY-MM-DD` as the message.
   An unchanged instance produces no commit.
6. A Telegram summary only when something changed, or when the backup failed.

**Input.** None. **Output.** A commit on the `backup` branch.
**Credentials.** n8n API, `Telegram Bot (alerts)`, and a GitHub token.

**Definition of done.**
- [ ] the diff carries no secrets
- [ ] the diff is readable, not one line for the whole JSON
- [ ] the backup goes to its own branch, never `main`

**Out of scope.** Nothing restores from a backup automatically.
