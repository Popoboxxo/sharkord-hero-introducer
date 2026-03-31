#!/usr/bin/env python3
"""
Publish Doorstop requirements in various formats.

Usage:
    py scripts/doorstop-publish.py [html|md|csv|all]
    py scripts/doorstop-publish.py          # defaults to 'all'
"""

import os
import sys
import subprocess

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLISH_DIR = os.path.join(REPO_ROOT, "docs", "requirements-doorstop")

# Ensure doorstop is callable
DOORSTOP = "doorstop"


def run_doorstop(*args):
    """Run a doorstop command and return the result."""
    cmd = [DOORSTOP] + list(args)
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)
    return result.returncode


def publish_html():
    """Publish all documents as HTML."""
    print("\n[HTML] Publishing...")
    return run_doorstop("publish", "all", PUBLISH_DIR)


def publish_md():
    """Publish each document as Markdown."""
    print("\n[MD] Publishing...")
    md_dir = os.path.join(REPO_ROOT, "docs")
    prefixes = ["REQ", "REQ-CORE", "REQ-CMD", "REQ-CFG", "REQ-DATA",
                "REQ-LIFE", "REQ-NF", "REQ-DBG", "REQ-AUTO"]
    rc = 0
    for prefix in prefixes:
        out_file = os.path.join(md_dir, f"doorstop-{prefix.lower()}.md")
        ret = run_doorstop("publish", prefix, out_file)
        if ret != 0:
            rc = ret
    return rc


def publish_csv():
    """Publish traceability matrix as CSV."""
    print("\n[CSV] Publishing traceability...")
    csv_file = os.path.join(REPO_ROOT, "docs", "doorstop-traceability.csv")
    # Doorstop's `publish all` already generates traceability.csv in the HTML output
    # For standalone CSV, use doorstop export
    return run_doorstop("export", "all", os.path.join(REPO_ROOT, "docs", "doorstop-export"))


def main():
    fmt = sys.argv[1] if len(sys.argv) > 1 else "all"

    print("=" * 50)
    print("Doorstop Publish")
    print("=" * 50)

    # Validate first
    print("\nValidating...")
    rc = run_doorstop()
    if rc != 0:
        print("\nWARNING: Validation had issues (see above). Continuing anyway.")

    if fmt in ("html", "all"):
        publish_html()
    if fmt in ("md", "all"):
        publish_md()
    if fmt in ("csv", "all"):
        publish_csv()

    print("\nDone!")


if __name__ == "__main__":
    main()
