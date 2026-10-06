#!/usr/bin/env python3
"""
Pull everything mrr.py needs from Stripe and save it verbatim to the workspace.

Talks to the REST API directly rather than through the Stripe connector. A
month-end rebuild needs every invoice since history_start (thousands, at 100
a page), which is dozens of connector calls whose responses would each have
to be saved by hand. The cloud environment's proxy injects the Stripe
credential for api.stripe.com, so no key lives here or in the environment.
The key is read-only and lacks coupon_read; nothing below needs coupons,
because discounts arrive on each invoice line as discount_amounts.

Usage:
    python3 stripe_pull.py      # -> invoices, subscriptions, customers, products
"""

import datetime as dt
import json
import os
import subprocess
import sys
import urllib.parse

import workspace as w

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.stripe.com/v1/"


def get(path, params):
    """Every page of a Stripe list endpoint, as one list."""
    out, after = [], None
    while True:
        query = list(params) + [("limit", "100")]
        if after:
            query.append(("starting_after", after))
        url = API + path + "?" + urllib.parse.urlencode(query)
        raw = subprocess.run(["curl", "-sS", "--fail-with-body", url],
                             capture_output=True, text=True)
        try:
            page = json.loads(raw.stdout)
        except ValueError:
            sys.exit("%s: unreadable response (%s)" % (path, raw.stderr.strip()))
        if "data" not in page:
            sys.exit("%s: %s" % (path, json.dumps(page.get("error", page))[:500]))
        out += page["data"]
        if not page.get("has_more"):
            return out
        after = page["data"][-1]["id"]


def main():
    config = json.load(open(os.path.join(HERE, "config.json")))
    since = int(dt.datetime.fromisoformat(config["history_start"])
                .replace(tzinfo=dt.timezone.utc).timestamp())
    w.ensure()
    pulls = {
        w.INVOICES: ("invoices", [("created[gte]", str(since))]),
        w.SUBSCRIPTIONS: ("subscriptions", [("status", "all")]),
        w.CUSTOMERS: ("customers", []),
        w.PRODUCTS: ("products", []),
    }
    for name, (endpoint, params) in pulls.items():
        rows = get(endpoint, params)
        with open(w.path(name), "w") as f:
            json.dump(rows, f)
        print("%-20s %6d" % (name, len(rows)))


if __name__ == "__main__":
    main()
