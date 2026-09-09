# n8n-personal

A personal library of finished n8n workflows. One workflow, one folder.

Each folder is self-contained: the brief it was built from, the importable JSON, a
note on what was actually built and verified, and the tests that back that claim.

```
workflows/NN-<slug>/
  SPEC.md        the brief the workflow was built from
  workflow.json  importable into n8n
  README.md      what was built, what was verified, what is still open
  meta.json      node versions, build date, validation result
  tests/         input, expected result, runnable checks
```

## Using a workflow

In n8n: Workflows, Import from File, pick `workflows/NN-<slug>/workflow.json`.
Create the credentials named in that folder's `SPEC.md` first. Workflows are exported
inactive and carry no credentials.

## Conventions

- Credentials are referenced by name only. No secrets in this repository.
- A workflow is added only once it has been validated against a real instance and its
  claims are backed by tests. Anything unverified is listed as open in its README.
- Everything here is written in English.

## Contents

| # | Workflow | What it is for |
|---|---|---|
| 01 | [Error handler with Telegram alert](workflows/01-error-handler) | one place that reports any failing workflow in the instance |
| 02 | [Dedup store on Supabase](workflows/02-dedup-store) | returns only the items a source has never produced before |
| 03 | [LLM call with schema and retries](workflows/03-llm-structured) | prompt plus JSON schema in, validated object out, format errors self-repaired |
| 04 | [Human approval gate via Telegram](workflows/04-approval-gate) | suspends a workflow until a human approves or rejects, with an audit trail |
| 05 | [Morning digest of sources](workflows/05-sources-digest) | one grouped Telegram digest a day, no repeats, silence when nothing is new |
| 06 | [App Store review monitor](workflows/06-appstore-reviews) | polls review feeds, tags them, alerts only on low ratings and bug reports |
| 07 | [EU Funding Radar](workflows/07-eu-funding-radar) | scores European funding calls against a profile, with verified quotes only |
| 08 | [Changelog to post drafts](workflows/08-changelog-to-posts) | turns releases into post drafts behind a human gate, never publishes |
| 09 | [AI search visibility monitor](workflows/09-aeo-visibility) | weekly measure of whether a brand appears in model answers, with a delta |
