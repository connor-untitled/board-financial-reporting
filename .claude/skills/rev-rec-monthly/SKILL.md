---
name: rev-rec-monthly
description: On the 2nd business day of each month, fill last month's tab in the Subscription Rev Rec workbook from Stripe and DM Connor the total and anything that needs a person
allowed-tools: Bash, Read, mcp__Slack__slack_search_users, mcp__Slack__slack_send_message
---

Fill last month's tab in the Subscription Rev Rec workbook, which goes to the
outsourced bookkeepers, then tell Connor what was written.

This is a fully automated task. Do not ask for confirmation, and do not work
out any figure yourself. `scripts/rev-rec/run.py` decides every row; your job
is to run it and pass on what it says. Script paths are relative to the root
of this repository.

STEP 1: Run it.

    python3 scripts/rev-rec/run.py

Act on the exit code:

- **3**: today is not the 2nd business day. The Routine fires on every
  weekday from the 2nd to the 5th so that it never misses the day, and this
  is the normal outcome on the others. Stop here. Send nothing.
- **2**: the tab already has rows, so nothing was written. DM Connor one
  line: the script's message, verbatim. Then stop.
- **0**: the tab was filled and checked. Go to STEP 2.
- **Anything else**: DM Connor the error output verbatim, prefixed with
  `Rev Rec routine failed:`. Then stop. Do not retry, and do not edit the
  workbook by any other route.

STEP 2: Send the summary.

Read `.rev-rec/summary.md`. Find **connor@getuntitled.ai** with
`slack_search_users` and send him its contents as one direct message,
unchanged. Do not add commentary, round the numbers or reorder the lists.
