# Deploy notes

## Staging

Staging redeploys on every merge to main. Nothing to do by hand.

## Production

Production is a manual promote from staging. The promote button lives in the ops panel
and requires two approvals, which is deliberate: a bad production push costs a day.
