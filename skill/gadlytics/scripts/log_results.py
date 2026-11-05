#!/usr/bin/env python3
"""GADLYTICS — dump the results of MCP tool calls from this Claude session's transcript to files,
so pulled numbers are never copied by hand.
  python3 ~/.gadlytics/log_results.py <session.jsonl> <tool-name substring> <out_dir> [--since 2026-11-05T10:00]
Writes <out_dir>/<n>.json = {"input": <tool input>, "text": <tool result text>} in call order.
If a result was too big and the harness saved it to a file, that file's content is read instead."""
import json, os, re, sys

def texts(content):
    if isinstance(content, str): return content
    out = []
    for c in content or []:
        if isinstance(c, dict) and c.get("type") == "text": out.append(c.get("text", ""))
    return "\n".join(out)

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    log, want, out = args[0], args[1], args[2]
    since = None
    for a in sys.argv[1:]:
        if a.startswith("--since"): since = a.split("=", 1)[1] if "=" in a else sys.argv[sys.argv.index(a) + 1]
    os.makedirs(out, exist_ok=True)
    calls, n, done = {}, 0, set()
    for line in open(log, encoding="utf-8"):
        try: o = json.loads(line)
        except Exception: continue
        ts = o.get("timestamp") or ""
        msg = o.get("message") or {}
        for c in msg.get("content") or [] if isinstance(msg.get("content"), list) else []:
            if c.get("type") == "tool_use" and want in (c.get("name") or ""):
                if since and ts < since: continue
                if c["id"] in done: continue          # transcripts can repeat a message
                calls[c["id"]] = c.get("input")
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in calls:
                done.add(c["tool_use_id"])
                t = texts(c.get("content"))
                m = re.search(r"saved to:?\s*(/\S+?)\.?(?:\s|$)", t)
                if m and os.path.exists(m.group(1)) and len(t) < 3000:
                    t = open(m.group(1), encoding="utf-8").read()
                    if m.group(1).endswith(".json"):          # harness [{type:text,text:...}] wrapper
                        try:
                            w = json.loads(t)
                            if isinstance(w, list): t = texts(w)
                        except Exception: pass
                n += 1
                json.dump({"input": calls.pop(c["tool_use_id"]), "text": t}, open(os.path.join(out, "%03d.json" % n), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{n} results → {out}")

if __name__ == "__main__": main()
