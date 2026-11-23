#!/usr/bin/env python3
"""Stamp the app version into index.html (run before every push; tests/run.py checks it).

The version is a hash of the scripts, so it only changes when they do. index.html loads every
script as `name.js?v=<version>`; the service worker keeps versioned files for good, so a new
version simply means new URLs and nobody gets a stale script with a fresh page.
"""
import hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {'sw.js'}

def version():
    h = hashlib.sha256()
    for f in sorted(os.listdir(ROOT)):
        if f.endswith('.js') and f not in SKIP:
            h.update(f.encode()); h.update(open(os.path.join(ROOT, f), 'rb').read())
    return h.hexdigest()[:10]

def stamp(check=False):
    p = os.path.join(ROOT, 'index.html'); s = open(p, encoding='utf-8').read(); v = version()
    new = re.sub(r"const APP_VERSION = '[^']*';", f"const APP_VERSION = '{v}';", s)
    new = re.sub(r'(<script src="[\w-]+\.js)(\?v=[^"]*)?(")', rf'\g<1>?v={v}\g<3>', new)
    if check: return new == s, v
    if new != s: open(p, 'w', encoding='utf-8').write(new)
    return True, v

if __name__ == '__main__':
    ok, v = stamp(check='--check' in sys.argv)
    print(('up to date' if ok else 'STALE — run tools/stamp.py') if '--check' in sys.argv else f'stamped {v}')
    sys.exit(0 if ok else 1)
