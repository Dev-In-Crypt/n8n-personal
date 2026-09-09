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
