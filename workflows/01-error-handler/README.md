# 01. Error handler with Telegram alert

Built from `SPEC.md`. Import `workflow.json` into n8n, then set it as the Error
Workflow of any workflow whose failures you want to hear about.

## What it does

Six nodes, one branch for duplicate suppression:

| Node | Type | Role |
|---|---|---|
| Error Trigger | `errorTrigger` v1 | catches a failed execution of any workflow |
| Build payload | `code` v2 | parses the error, escapes HTML, applies anti-spam, composes the message |
| Duplicate within the hour? | `if` v2.3 | branches on `isDuplicate` |
| Send alert | `telegram` v1.2 | sendMessage, `parse_mode: HTML`, `onError: continueRegularOutput` |
| Result | `code` v2 | `{ alerted: true, reason: "sent" }` or the delivery failure reason |
| Suppressed | `set` v3.4 | `{ alerted: false, reason: "duplicate_within_1h" }` |

Decisions the spec did not spell out:

- **Anti-spam lives in the Code node, not the IF.** The key is
  `workflowId|failedNode|message`, timestamps are kept in
  `$getWorkflowStaticData('global')`, and entries older than an hour are evicted on
  every pass so static data cannot grow forever. The IF only routes.
- **HTML escaping is mandatory.** Error text almost always contains `<`, `>` or `&`.
  Without escaping, Telegram answers 400 and the alert is lost exactly when it matters.
- **`onError: continueRegularOutput` on the Telegram node.** An error handler that
  fails itself is the worst kind of silence. A delivery failure lands in `reason`
  instead of crashing the workflow.
- **`BASE_URL` and `CHAT_ID` are constants at the top of the first node**, so there is
  a single place to edit.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. The two remaining warnings ("Code nodes can throw errors") are generic n8n
advice, not defects.

The "Build payload" logic is exercised outside n8n by `tests/run.mjs`, which loads the
code straight out of `workflow.json` and stubs `$input` and `$getWorkflowStaticData`.
Twelve checks, all green:

```
node tests/run.mjs
```

Covered: payload parsing, execution link, HTML escaping, absence of a stack trace,
duplicate suppression, a different error text counting as a different key, expiry
after an hour, truncation at 500 characters.

## Definition of done

- [x] a duplicate inside the hour is suppressed (runs 2 and 4 in `tests/run.mjs`)
- [x] no secrets and no full stack trace in the message text (only `error.message` is sent)
- [ ] **the message arrives and is readable, the link works** — see below

## What is left to a human

1. Create a Telegram credential named `Telegram Bot (alerts)` in n8n and select it in
   the "Send alert" node. `workflow.json` deliberately carries no credentials.
2. Put the ops chat id into the `CHAT_ID` constant in "Build payload".
3. Verify end to end: make a workflow that fails, point its Settings -> Error Workflow
   at this one, run it, confirm the message arrives.
4. Then tick the last box above.

Step 3 could not be automated: an Error Trigger cannot be fired externally through the
API, and without credentials and a chat id the send would fail anyway. A green test
against a stub instead of a real delivery would be a lie, so the box stays open.

## Limitations

- Anti-spam state is per workflow, held in static data. With several n8n instances the
  state is not shared. For a single instance this is fine.
- The window is a `TTL_MS` constant; it was not moved into config because the spec did
  not ask for it.
