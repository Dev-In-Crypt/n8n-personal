# Expected result

Input: `tests/input.json`. The harness replaces the Telegram wait with canned resume
payloads, so all three outcomes can be exercised without a human.

## Approved

- resume payload `{ data: { approved: true } }`
- `decision` is `approved`, `timed_out` false
- the patch sent to the database is `{ status: "approved", decided_at, timed_out: false }`

## Rejected

- resume payload `{ data: { approved: false } }`
- `decision` is `rejected`, `timed_out` false

## Timed out

- resume payload carries no `approved` field, which is how a limited wait resumes
- `decision` is `expired`, `timed_out` true
- the workflow still finishes and still writes the outcome, it does not hang

## First decision wins

- the decision write targets `?id=eq.<uuid>&status=eq.pending`
- a request already decided matches no rows, so a late or repeated click cannot
  overwrite the recorded decision

## Request id

- a fresh uuid per call, present in the audit row, in the write filter and in the output

## Message

- the message is the title and body only, no ids or internal fields
- a body over 3000 characters is truncated and marked, so Telegram never rejects it

## Input validation

- missing title, body or chat id throws
- `timeout_hours` outside 0 to 168 throws
