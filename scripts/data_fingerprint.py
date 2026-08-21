#!/usr/bin/env python3
"""
A content fingerprint for public/data, so a client can tell that the data
changed without having to trust that a number went up.

The version counter alone is not enough. It is written by two independent
authors — the 30-minute pipeline on main, and any branch that regenerates the
data — and when their commits merge, one side's data-version.json wins whole.
The published content is then the merge of BOTH sides while the counter is
whichever one git happened to keep. An installed app that already holds that
counter concludes it is up to date and never refetches, and the reader sits on
stale briefs indefinitely with nothing wrong on the server.

The fingerprint is derived from the bytes we actually publish, so it cannot
disagree with them. If the content differs, it differs.

    python3 scripts/data_fingerprint.py            # print the fingerprint
    python3 scripts/data_fingerprint.py --check    # verify the stamped one
    python3 scripts/data_fingerprint.py --write    # stamp it into data-version
"""
import hashlib
import json
import os
import sys

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')
VERSION_FILE = 'data-version.json'


def data_files():
    """Every published data file except the stamp itself."""
    return sorted(f for f in os.listdir(DATA)
                  if f.endswith('.json') and f != VERSION_FILE)


def fingerprint():
    h = hashlib.sha256()
    for name in data_files():
        h.update(name.encode())
        with open(os.path.join(DATA, name), 'rb') as fh:
            h.update(hashlib.sha256(fh.read()).digest())
    return h.hexdigest()[:16]


def stamp(doc=None):
    """Write the current fingerprint into data-version.json."""
    path = os.path.join(DATA, VERSION_FILE)
    if doc is None:
        with open(path) as fh:
            doc = json.load(fh)
    doc['fingerprint'] = fingerprint()
    with open(path, 'w') as fh:
        json.dump(doc, fh, indent=2)
        fh.write('\n')
    return doc['fingerprint']


def main():
    if '--write' in sys.argv:
        print(stamp())
        return 0
    fp = fingerprint()
    if '--check' not in sys.argv:
        print(fp)
        return 0
    with open(os.path.join(DATA, VERSION_FILE)) as fh:
        stamped = json.load(fh).get('fingerprint')
    if stamped == fp:
        print(f'fingerprint ok: {fp}')
        return 0
    print(f'FINGERPRINT MISMATCH — data-version says {stamped!r}, the files hash to {fp!r}.\n'
          'Published data has changed without the stamp being updated: installed apps\n'
          'holding this version will not refetch. Run: python3 scripts/data_fingerprint.py --write')
    return 1


if __name__ == '__main__':
    sys.exit(main())
