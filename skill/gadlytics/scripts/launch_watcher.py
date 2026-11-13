#!/usr/bin/env python3
"""GADLYTICS «إطلاق الحملات» — the Mac watcher.
Polls the launch queue (rpc launch_poll, every 2 s, a few hundred bytes, no model calls), keeps the «الماك متصل»
heartbeat alive (docs sys/launch_mac), claims queued requests up to the free build slots, and follows the running ones.
It never builds anything and never starts a Claude session: the «launch dispatcher» chat (runbook
~/.gadlytics/launch_dispatch.md) runs it in the background and, when it exits, launches ONE background agent per LAUNCH
block inside that chat and prints one line per UPDATE.

Output (stdout):
  LAUNCH<TAB><id><TAB><platform><TAB><title><TAB><prompt file>          a request to start — exactly once
  <<<PROMPT <id>
  …the complete prompt of the agent that builds it (instructions + the brief + "GADLYTICS launch id: <id>")…
  PROMPT>>>
  UPDATE<TAB><id><TAB>number<TAB><MGG-…><TAB><title><TAB><platform><TAB><campaign name>   the campaign number (and name) is now known
  UPDATE<TAB><id><TAB>stopped|draft<TAB><MGG-… or -><TAB><title><TAB><platform><TAB><reason>
                                                                        a final state that did NOT come from the agent on this Mac
                                                                        (e.g. the server's time-out) — news only, never starts anything
  MESSAGE<TAB><id><TAB><msg id><TAB><MGG-… or -><TAB><title><TAB><platform><TAB><state><TAB><NN%><TAB><campaign name>
  <<<TEXT <msg id>            what Mahmoud wrote on the campaign's card (only with --msgs; each message exactly once)
  …
  TEXT>>>
  FILES<TAB>brief=<path><TAB>report=<path><TAB>thread=<path>
  <<<CONTINUE <msg id>        what to send (SendMessage) to the campaign's agent when it is still known in the dispatcher chat
  …
  CONTINUE>>>
  <<<PROMPT <msg id>          the complete prompt of a NEW agent when it is not
  …
  PROMPT>>>
Files per claimed request, in ~/.gadlytics/launch_queue/ (moved to done/ once its build was started):
  <id>.prompt.txt (the agent prompt) · <id>.brief.txt (the brief exactly as written on the page + the id line) · <id>.json

  python3 ~/.gadlytics/launch_watcher.py --dispatch --msgs     what the dispatcher runs: exits (0) as soon as there is a LAUNCH, an UPDATE
                                                               or a MESSAGE. Without --msgs it never takes messages (they wait on the
                                                               server for a dispatcher that knows what to do with them)
  python3 ~/.gadlytics/launch_watcher.py --dispatch --fresh    first run of a NEW dispatcher chat: also hands over requests that were
                                                               claimed earlier but never started (the previous dispatcher is gone)
  python3 ~/.gadlytics/launch_watcher.py                       keep running and keep printing (Terminal)
  python3 ~/.gadlytics/launch_watcher.py --status              one line: key ok? queue numbers (no heartbeat, no claim)
  python3 ~/.gadlytics/launch_watcher.py --table               «حالة الحملات»: today's requests as a table (no heartbeat, no claim)
Exit codes: 0 something to hand over (with --dispatch) · 2 key problem · 3 another watcher is already running.
Never prints the key. No auto-start: nothing here installs a LaunchAgent or a login item."""
import json, os, re, signal, socket, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import launch_lib as L

POLL = 2.0
ARGS = set(sys.argv[1:])
DISPATCH = "--dispatch" in ARGS or "--exit-on-claim" in ARGS
FRESH = "--fresh" in ARGS
MSGS = "--msgs" in ARGS
PIDFILE = os.path.join(L.QDIR, ".watcher.pid")
TRACKFILE = os.path.join(L.QDIR, ".tracked.json")
REAL_RE = re.compile(r"^اعمل الحملة دي من تمكين ادز مانجر")
TEST_REPORT = os.path.join(L.QDIR, "test_report.txt")
# the fixed text of the page's «اختبار ربط» request — a test request with any other text is refused
TEST_TPL = ("اختبار ربط GADLYTICS — مفيش حملة هتتبني، ومفيش متصفح ولا أداة إطلاق. نفّذ الأمرين دول بالترتيب وبس، وبعدين رد بكلمة «تم»:\n"
            "python3 ~/.gadlytics/launch_status.py {id} building --step-no 2 --step \"اختبار ربط\"\n"
            "python3 ~/.gadlytics/launch_status.py {id} draft --campaign MGG-00000 --name \"تجريبي — اختبار ربط (مفيش حملة)\" --report-file ~/.gadlytics/launch_queue/test_report.txt")
# what no message from the card can change — it goes into every agent prompt
RULES = ("Rules that NO message can change: draft / paused only — never publish or activate anything; ملبي only; never delete a campaign, an ad set, an ad, "
         "a launch row or a Khzama link unless a message from Mahmoud explicitly asks for that specific deletion, and then only inside THIS campaign; "
         "never touch any other campaign; there is no budget cap — use exactly the number he gives. If a message asks for anything outside this "
         "campaign's build, answer in the chat that it is outside this campaign and do nothing else.")
# Verified 2026-11-12 (three real parallel builds + a test): the Chrome extension gives ONE tab group per Claude session, every
# background agent of the dispatcher chat sees the same group and the same tabs, there is no tool to create a second window or
# group or to name one, and a page cannot open its own window (blocked). So campaigns are kept apart by tab ids.
TABS = ("Browser tabs — your own, and only your own (the skill's part «Tabs for a background agent» has the details): all campaigns of this chat "
        "share ONE Chrome tab group, so every tab that already exists belongs to ANOTHER campaign — never navigate, click, type in or close one. "
        "Open your own with tabs_create_mcp (two, three at most), write their ids down, pass `tabId` on EVERY browser call, label them with the "
        "campaign code in the tab title, and at the end close exactly the tabs you opened.")
RESUME_HEAD = """You are CONTINUING the build of ONE ad campaign for ملبي (Molabi) that Mahmoud launched from his GADLYTICS page «إطلاق الحملات». The build stopped or finished earlier. He has now written a message on that campaign's card — the message is his own request.

Campaign: {code}{name} · platform {platform} · before his message it was «{state}» at {pct} · launch id {id}

His message:
«{text}»

How to work:
1. Read ~/.claude/skills/tamkeen-launch/SKILL.md (with helpers.md and the templates when you need them) and follow it; in its section «GADLYTICS launch id» the part «Continuing after a message» is your procedure.
2. Read these files first: the brief {brief} (the exact text Mahmoud wrote — it wins over the copy below), the last report {report}, and the whole conversation {thread}.
3. BEFORE creating anything, read what already exists: the launch tool's results for this campaign number, the Khzama links by keyword `MGG-<n>`, and the draft on the platform. Then build ONLY what is missing. Never duplicate a launch, a Khzama link, an ad set or an ad.
4. {rules}
5. {tabs} You are a background agent of the «مراقب الإطلاق» chat: no session rename, never start a session, no cloud or remote target, no Remote Control, no artifact.
6. Report with launch_status.py as the skill says. Send the counts as TOTALS for the whole campaign (what exists now out of the full plan: `--launches K/N --adsets K/N --ads K/N --khzama K/N`), so the bar continues from where it was instead of starting again. Finish with `draft --campaign … --name … --report-file …` or `stopped --reason "…" --report-file …` and an UPDATED full report, and post a short reply for him in the card's chat: `python3 ~/.gadlytics/launch_status.py {id} say --text-file <file>` (2 to 4 lines of Egyptian Arabic: what you did and what is left). If you do nothing (the request is outside this campaign, or you need his answer first), send that reply with `--notify` and set the state back to «{state}» with the same report. If a safety classifier refuses a step, do not look for another way: report `stopped` with the refusal as the reason.
7. Your final answer is the reply you posted plus the final state, and nothing else.

The brief:

"""
CONTINUE_TPL = """رسالة جديدة من محمود على كارت الحملة دي ({code} · launch id {id}):
«{text}»

Continue THIS campaign from where it stopped — his message is the request. Follow the skill's part «Continuing after a message»: first read what already exists (the launch tool's results for this campaign number, the Khzama links by keyword `MGG-<n>`, the draft on the platform), then build only what is missing; never duplicate a launch, a link, an ad set or an ad. {rules} Report with launch_status.py (counts as totals for the whole campaign so the bar continues), finish with `draft` or `stopped` and an UPDATED report file, and post a short reply in the card's chat: `python3 ~/.gadlytics/launch_status.py {id} say --text-file <file>` (with `--notify` only if you change no state). Files: brief {brief} · last report {report} · conversation {thread}. Your final answer is that reply plus the final state."""
TEST_MSG_TPL = ("اختبار ربط GADLYTICS — رسالة تجريبية على صف تجريبي، مفيش حملة ولا متصفح. نفّذ الأمرين دول بالترتيب وبس، وبعدين رد بكلمة «تم»:\n"
                "python3 ~/.gadlytics/launch_status.py {id} say --text \"اختبار: رسالتك وصلت للحملة («{short}»).\"\n"
                "python3 ~/.gadlytics/launch_status.py {id} {final}")
SNAP_API = ("10. Snapchat is built through the Snap Marketing API and left PAUSED — real objects in the ad account, not an Ads Manager draft (setting «Snap build: api» at the top of "
            "~/.gadlytics/launch_dispatch.md; this replaces the skill's «Snapchat = UI draft»). Follow the skill's part «Snapchat by API» step by step: after the launch results write the results file, "
            "run `python3 ~/Desktop/claude/adlytics-connectors/snap/make_spec.py {id} --results <file>`, then `build.py <spec> --dry-run` and check its plan against the brief, then `build.py <spec>` for real, "
            "forwarding its `PROGRESS adsets K/M` and `PROGRESS ads K/N` lines with launch_status.py. Finish with `draft … --result-kind paused` only after it prints `VERIFY: ALL MATCH`. "
            "The ad account is the brief's `Ad Account:` line — never guess one. Any `STOP`, `MISMATCH` or non-zero exit you cannot clear with `--resume` → `stopped` with that line as the reason and the `EXISTS` ids in the report. "
            "Never activate, never edit or delete an existing object, never run `--delete-campaign`. Use the Ads Manager UI path only where the skill says the API cannot express the brief, and say in the report which path ran.\n")
SNAP_UI = ("10. Snapchat is built in Snap Ads Manager in Chrome and left as a DRAFT, as the skill says (setting «Snap build: ui» at the top of ~/.gadlytics/launch_dispatch.md). Do not use the API builder.\n")


def snap_note(row, rid):
    """The one named setting «Snap build: api | ui» lives in the runbook; the watcher writes the chosen path into each Snapchat prompt."""
    if (row.get("platform") or "").lower() != "snapchat":
        return ""
    mode = "api"
    try:
        m = re.search(r"\*\*Snap build:\s*`(api|ui)`", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch_dispatch.md"), encoding="utf-8").read())
        mode = m.group(1) if m else "api"
    except Exception:
        pass
    return (SNAP_API if mode == "api" else SNAP_UI).format(id=rid)


AGENT_HEAD = """You are building ONE ad campaign for ملبي (Molabi). Mahmoud filled the brief below on his GADLYTICS page «إطلاق الحملات» and pressed «اطلق» himself — that click is his request to build this campaign now, as a draft, without asking him anything.

How to work:
1. Read ~/.claude/skills/tamkeen-launch/SKILL.md from start to end and follow it exactly, with helpers.md and the template files of that folder when you need them. All its standing rules apply: draft / paused only — never publish or activate; a new campaign built from scratch; every value copied from the launch tool exactly.
2. First read the saved brief {brief_file} (after the build starts it is in ~/.gadlytics/launch_queue/done/{id}.brief.txt). It is the exact text Mahmoud wrote; if a Creative ID, a link or any value differs from the copy below, the file wins.
3. {tabs}
4. You are a background agent inside the «مراقب الإطلاق» chat, not a separate session: skip the skill's session-rename step. Never start a session; never use a cloud or remote target, Remote Control or an artifact.
5. The launch tool is run by the Chrome extension, not by you (the skill's part «The launch tool is run by the Chrome extension»): BEFORE opening the launch tool, write the inputs to a JSON file — `{{"client": "Molabi", "kind": "Single|Bulk|Smart", "platform": "Meta|TikTok|Snapchat", "objective": "Conversion", "country": "SA", "creative_ids": ["<14 digits>", …], "customs": ["<one per ad set, in the brief's order>", …], "product_link": "https://…", "campaign": "New"}}` (`"Select <number>"` only when the brief says so; no Custom → `"customs": []`) — and run `python3 ~/.gadlytics/launch_status.py {id} tool-launch --file <that file> --wait 100` (one command: it submits and waits for the results). `TOOL-LAUNCH QUEUED` → do NOT open the launch tool and do NOT run number-lock (the extension takes the campaign-number turn itself); while it still prints `RUNNING` / `WAITING` run `python3 ~/.gadlytics/launch_status.py {id} tool-status --wait 100`. `TOOL-STATUS ALL DONE` → the results file it names holds the campaign number and name and, per ad set, every ad name, Parameters string and UTM URL, already compared with the brief (Creative IDs, count, Custom, platform, objective): use those values exactly, report `--launches N/N --campaign MGG-… --name "…"`, run `campaign-claim.sh`, and use its `ad_sets` for the Snap results file. The same command also queues each ad set's Khzama links the moment that ad set is done: `KHZAMA-LINKS QUEUED AUTO` → do not run `khzama-links` at all (item 7 starts at «go on building»); `KHZAMA-LINKS NOT-AUTO` → give the results file to `khzama-links --file`. `MISSING <custom>` lines / `TOOL-STATUS MANUAL` → only those launches are yours, by hand as the skill says: FIRST read the launch tool's History for this campaign — a launch that is already there is never made again, read its result instead — then launch what is missing with Campaign = Select → the campaign number when it already has one. `TOOL-LAUNCH MANUAL`, `REJECTED` or `UNAVAILABLE` → do every launch by hand from the start, with the number lock held for SECONDS only: open the tool and fill and check the form of your FIRST launch without the lock; run `python3 ~/.gadlytics/launch_status.py {id} number-lock` only when pressing Launch is the very next thing you do, and press it the moment it prints `NUMBER-LOCK HELD` (`WAITING` → run it again; `UNAVAILABLE` → carry on); then, the moment the result page shows the campaign number — before reading the other results or doing anything else — report it (`--launches 1/N --campaign MGG-… --name "…"`): that gives the turn to the next campaign. `campaign-claim.sh` stays the second check; later launches (Select) need no lock. Say in the report how the launches were made (extension / by hand / both).
6. Report progress with launch_status.py exactly as the skill's section «GADLYTICS launch id» says — it drives the «NN%» bar on Mahmoud's page: `--launches K/N` after each launch result (the FIRST one also carries `--campaign MGG-… --name "<the full campaign name>"`), `--adsets K/N` and `--ads K/N` after each batch on the platform, `--khzama K/N` for the Khzama links (see 7); then `draft --campaign … --name … --report-file …` when it is left as a draft (add `--result-kind paused` when the objects are real and PAUSED on the platform — Meta connector, Snap API — and nothing for a UI draft), or `stopped --reason "…" --report-file …` at any stop. One short command each, about 12 to 15 in the whole build; a failed status call never blocks the build. If a status call prints `PAUSE REQUESTED` (Mahmoud pressed «إيقاف مؤقت»): finish only the step in hand so nothing is left half-saved — never a filled unsaved dialog or a half-created object — then run `python3 ~/.gadlytics/launch_status.py {id} paused --step '<one line: what exists, what is left>'` with the counts, and stop: no new step, no `draft`, no `stopped`; your final answer is that one line. He resumes it later with a message. If a safety classifier refuses a step, do not look for another way: report `stopped` with the refusal text as the reason.
7. Khzama links are registered by the Chrome extension, not by you. If item 5 printed `KHZAMA-LINKS QUEUED AUTO` they are already queued — skip the `khzama-links` command. Otherwise: as soon as ALL launch results are in, write every Parameters string to a JSON file (a list of strings) and run `python3 ~/.gadlytics/launch_status.py {id} khzama-links --file <that file>`. `KHZAMA-LINKS QUEUED` → do NOT open the Khzama form; go on building on the platform, and send no `--khzama` yourself meanwhile. When the platform build is done run `python3 ~/.gadlytics/launch_status.py {id} khzama-status --wait 240`: `ALL DONE` → report `--khzama N/N`. `MISSING <title>` lines → register only those by hand exactly as the skill says (keyword check first, advertiser exactly TSW), then report the real count. Still `WAITING` after the wait → run `khzama-status --take-over` first (it hands them to you), and wait out any `ADDING` line before touching that title. `KHZAMA-LINKS MANUAL`, `REJECTED` or `UNAVAILABLE` → register those by hand from the start, as the skill says. Your report says how the links were registered (extension / by hand / both, with counts).
8. {rules}
9. Your final answer is the Arabic report text you sent with the final status, and nothing else.
{platform_note}
The brief:

"""


INPUTS_NOTE = ("0. FIRST, before you read the skill: the launch-tool inputs were already read from the first block of the brief into {file}. Compare that file once with the block "
               "«Tamkeen Ads Manager Level» below (Creative IDs, the ad sets in order, platform, kind, product link, campaign). If it is the same, run these two now — "
               "`python3 ~/.gadlytics/launch_status.py {id} building --step-no 1 --step \"أداة الإطلاق: الأسامي وروابط UTM\" --launches 0/{n}` and "
               "`python3 ~/.gadlytics/launch_status.py {id} tool-launch --file {file}` — so the extension launches while you read the skill; then go on with 1, and at item 5 do not write "
               "the file or submit again: go straight to `python3 ~/.gadlytics/launch_status.py {id} tool-status --wait 100`. If anything differs from the brief, do not use the file: follow item 5 as written.\n")


def tool_inputs(row):
    """The launch-tool inputs, read from the «Tamkeen Ads Manager Level (airtable)» block exactly as the GADLYTICS page writes it.
    Strict on purpose: any line that is not in that format, or a count that differs from the request → None, and the agent writes
    the inputs itself as before. Nothing is submitted here — the agent compares the file with the brief and submits it."""
    b = (row.get("brief") or "").replace("\r\n", "\n")
    m = re.search(r"(?m)^Tamkeen Ads Manager Level \(airtable\)[ \t]*\n((?:[^\n]*\S[^\n]*\n?)+)", b)
    if not m:
        return None
    cur, vals = None, {}
    for ln in m.group(1).split("\n"):
        ln = ln.strip()
        if not ln:
            break
        k = re.match(r"^(Client|Platform|Launch kind|Creatives ID|Campaign|Country|Objective|Product Link|Adsets \( Custom \)):\s*(.*)$", ln)
        if k:
            cur = k.group(1)
            if cur in vals:
                return None
            vals[cur] = [k.group(2)] if k.group(2) else []
        elif cur in ("Creatives ID", "Adsets ( Custom )"):
            vals[cur].append(ln)
        else:
            return None
    one = lambda key: vals[key][0] if len(vals.get(key) or []) == 1 else None
    if (one("Client") or "").lower() not in ("molabi", "ملبي"):
        return None
    plat, kind = one("Platform"), one("Launch kind")
    if plat not in ("Meta", "TikTok", "Snapchat") or plat.lower() != (row.get("platform") or "").lower() or kind not in ("Single", "Bulk", "Smart"):
        return None
    ids = [re.sub(r"^-\s*", "", x) for x in vals.get("Creatives ID") or []]
    if not ids or len(set(ids)) != len(ids) or any(not re.match(r"^\d{14}$", x) for x in ids):
        return None
    if (kind == "Single" and len(ids) != 1) or (kind == "Smart" and len(ids) > 10) or len(ids) > 50:
        return None
    camp = one("Campaign") or ""
    cm = re.match(r"^Select\b\D*(\d{3,6})\)?$", camp)
    campaign = "New" if camp == "New" else ("Select " + cm.group(1)) if cm else None
    country = one("Country") or ""
    country = "SA" if country == "Saudi Arabia" else country if re.match(r"^[A-Z]{2}$", country) else None
    obj, link = one("Objective"), one("Product Link") or ""
    if not campaign or not country or not obj or not re.match(r"^https://\S+$", link):
        return None
    customs = []
    for i, x in enumerate(vals.get("Adsets ( Custom )") or []):
        c = re.match(r"^(\d+)-\s*([A-Za-z0-9_]{1,40})$", x)
        if not c or int(c.group(1)) != i + 1 or c.group(2) in customs:
            return None
        customs.append(c.group(2))
    if (row.get("n_videos") and int(row["n_videos"]) != len(ids)) or (row.get("n_adsets") and customs and int(row["n_adsets"]) != len(customs)):
        return None
    return {"client": "Molabi", "kind": kind, "platform": plat, "objective": obj, "country": country, "creative_ids": ids, "customs": customs,
            "product_link": link, "campaign": campaign}


def out(s):
    sys.stdout.write(s + "\n"); sys.stdout.flush()


def clean(s):
    return (s or "").replace("\t", " ").replace("\n", " ").strip()


def valid_brief(row):
    b = row.get("brief") or ""
    if row.get("is_test"):
        return b.strip() == TEST_TPL.format(id=row["id"])
    if not REAL_RE.match(b) or "Tamkeen Ads Manager Level" not in b:
        return False
    return bool(re.search(r"(?mi)^Client:\s*(molabi|ملبي)\s*$", b)) and bool(re.search(r"\b\d{14}\b", b))


def emit(rid):
    meta = json.load(open(os.path.join(L.QDIR, rid + ".json"), encoding="utf-8"))
    prompt = open(L.prompt_path(rid), encoding="utf-8").read()
    open(os.path.join(L.QDIR, rid + ".emitted"), "w").write(str(int(time.time())))
    out("LAUNCH\t%s\t%s\t%s\t%s" % (rid, meta.get("platform", ""), clean(meta.get("title")), L.prompt_path(rid)))
    out("<<<PROMPT " + rid); out(prompt.rstrip("\n")); out("PROMPT>>>")


def take(row):
    rid = row["id"]
    if not L.ID_RE.match(rid):
        return False
    if not valid_brief(row):
        L.log("refused %s: brief is not a launch template" % rid)
        try:
            L.api("POST", "/status", {"id": rid, "state": "stopped", "reason": "الماك رفض الطلب: النص مش بريف إطلاق لملبي بالشكل المتوقع"})
        except L.LaunchError as e:
            L.log("refuse status failed: %s" % e)
        return False
    os.makedirs(L.QDIR, exist_ok=True)
    if row.get("is_test"):
        open(TEST_REPORT, "w", encoding="utf-8").write("اختبار الربط نجح: الماك استلم الطلب وبدأ وبلّغ الحالة.\nمفيش حملة اتبنت — ده اختبار بس.\n")
        brief = prompt = row["brief"].rstrip() + "\n"
    else:
        brief = row["brief"].rstrip() + "\n\nGADLYTICS launch id: %s\n" % rid
        note = ""
        try:                                               # the launch-tool inputs, ready for the agent's first command (never blocks a claim)
            ti = tool_inputs(row)
            if ti:
                os.makedirs(L.DONE, exist_ok=True)
                f = os.path.join(L.DONE, rid + ".inputs.json")
                open(f + ".tmp", "w", encoding="utf-8").write(json.dumps(ti, ensure_ascii=False, indent=1)); os.replace(f + ".tmp", f)
                note = INPUTS_NOTE.format(id=rid, file=f, n=max(1, len(ti["customs"])))
        except Exception as e:
            note = ""; L.log("tool inputs for %s not prepared: %s" % (rid, str(e)[:120]))
        prompt = AGENT_HEAD.format(id=rid, brief_file=L.brief_path(rid), rules=RULES, tabs=TABS, platform_note=snap_note(row, rid)).replace("How to work:\n", "How to work:\n" + note, 1) + brief
    for path, txt in ((L.brief_path(rid), brief), (L.prompt_path(rid), prompt)):
        open(path + ".tmp", "w", encoding="utf-8").write(txt); os.replace(path + ".tmp", path)
    json.dump({"id": rid, "title": row.get("title"), "platform": row.get("platform"), "is_test": bool(row.get("is_test")),
               "created_at": row.get("created_at"), "claimed_ms": int(time.time() * 1000)}, open(os.path.join(L.QDIR, rid + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    L.log("claimed %s · %s · %s" % (rid, row.get("platform"), row.get("title")))
    emit(rid)
    return True


def pending():
    try:
        return sorted(f[:-5] for f in os.listdir(L.QDIR) if f.endswith(".json") and not f.startswith(".") and os.path.exists(L.prompt_path(f[:-5])))
    except FileNotFoundError:
        return []


def load_tracked():
    try:
        d = json.load(open(TRACKFILE, encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def updates(track, tracked):
    """news for the dispatcher chat. Returns the number of UPDATE lines printed. Never starts anything."""
    n = 0
    seen = set()
    for row in track or []:
        rid = row.get("id")
        if not rid:
            continue
        seen.add(rid)
        t = tracked.setdefault(rid, {"no": "", "final": ""})
        no, state = row.get("campaign_no") or "", row.get("state") or ""
        final = state in ("draft", "stopped")
        if final and t.get("final") != state:
            t["final"] = state
            if L.local_final(rid) != state:               # not reported by the agent on this Mac → its completion won't tell the chat
                out("UPDATE\t%s\t%s\t%s\t%s\t%s\t%s" % (rid, state, no or "-", clean(row.get("title")), row.get("platform") or "", clean(row.get("stop_reason"))))
                n += 1
            t["no"] = no or t.get("no", "")
        elif no and no != t.get("no"):
            t["no"] = no
            if not final:
                out("UPDATE\t%s\tnumber\t%s\t%s\t%s\t%s" % (rid, no, clean(row.get("title")), row.get("platform") or "", clean(row.get("campaign_name"))))
                n += 1
        if not final:
            t["final"] = ""
        # pause / resume asked for on the card (no push for these — only a line in the dispatcher chat)
        pz = "paused" if state == "paused" else ("req" if row.get("pause") and state in ("starting", "building") else "")
        if pz != t.get("pz", ""):
            was, t["pz"] = t.get("pz", ""), pz
            kind = {"req": "pause-requested", "paused": "paused"}.get(pz) or ("resumed" if was == "paused" else "pause-cancelled")
            out("UPDATE\t%s\t%s\t%s\t%s\t%s\t%s" % (rid, kind, no or "-", clean(row.get("title")), row.get("platform") or "", row.get("progress") if row.get("progress") is not None else ""))
            n += 1
    for rid in [k for k in tracked if k not in seen]:
        del tracked[rid]
    try:
        json.dump(tracked, open(TRACKFILE + ".tmp", "w", encoding="utf-8")); os.replace(TRACKFILE + ".tmp", TRACKFILE)
    except Exception:
        pass
    return n


def hhmm(iso):
    try:
        import datetime
        return datetime.datetime.fromisoformat(re.sub(r"(\.\d{1,6})\d*", r"\1", (iso or "").replace("Z", "+00:00"))).astimezone().strftime("%H:%M")
    except Exception:
        return ""


def emit_msg(m):
    """one MESSAGE block for the dispatcher (a message Mahmoud wrote on a campaign card)."""
    rid, mid = m["id"], m["mid"]
    code, name = m.get("campaign_no") or "", clean(m.get("campaign_name"))
    pct = ("%s%%" % m["progress"]) if m.get("progress") is not None else "-"
    out("MESSAGE\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s" % (rid, mid, code or "-", clean(m.get("title")), m.get("platform") or "", m.get("state") or "", pct, name))
    out("<<<TEXT %s" % mid); out((m.get("text") or "").strip()); out("TEXT>>>")
    out("FILES\tbrief=%s\treport=%s\tthread=%s" % (m["_brief"], m["_report"], m["_thread"]))
    out("<<<CONTINUE %s" % mid); out(m["_continue"]); out("CONTINUE>>>")
    out("<<<PROMPT %s" % mid); out(m["_prompt"].rstrip("\n")); out("PROMPT>>>")


def take_msg(m):
    """a message claimed from the server: save the campaign's files, keep the block for a fresh dispatcher, print it."""
    rid, mid = m.get("id") or "", m.get("mid")
    if not L.ID_RE.match(rid) or mid is None:
        return False
    os.makedirs(L.DONE, exist_ok=True)
    brief_f = L.brief_path(rid, done=True)
    if not os.path.exists(brief_f):                              # e.g. the local files were cleaned: rebuild it from the server copy
        b = (m.get("brief") or "").rstrip()
        open(brief_f, "w", encoding="utf-8").write(b + ("\n" if m.get("is_test") else "\n\nGADLYTICS launch id: %s\n" % rid))
    report_f, thread_f = os.path.join(L.DONE, rid + ".report.txt"), os.path.join(L.DONE, rid + ".thread.txt")
    open(report_f, "w", encoding="utf-8").write(((m.get("report") or "").strip() or "(مفيش تقرير متسجل)") + "\n")
    open(thread_f, "w", encoding="utf-8").write("".join("[%s] %s: %s\n" % (hhmm(t.get("at")), "محمود" if t.get("who") == "user" else "الحملة", (t.get("text") or "").strip())
                                                         for t in (m.get("thread") or [])) or "(مفيش رسايل)\n")
    code, name, text = m.get("campaign_no") or "", clean(m.get("campaign_name")), (m.get("text") or "").strip()
    ar_state = AR_STATE.get(m.get("state"), m.get("state") or "")
    pct = ("%s%%" % m["progress"]) if m.get("progress") is not None else "?"
    if m.get("is_test"):
        final = "stopped --reason \"اختبار الرسايل — مفيش حملة\"" if m.get("state") == "stopped" else "draft --campaign MGG-00000 --report-file ~/.gadlytics/launch_queue/test_report.txt"
        if not os.path.exists(TEST_REPORT):
            open(TEST_REPORT, "w", encoding="utf-8").write("اختبار الربط نجح: الماك استلم الطلب وبدأ وبلّغ الحالة.\nمفيش حملة اتبنت — ده اختبار بس.\n")
        m["_prompt"] = m["_continue"] = TEST_MSG_TPL.format(id=rid, short=clean(text)[:40].replace('"', "'"), final=final)
    else:
        kw = dict(id=rid, code=code or "(no number yet)", text=text, brief=brief_f, report=report_f, thread=thread_f, rules=RULES, tabs=TABS)
        m["_continue"] = CONTINUE_TPL.format(**kw)
        m["_prompt"] = RESUME_HEAD.format(name=(" — " + name) if name else "", platform=m.get("platform") or "", state=ar_state, pct=pct, **kw) + open(brief_f, encoding="utf-8").read()
    m["_brief"], m["_report"], m["_thread"] = brief_f, report_f, thread_f
    json.dump(m, open(os.path.join(L.QDIR, "%s.msg-%s.json" % (rid, mid)), "w", encoding="utf-8"), ensure_ascii=False)
    L.log("message %s on %s (%s): %s" % (mid, rid, code or "-", clean(text)[:80]))
    emit_msg(m)
    return True


def pending_msgs():
    try:
        return sorted(f for f in os.listdir(L.QDIR) if ".msg-" in f and f.endswith(".json"))
    except FileNotFoundError:
        return []


AR_STATE = {"queued": "في الطابور", "starting": "بتبدأ", "building": "بتتبني", "draft": "جاهزة درافت", "stopped": "وقفت", "cancelled": "اتلغت", "paused": "متوقفة مؤقتاً"}


def table(info):
    import datetime
    r = L.poll(dict(info, claim=False, mode="check", today=True, msgs=False))
    rows, now = r.get("today") or [], (r.get("now") or time.time() * 1000) / 1000.0

    def secs(iso):
        try:
            return datetime.datetime.fromisoformat(re.sub(r"(\.\d{1,6})\d*", r"\1", (iso or "").replace("Z", "+00:00"))).timestamp()
        except Exception:
            return None
    out("حملات النهارده: %s · بتتبني %s · في الطابور %s · الحد %s" % (len(rows), r.get("active"), r.get("queued"), r.get("limit")))
    if not rows:
        return
    out("| الحملة | المنصة | الحالة | الخطوة | نسبة | الوقت | آخر رسالة |"); out("|---|---|---|---|---|---|---|")
    for x in rows:
        a, b = secs(x.get("started_at")), secs(x.get("finished_at"))
        mins = ("%d د" % max(0, round(((b or now) - a) / 60))) if a else "—"
        step = ("%s/4 · " % x["step_no"] if x.get("state") == "building" and x.get("step_no") else "") + ((x.get("stop_reason") if x.get("state") == "stopped" else x.get("step")) or "")
        name = ("%s — %s" % (x["campaign_no"], clean(x.get("title")))) if x.get("campaign_no") else clean(x.get("title"))   # the campaign code leads once it is known
        pct = "100%" if x.get("state") == "draft" else ("%s%%" % x["progress"]) if x.get("progress") is not None else ("%d%%" % (x["step_no"] * 25)) if x.get("state") == "building" and x.get("step_no") else "—"
        lm = x.get("last_msg") or None
        last = ("%s: %s%s" % ("محمود" if lm.get("who") == "user" else "الحملة", clean(lm.get("text"))[:70], " (مستني المراقب)" if lm.get("pending") else "")) if lm else "—"
        out("| %s%s | %s | %s | %s | %s | %s | %s |" % (name, " (تجريبي)" if x.get("is_test") else "", x.get("platform"), AR_STATE.get(x.get("state"), x.get("state")),
                                                   clean(step)[:90] or "—", pct, mins, last.replace("|", "/")))


def alive(pid):
    try:
        os.kill(pid, 0); return True
    except Exception:
        return False


def main():
    os.makedirs(L.QDIR, exist_ok=True); os.makedirs(L.DONE, exist_ok=True)
    info = {"host": socket.gethostname().split(".")[0], "v": L.VERSION, "mode": "watch"}
    if MSGS:
        info["msgs"] = True                                        # this dispatcher knows what to do with MESSAGE blocks
    if "--status" in ARGS or "--table" in ARGS:
        try:
            if "--table" in ARGS:
                table(info)
            else:
                r = L.poll(dict(info, claim=False, mode="check", msgs=False))
                out("launch watcher: key ✓ · limit %s · queued %s · active %s · pending files %s" % (r.get("limit"), r.get("queued"), r.get("active"), len(pending())))
        except L.LaunchError as e:
            out("launch watcher ✗ %s" % e); sys.exit(2)
        return
    try:
        old = int(open(PIDFILE).read().strip() or 0)
    except Exception:
        old = 0
    if old and old != os.getpid() and alive(old):
        out("WATCHER-ALREADY-RUNNING pid %s — مراقب تاني شغّال فعلاً، مش هشغّل واحد كمان." % old); sys.exit(3)
    open(PIDFILE, "w").write(str(os.getpid()))

    def bye(*_):
        try:
            if open(PIDFILE).read().strip() == str(os.getpid()):
                os.remove(PIDFILE)
        except Exception:
            pass
        sys.exit(0)
    signal.signal(signal.SIGTERM, bye); signal.signal(signal.SIGINT, bye)

    def keyfail(e):
        out("WATCHER-KEY-PROBLEM %s" % e); L.log("key problem: %s" % e)
        try:
            os.remove(PIDFILE)
        except Exception:
            pass
        sys.exit(2 if e.code in ("no_key", "unauthorized", "no_anon") else 1)

    try:
        L.key()
        first = L.poll(dict(info, claim=False, msgs=False))
    except L.LaunchError as e:
        keyfail(e)
    tracked = load_tracked()
    # Requests claimed earlier and not started yet. A restart inside the same dispatcher chat never hands them over again
    # (the dispatcher restarts the watcher BEFORE it launches the agents); only a NEW dispatcher (--fresh) takes them.
    still = set(first.get("starting") or [])
    left = 0
    for rid in pending():
        if rid not in still:
            L.mark_done(rid)                                   # cancelled / timed out / already building: nothing to start
        elif FRESH or not os.path.exists(os.path.join(L.QDIR, rid + ".emitted")):
            emit(rid); left += 1
    # messages handed over earlier whose campaign was not picked up again: only a NEW dispatcher (--fresh --msgs) gets them once more
    for f in pending_msgs():
        try:
            m = json.load(open(os.path.join(L.QDIR, f), encoding="utf-8"))
        except Exception:
            m = None
        if not m or (time.time() - os.path.getmtime(os.path.join(L.QDIR, f))) > 86400:
            os.remove(os.path.join(L.QDIR, f))
        elif FRESH and MSGS:
            emit_msg(m); left += 1
    news = updates(first.get("track"), tracked)
    L.log("watcher up (pid %s, dispatch=%s, fresh=%s, msgs=%s, leftover=%s, news=%s)" % (os.getpid(), DISPATCH, FRESH, MSGS, left, news))
    if (left or news) and DISPATCH:
        bye()
    fails = 0
    while True:
        try:
            r = L.poll(info)
            fails = 0
            n = sum(1 for row in (r.get("rows") or []) if take(row))
            n += sum(1 for m in (r.get("msgs") or []) if take_msg(m))
            n += updates(r.get("track"), tracked)
            if n and DISPATCH:
                bye()
        except L.LaunchError as e:
            fails += 1
            if e.code == "unauthorized":
                keyfail(e)
            if fails in (1, 10, 100):
                L.log("poll failed (%s): %s" % (fails, e))
        except Exception as e:                                     # never die on a bad response
            fails += 1
            if fails in (1, 10, 100):
                L.log("poll error (%s): %s" % (fails, str(e)[:200]))
        time.sleep(POLL if fails < 5 else min(30, POLL * fails))


if __name__ == "__main__":
    main()
