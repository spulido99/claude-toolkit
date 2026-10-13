#!/usr/bin/env python3
"""Check that every plugin's version is in sync and bumped when it changes.

Claude Code only pulls a plugin update when its version increases, and it reads
the version from both the plugin manifest and the marketplace entry. This check
fails when:

1. `plugins/<p>/.claude-plugin/plugin.json` and the `<p>` entry in
   `.claude-plugin/marketplace.json` carry different versions, or a plugin has
   no marketplace entry.
2. With `--base <ref>`: a plugin has changed files since `<ref>` but its version
   is not greater than the version at `<ref>`.

Usage:
    python3 scripts/check-plugin-versions.py                # sync check only
    python3 scripts/check-plugin-versions.py --base master  # also require bumps
    python3 scripts/check-plugin-versions.py --base master --list-changed
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKETPLACE = ROOT / ".claude-plugin" / "marketplace.json"


def parse_version(v):
    return tuple(int(part) for part in v.split("."))


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def changed_plugins(base, plugins):
    diff = git("diff", "--name-only", f"{base}...HEAD", "--", "plugins/")
    if diff.returncode != 0:
        sys.exit(f"git diff against {base} failed: {diff.stderr.strip()}")
    names = {line.split("/")[1] for line in diff.stdout.splitlines() if line.count("/") >= 2}
    return sorted(names & set(plugins))


def version_at(base, name):
    shown = git("show", f"{base}:plugins/{name}/.claude-plugin/plugin.json")
    if shown.returncode != 0:
        return None  # plugin is new since base
    return json.loads(shown.stdout).get("version")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", help="git ref to compare against (e.g. origin/master)")
    parser.add_argument("--list-changed", action="store_true", help="print changed plugin names and exit")
    args = parser.parse_args()

    entries = {p["name"]: p.get("version") for p in json.loads(MARKETPLACE.read_text())["plugins"]}
    plugins = {
        d.name: json.loads((d / ".claude-plugin" / "plugin.json").read_text()).get("version")
        for d in sorted((ROOT / "plugins").iterdir())
        if (d / ".claude-plugin" / "plugin.json").exists()
    }

    if args.list_changed:
        if not args.base:
            sys.exit("--list-changed needs --base")
        print("\n".join(changed_plugins(args.base, plugins)))
        return

    errors = []
    for name, version in plugins.items():
        if name not in entries:
            errors.append(f"{name}: no entry in .claude-plugin/marketplace.json")
        elif entries[name] != version:
            errors.append(f"{name}: plugin.json has {version}, marketplace.json has {entries[name]}")

    if args.base:
        for name in changed_plugins(args.base, plugins):
            before = version_at(args.base, name)
            if before and parse_version(plugins[name]) <= parse_version(before):
                errors.append(
                    f"{name}: files changed since {args.base} but version is still {plugins[name]} "
                    f"(was {before}); bump it in plugin.json and marketplace.json"
                )

    if errors:
        print("Plugin version check failed:", *errors, sep="\n  ")
        sys.exit(1)
    print(f"Plugin versions OK ({len(plugins)} plugins)")


if __name__ == "__main__":
    main()
