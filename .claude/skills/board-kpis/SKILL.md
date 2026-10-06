---
name: board-kpis
description: Build the monthly board KPI MRR draft from Stripe (New, Expansion, Reactivation, Contraction, Cancellation for Direct and Reseller) and DM it to Connor for review
allowed-tools: Bash, Read, mcp__Slack__slack_search_users, mcp__Slack__slack_send_message
---

Build the MRR movement inputs for the monthly board KPI sheet and send them to
Connor for review. This routine is **read-only against the sheet**. It never
writes to the workbook. Connor reviews the draft and the numbers are entered
from it.

All computation lives in `scripts/board-kpis/`. Do not work out any MRR
figure yourself, and do not edit what the scripts produce. Script paths are
relative to the root of this repository.

STEP 1: Pull Stripe.

    python3 scripts/board-kpis/stripe_pull.py

This calls the Stripe REST API through the environment's injected credential.
If it fails, stop and DM Connor the error line verbatim (see STEP 3 for how
to reach him).

STEP 2: Build the draft.

    python3 scripts/board-kpis/mrr.py

- Exit code 2 means customers with MRR have no `client_type` in Stripe. The
  script prints their names. DM Connor that list and ask him to tag them in
  Stripe, then stop. Do not guess a channel.
- Any other non-zero exit: DM Connor the error and stop.

STEP 3: Send the draft.

Read `.board-kpis/ledger.md`. Find **connor@getuntitled.ai** with
`slack_search_users` and send him one direct message:

- First line: `Board KPI MRR draft for <month(s)>`.
- Then, for each month, the summary table from the ledger (Beginning, the five
  movements, Ending, for Direct and Reseller), the services MRR line, and any
  rebase or carried-forward line, copied as written.
- Then one line per movement from the ledger table:
  `<Channel> <movement>: <Customer> <before> → <after>`.

Send the ledger's own wording. Do not summarise, round differently or comment
on the numbers.
