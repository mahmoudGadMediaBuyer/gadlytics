#!/usr/bin/env python3
"""GADLYTICS «إطلاق الحملات» — report a campaign build's state back to the launch page.
Called by the campaign build (tamkeen-launch skill — a background agent of the «مراقب الإطلاق» chat, or a separate session)
when its brief carries a line  GADLYTICS launch id: <id>.

  python3 ~/.gadlytics/launch_status.py <id> building --step-no 1 --step "أداة الإطلاق: الأسامي وروابط UTM" --launches 0/3
  python3 ~/.gadlytics/launch_status.py <id> building --step-no 1 --launches 1/3 --campaign MGG-03081 --name "MGG-03081 | CL:Molabi | PR:… | VR:… | OB:… | GE:SA"
  python3 ~/.gadlytics/launch_status.py <id> building --step-no 2 --step "بناء الحملة على Meta" --adsets 3/3 --ads 6/12
  python3 ~/.gadlytics/launch_status.py <id> building --step-no 3 --step "تسجيل الروابط في خزامى" --khzama 6/12
  python3 ~/.gadlytics/launch_status.py <id> building --step-no 4 --step "مراجعة أخيرة"
  python3 ~/.gadlytics/launch_status.py <id> draft   --campaign MGG-03081 --name "…" --report-file /path/report.txt
  python3 ~/.gadlytics/launch_status.py <id> stopped --reason "الفيديو 2026… مش موجود في مكتبة المنصة" --report-file /path/report.txt
  python3 ~/.gadlytics/launch_status.py <id> starting --step "بتبدأ تتبني على الماك"                         (the dispatcher only)
  python3 ~/.gadlytics/launch_status.py <id> show                                                          (current state)
  python3 ~/.gadlytics/launch_status.py <id> say --text-file /path/reply.txt [--notify]                    (a reply in the card's chat)
  python3 ~/.gadlytics/launch_status.py <id> khzama-links --file links.json                            (روابط خزامى: الإضافة تسجّلهم)
  python3 ~/.gadlytics/launch_status.py <id> khzama-status [--wait 240] [--take-over]                   (خلصوا؟ إيه اللي ناقص؟)
  python3 ~/.gadlytics/launch_status.py <id> paused --step "<اللي موجود واللي فاضل>" [--adsets K/N …]   (بعد سطر PAUSE REQUESTED: وقفت عند نقطة آمنة)
  python3 ~/.gadlytics/launch_status.py <id> number-lock                                                   (my turn to take a NEW campaign number?)

number-lock: only ONE build at a time may press its first Launch with Campaign = New, so two parallel campaigns can never get
the same number. Run it when the launch-tool form is filled and checked, right before that first Launch. It waits up to ~100 s
and ends with one of:  NUMBER-LOCK HELD (press Launch now, then report the number at once with --campaign … --name … — that
releases the lock) · NUMBER-LOCK WAITING (run the same command again) · NUMBER-LOCK UNAVAILABLE (carry on without it;
campaign-claim.sh is still the second check). The lock also frees itself when the build reaches draft / stopped, or after 6
minutes without any status call. Later launches of the same campaign (Select → its own number) need no lock.

say: a short Egyptian-Arabic answer to a message Mahmoud wrote on the campaign's card. It changes no state. --notify also sends
a push — use it only for a reply that is NOT followed by a new draft / stopped (which already notify).

Progress (the «NN%» bar on the page) is computed by the server from the counts, K done of N in total, each call merging into
the ones sent before:  --launches K/N (launch-tool launches, one per ad set) 20% · --adsets K/N (ad sets created on the platform) 10% ·
--ads K/N (ads created) 35% · --khzama K/N (Khzama links saved) 30% · the final check is the last 5% (100 only at draft).
It never goes back while building; --progress N sets it by hand.

States: starting → building → draft | stopped (a stopped build may go back to building). draft / stopped send ONE push
notification to Mahmoud's devices; the push body is the first line of the report. A failure here never stops a build:
the script prints one line and exits 0 unless --strict is given. It never prints a key."""
import argparse, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import launch_lib as L

p = argparse.ArgumentParser(add_help=True)
p.add_argument("id"); p.add_argument("state", choices=["starting", "building", "draft", "stopped", "show", "say", "number-lock", "khzama-links", "khzama-status", "paused"])
p.add_argument("--step"); p.add_argument("--step-no", type=int)
p.add_argument("--campaign"); p.add_argument("--name")
p.add_argument("--reason"); p.add_argument("--session"); p.add_argument("--session-id")
p.add_argument("--report-file"); p.add_argument("--report")
p.add_argument("--launches"); p.add_argument("--adsets"); p.add_argument("--ads"); p.add_argument("--khzama"); p.add_argument("--progress", type=int)
p.add_argument("--text-file"); p.add_argument("--text"); p.add_argument("--notify", action="store_true")
p.add_argument("--wait", type=int, default=None)
p.add_argument("--file"); p.add_argument("--take-over", action="store_true")
p.add_argument("--result-kind", choices=["draft", "paused"])   # how a finished build was left: a UI draft, or real objects PAUSED (API builds)
p.add_argument("--strict", action="store_true")
a = p.parse_args()


def fail(msg, code=1):
    print("launch_status ✗ " + msg + ("" if a.strict else "  (كمّل الشغل عادي — ده تبليغ حالة بس)"))
    L.log("status %s %s FAILED: %s" % (a.id, a.state, msg))
    sys.exit(code if a.strict else 0)


if not L.ID_RE.match(a.id):
    fail("launch id شكله غلط: %s" % a.id)
try:
    if a.state == "show":
        r = L.api("GET", "/row?id=" + a.id)["row"]
        print("launch %s · %s · %s · state=%s · step=%s · progress=%s · campaign=%s · name=%s%s" % (r["id"], r["platform"], r["title"], r["state"], r.get("step") or "-",
              ("%s%%" % r["progress"]) if r.get("progress") is not None else "-", r.get("campaign_no") or "-", r.get("campaign_name") or "-", (" · left=%s" % r["result_kind"]) if r.get("result_kind") else ""))
        sys.exit(0)
    if a.state == "number-lock":
        import time
        end, last, pos = time.time() + max(5, min(540, 100 if a.wait is None else a.wait)), None, None
        while True:
            try:
                r = L.numlock(a.id)
            except L.LaunchError as e:
                print("NUMBER-LOCK UNAVAILABLE (%s) — كمّل من غيره؛ campaign-claim.sh هو الفحص التاني." % e)
                L.log("numlock %s unavailable: %s" % (a.id, e)); sys.exit(0)
            if not r.get("ok"):
                print("NUMBER-LOCK UNAVAILABLE (%s) — كمّل من غيره؛ campaign-claim.sh هو الفحص التاني." % (r.get("error") or r))
                L.log("numlock %s not ok: %s" % (a.id, r)); sys.exit(0)
            if r.get("held"):
                if r.get("note") == "already_numbered":
                    print("NUMBER-LOCK HELD — الحملة ليها رقم بالفعل (%s): مفيش قفل مطلوب؛ الإطلاقات الباقية بـ Select على نفس الرقم." % r.get("campaign"))
                else:
                    print("NUMBER-LOCK HELD — دورك: اضغط Launch (Campaign = New) دلوقتي، وأول ما الرقم يظهر بلّغه فوراً بـ --campaign MGG-… --name \"…\" (ده اللي بيفك القفل للي بعدك).")
                L.log("numlock %s held%s" % (a.id, " (already numbered)" if r.get("note") else "")); sys.exit(0)
            pos = r.get("position")
            if pos != last:
                print("number-lock: مستنية دورها — قدامها %s%s" % (pos, (" (اللي معاه الدور: %s)" % r["holder"]) if r.get("holder") else "")); sys.stdout.flush(); last = pos
            if time.time() >= end:
                print("NUMBER-LOCK WAITING (قدامها %s) — شغّل نفس الأمر تاني وما تضغطش Launch قبل ما يطلع HELD." % pos)
                L.log("numlock %s still waiting (%s ahead)" % (a.id, pos)); sys.exit(0)
            time.sleep(4)
    if a.state in ("khzama-links", "khzama-status"):
        # Khzama affiliate links through the Chrome extension «GADLYTICS · خزامى لحظي». It never fails a build: when the
        # extension is off / not updated / too slow, the lines say MANUAL or MISSING and the agent registers those by hand.
        import json, time
        MAN = "سجّل الروابط بإيدك زي ما السكيل بيقول (فحص الـ keyword الأول)."
        try:
            if a.state == "khzama-links":
                if not a.file:
                    print("KHZAMA-LINKS MANUAL (محتاج --file links.json) — " + MAN); sys.exit(0)
                raw = open(os.path.expanduser(a.file), encoding="utf-8").read()
                try:
                    links = json.loads(raw)
                    if isinstance(links, dict):
                        links = links.get("links") or links.get("titles") or []
                except ValueError:
                    links = [x.strip() for x in raw.splitlines() if x.strip()]
                if not isinstance(links, list) or not links:
                    print("KHZAMA-LINKS MANUAL (الملف مفيهوش قائمة روابط) — " + MAN); sys.exit(0)
                r = L.kz(a.id, links)
                if not r.get("ok"):
                    print("KHZAMA-LINKS MANUAL (%s) — %s" % (r.get("error") or r, MAN)); L.log("kz %s submit not ok: %s" % (a.id, r)); sys.exit(0)
                ext = r.get("ext") or {}
                if not ext.get("on") and not r.get("total"):
                    why = "الزرار مقفول" if ext.get("switch") is False else "مش متحدّثة أو كروم مقفول" if ext.get("seen_sec") is None else "آخر ظهور من %s ثانية" % ext.get("seen_sec")
                    print("KHZAMA-LINKS MANUAL — الإضافة مش شغالة (%s): %s" % (why, MAN)); L.log("kz %s: extension off (%s)" % (a.id, ext)); sys.exit(0)
                for x in r.get("rejected") or []:
                    print("REJECTED %s (%s) — سجّله بإيدك" % (x.get("title"), x.get("why")))
                print("KHZAMA-LINKS QUEUED %s (جديد %s · متسجّل قبل كده في القائمة %s · مرفوض %s) — الإضافة بتسجّلهم دلوقتي في خزامى: كمّل بناء الحملة وما تفتحش فورم خزامى، "
                      "وما تبعتش --khzama لحد الآخر. بعد البناء: python3 ~/.gadlytics/launch_status.py %s khzama-status --wait 240"
                      % (r.get("total"), r.get("added"), r.get("already"), len(r.get("rejected") or []), a.id))
                L.log("kz %s submitted: total=%s added=%s rejected=%s" % (a.id, r.get("total"), r.get("added"), len(r.get("rejected") or [])))
                sys.exit(0)
            end = time.time() + max(0, min(540, a.wait or 0))
            while True:
                r = L.kz(a.id)
                if not r.get("ok"):
                    print("KHZAMA-STATUS UNAVAILABLE (%s) — افحص الروابط بإيدك بالـ keyword وسجّل الناقص." % (r.get("error") or r)); sys.exit(0)
                busy = (r.get("queued") or 0) + (r.get("adding") or 0)
                if not busy or time.time() >= end:
                    break
                time.sleep(5)
            if a.take_over and busy:
                r = L.kz(a.id, None, True)
            ext = r.get("ext") or {}
            tot, done = r.get("total") or 0, r.get("done") or 0
            if not tot:
                print("KHZAMA-STATUS NONE — مفيش روابط متسلّمة للإضافة للحملة دي: " + MAN); sys.exit(0)
            print("KHZAMA-STATUS %s/%s done%s · adding %s · queued %s · failed %s · الإضافة: %s" % (done, tot,
                  (" (منهم %s كانوا موجودين)" % r["existed"]) if r.get("existed") else "", r.get("adding") or 0, r.get("queued") or 0, r.get("failed") or 0,
                  "شغالة" if ext.get("on") else "مش ظاهرة"))
            for j in r.get("jobs") or []:
                if j.get("state") == "failed":
                    print("MISSING %s — %s" % (j.get("title"), j.get("error") or "failed"))
                elif j.get("state") == "adding":
                    print("ADDING %s — الإضافة شغالة عليه دلوقتي: استنى 30 ثانية وشغّل الأمر تاني قبل ما تسجّله بإيدك" % j.get("title"))
                elif j.get("state") == "queued":
                    print("WAITING %s — لسه في الدور (شغّل الأمر بـ --wait، أو بـ --take-over لو هتسجّله بإيدك)" % j.get("title"))
            if done == tot:
                print("KHZAMA-STATUS ALL DONE — بلّغ: --khzama %s/%s  (وفي التقرير: الروابط اتسجّلت بالإضافة)" % (done, tot))
            elif not (r.get("queued") or r.get("adding")):
                print("KHZAMA-STATUS MANUAL %s — سجّل سطور MISSING بإيدك (فحص الـ keyword الأول لكل واحد)، وبعدها بلّغ --khzama بالعدد الحقيقي." % (tot - done))
            L.log("kz %s status: %s/%s failed=%s queued=%s adding=%s" % (a.id, done, tot, r.get("failed"), r.get("queued"), r.get("adding")))
        except L.LaunchError as e:
            print("%s UNAVAILABLE (%s) — %s" % (a.state.upper(), e, MAN)); L.log("kz %s unavailable: %s" % (a.id, e))
        except Exception as e:
            print("%s UNAVAILABLE (%s) — %s" % (a.state.upper(), str(e)[:160], MAN))
        sys.exit(0)
    if a.state == "say":
        txt = a.text or ""
        if a.text_file:
            txt = open(os.path.expanduser(a.text_file), encoding="utf-8").read()
        if not txt.strip():
            fail("say محتاج --text-file <ملف فيه الرد> أو --text \"…\"")
        r = L.api("POST", "/say", {"id": a.id, "text": txt.strip(), "notify": bool(a.notify)})
        push = r.get("push")
        print("launch_status ✓ %s: الرد اتبعت في شات الحملة%s" % (a.id, (" · push %s" % ("sent to %s device(s)" % push.get("sent") if push.get("ok") else "not delivered")) if push else ""))
        L.log("say %s (%s chars)%s" % (a.id, len(txt.strip()), " push=%s" % (push,) if push else ""))
        sys.exit(0)
    PAUSE_LINE = ("PAUSE REQUESTED — محمود طلب إيقاف مؤقت للحملة دي. خلّص الخطوة اللي في إيدك بس (ما تسيبش فورم مليان من غير حفظ ولا حاجة نص مبنية)، "
                  "وبعدها بلّغ: python3 ~/.gadlytics/launch_status.py %s paused --step \"<اللي اتبنى واللي فاضل في سطر>\" (ومعاها الأعداد --adsets/--ads/--khzama) ووقّف خالص — "
                  "من غير draft ولا stopped، ومن غير ما تبدأ خطوة جديدة. هيكمّل برسالة «كمّل» بعدين.") % a.id
    to_pause = a.state == "paused"
    if to_pause:
        a.state = "building"                               # the counts go through the normal call first, then the row is parked
    body = {"id": a.id, "state": a.state}
    for k, v in (("step", a.step), ("step_no", a.step_no), ("campaign", a.campaign), ("name", a.name), ("reason", a.reason), ("session", a.session), ("session_id", a.session_id)):
        if v is not None and v != "":
            body[k] = v
    counts = {}
    for k, v in (("launch", a.launches), ("adsets", a.adsets), ("ads", a.ads), ("khzama", a.khzama)):
        m = re.match(r"^\s*(\d+)\s*(?:/|of|من)\s*(\d+)\s*$", v or "")
        if m and int(m.group(2)) > 0:
            counts[k] = [int(m.group(1)), int(m.group(2))]
        elif v:
            print("launch_status: تجاهلت %s=%s (الصيغة K/N زي 2/6)" % (k, v))
    if counts:
        body["counts"] = counts
    if a.progress is not None:
        body["progress"] = max(0, min(100, a.progress))
    if a.result_kind:
        body["result_kind"] = a.result_kind
    rep = a.report
    if a.report_file:
        try:
            rep = open(os.path.expanduser(a.report_file), encoding="utf-8").read()
        except Exception as e:
            print("launch_status: مش قادر أقرا ملف التقرير (%s) — هبعت الحالة من غيره" % e)
    if rep and rep.strip():
        body["report"] = rep.strip()
    if a.state == "stopped" and not a.reason:
        body["reason"] = "البناء وقف من غير ما يتكتب السبب"
    if to_pause:
        note = body.pop("step", None)
        if len(body) > 2:
            try:
                L.api("POST", "/status", body)
            except L.LaunchError as e:
                print("launch_status: الأعداد ماتبعتتش قبل الإيقاف (%s)" % e)
        pr = L.pause(a.id, "paused", note)
        if pr.get("ok"):
            print("launch_status ✓ %s: متوقفة مؤقتاً عند %s%% — وقّف دلوقتي. لما محمود يدوس «كمّل» هتوصلك رسالة تكمّل منها." % (a.id, pr.get("progress") if pr.get("progress") is not None else "?"))
        elif pr.get("error") == "no_pause_requested":
            print("launch_status: مفيش طلب إيقاف مؤقت على الحملة دي (يمكن اتلغى) — كمّل البناء عادي.")
        else:
            print("launch_status ✗ الإيقاف المؤقت ماتسجّلش (%s) — كمّل البناء عادي." % (pr.get("error") or pr))
        L.log("pause %s -> %s" % (a.id, pr)); sys.exit(0)
    r = L.api("POST", "/status", body)
    L.mark_done(a.id)                                  # its build is started: never hand it to the dispatcher again
    L.set_final(a.id, a.state if a.state in ("draft", "stopped") else None)
    push = r.get("push")
    print("launch_status ✓ %s: %s → %s%s%s%s" % (a.id, r.get("was"), r.get("state"), (" · " + r["campaign"]) if r.get("campaign") else "",
          (" · %s%%" % r["progress"]) if r.get("progress") is not None and r.get("state") in ("starting", "building") else "",
          (" · push %s" % ("sent to %s device(s)" % push.get("sent") if push.get("ok") else "not delivered")) if push else ""))
    L.log("status %s %s -> %s%s" % (a.id, r.get("was"), r.get("state"), " push=%s" % (push,) if push else ""))
    if (a.launches or "").strip().startswith("0/"):         # the build's first status line: is the Khzama side ready?
        try:
            ext = (L.kz(a.id).get("ext") or {})
            if ext.get("khzama_login"):
                print("تنبيه: خزامى محتاج تسجيل دخول — روابط الحملة مش هتتسجّل بالإضافة ولا بإيدك لحد ما محمود يسجّل دخول في admin.molabi.sa. كمّل البناء، وقول ده في التقرير لو فضل كده.")
            elif not ext.get("on"):
                print("تنبيه: إضافة خزامى مش ظاهرة (%s) — روابط الحملة هتتسجّل بإيدك." % ("الزرار مقفول" if ext.get("switch") is False else "كروم مقفول أو الإضافة مش متحدّثة"))
        except Exception:
            pass
    if r.get("state") in ("starting", "building"):         # a pause Mahmoud asked for on the card: tell the agent at its next status call
        try:
            if L.pause(a.id).get("pause"):
                print(PAUSE_LINE); L.log("pause requested shown to %s" % a.id)
        except Exception:
            pass
except L.LaunchError as e:
    fail("%s (%s)" % (e, e.code))
except Exception as e:                                             # never break a build because of a status line
    fail(str(e)[:200])
