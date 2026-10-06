#!/usr/bin/env python3
"""
The one directory a run reads and writes, and the fixed names inside it.

Every command is argument-free so an allow rule can name it exactly: auto
mode drops allow rules for wildcarded interpreter commands. The files sit
beside the checkout (gitignored) rather than in /tmp, so reads and writes
skip the permission classifier.
"""

import os

DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".board-kpis",
)

# Written by stripe_pull.py, verbatim Stripe list data.
INVOICES = "invoices.json"
SUBSCRIPTIONS = "subscriptions.json"
CUSTOMERS = "customers.json"
PRODUCTS = "products.json"

# Written by mrr.py.
DRAFT = "draft.json"       # the sheet inputs per month, plus the ledger
LEDGER = "ledger.md"       # the same, readable


def path(*parts):
    return os.path.join(DIR, *parts)


def ensure():
    os.makedirs(DIR, exist_ok=True)
    return DIR


def use(directory):
    """Point the workspace somewhere else. For tests only."""
    global DIR
    DIR = directory
    return ensure()
