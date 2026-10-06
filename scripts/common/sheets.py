#!/usr/bin/env python3
"""
A minimal Google Sheets API client that authenticates as a service account.

The JWT is signed by shelling out to the openssl binary rather than importing
google-auth or cryptography: the system cryptography package is broken in the
cloud runner image, and a pip install at run time is one more thing that can
fail with nobody watching. openssl is always there.

The service account key comes from the WINS_SA_KEY environment variable on
the cloud environment, minified to one line and wrapped in single quotes. It
is the same service account the wins-logger routine in untitledinternaltooling
uses (deal-win-logger@internal-teamrevdealupdate.iam.gserviceaccount.com).
Access to a workbook comes from sharing it with that address as an Editor.
"""

import base64
import json
import os
import subprocess
import tempfile
import time

import requests

API = "https://sheets.googleapis.com/v4/spreadsheets"
TOKEN_URI = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/spreadsheets"


class Sheet:
    def __init__(self, key_json, spreadsheet_id):
        self.info = json.loads(key_json)
        self.spreadsheet_id = spreadsheet_id
        self._token = None
        self._expires = 0

    def token(self):
        if self._token and time.time() < self._expires - 60:
            return self._token
        now = int(time.time())
        claims = {"iss": self.info["client_email"], "scope": SCOPE,
                  "aud": TOKEN_URI, "iat": now, "exp": now + 3600}
        header = {"alg": "RS256", "typ": "JWT"}
        signing_input = b".".join(
            _b64(json.dumps(p, separators=(",", ":")).encode()) for p in (header, claims))
        assertion = signing_input + b"." + _b64(_sign_rs256(self.info["private_key"], signing_input))
        resp = requests.post(TOKEN_URI, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion.decode()}, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        self._token = payload["access_token"]
        self._expires = time.time() + payload.get("expires_in", 3600)
        return self._token

    def call(self, method, path, **kwargs):
        """One API request against this spreadsheet; raises on any non-2xx."""
        resp = requests.request(
            method, "%s/%s%s" % (API, self.spreadsheet_id, path),
            headers={"Authorization": "Bearer " + self.token()}, timeout=60, **kwargs)
        if not resp.ok:
            raise RuntimeError("%s %s -> %s %s" % (method, path, resp.status_code, resp.text[:400]))
        return resp.json()


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def _sign_rs256(private_key_pem, data):
    """RS256 via openssl. The key goes to a private temp file, removed straight after."""
    fd, path = tempfile.mkstemp(suffix=".pem")  # mode 0600
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(private_key_pem)
        done = subprocess.run(["openssl", "dgst", "-sha256", "-sign", path],
                              input=data, capture_output=True)
        if done.returncode != 0:
            raise RuntimeError("openssl signing failed: %s" % done.stderr.decode()[:300])
        return done.stdout
    finally:
        os.unlink(path)
