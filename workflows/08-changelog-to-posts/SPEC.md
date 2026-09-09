# 08. Changelog to post drafts

- **slug:** `changelog-to-posts`
- **category:** product
- **depends_on:** 02, 03, 04

**Goal.** Turn a product's own changelog into post drafts, each tied to a real source,
with a human gate before anything reaches a publishing queue.

**Trigger.** `Schedule Trigger` daily, plus manual runs.

**Flow.**
1. Read the product list: GitHub releases or a JSON changelog feed per product.
2. Call workflow 02 with `source = 'changelog:<product>'` to drop known entries.
3. Call workflow 03 to find occasions: `{ headline, evidence_quote, evidence_url,
   audience_value }`. A quote must be verbatim from the entry.
4. Call workflow 03 again for two drafts per occasion:
   `{ platform, text, cta, source_url }`.
5. Call workflow 04 to put the drafts in front of a human.
6. Approved drafts become rows in the publishing queue with status `ready`.

**Credentials.** `Supabase (dev)`, and the credentials of the workflows it calls.

**Test.** A fixture with three releases, one of them purely internal. Expect the internal
one to produce no occasion, and a rejected batch to write nothing.

**Definition of done.**
- [ ] every draft carries a `source_url`; a post without a source cannot exist
- [ ] a rejected gate means no rows at all, not rows with a status
- [ ] there is no publishing step anywhere in the workflow

**Out of scope.** No publishing. The product boundary is the Publish button.
