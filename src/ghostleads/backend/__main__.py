"""Pipeline CLI.

  python -m ghostleads.backend run --stage enrich      # one step (dedupe|enrich|verify|draft|send)
  python -m ghostleads.backend run --all               # every step; send stays a dry run
  python -m ghostleads.backend seed                    # 20 labelled SEED rows
  python -m ghostleads.backend attendees search events/web-summit-2026.json
Stage names also work (deduped, enriched, verified, drafted, sent) and mean "produce that stage".
Extra arguments after the step go to it, e.g. run --stage send --draft
"""
import argparse

from ghostleads.backend import aiark, attendees, draft, enrich, replies, seed, send, verify

STEPS = {"dedupe": aiark.main, "enrich": enrich.main, "verify": verify.main, "draft": draft.main, "send": send.main}
ALIASES = {"deduped": "dedupe", "enriched": "enrich", "verified": "verify", "drafted": "draft", "sent": "send"}


def main():
    ap = argparse.ArgumentParser(prog="python -m ghostleads.backend")
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    group = run.add_mutually_exclusive_group(required=True)
    group.add_argument("--stage", choices=[*STEPS, *ALIASES])
    group.add_argument("--all", action="store_true")
    sub.add_parser("seed")
    sub.add_parser("attendees", add_help=False)
    sub.add_parser("replies", add_help=False)
    a, rest = ap.parse_known_args()
    if a.cmd == "seed":
        return seed.main()
    if a.cmd == "attendees":
        return attendees.main(rest)
    if a.cmd == "replies":
        return replies.main(rest)
    if a.all:
        for name, step in STEPS.items():
            print(f"=== {name}")
            step(["--skip-if-blocked"] if name == "dedupe" else [])  # send without flags = dry run
        return
    STEPS[ALIASES.get(a.stage, a.stage)](rest)


if __name__ == "__main__":
    main()
