#!/usr/bin/env python3
"""GADLYTICS «إطلاق الحملات» — shared helpers for launch_watcher.py and launch_status.py (the Mac side).
Never prints the launch key. Key file: ~/.gadlytics/launch.key (mode 600), made by
  python3 ~/.gadlytics/make_api_key.py launch-mac --launch
The public anon key (gateway header) is read from the site's config.js."""
import json, os, re, stat, sys, time, urllib.error, urllib.request

HOME = os.path.expanduser("~/.gadlytics")
SUPA = "https://ibpwudzjwjraqhfdmzet.supabase.co"
API = SUPA + "/functions/v1/launch-api"
KEY_FILE = os.environ.get("GAD_LAUNCH_KEY_FILE") or os.path.join(HOME, "launch.key")
QDIR = os.path.join(HOME, "launch_queue")
DONE = os.path.join(QDIR, "done")
LOG = os.path.join(HOME, "launch_watcher.log")
VERSION = "1.0"
CONFIG_JS = [os.path.expanduser("~/Desktop/claude/gadlytics-site/config.js")]
CONFIG_URL = "https://mahmoudgadmediabuyer.github.io/gadlytics/config.js"
ID_RE = re.compile(r"^[a-z0-9]{8,24}$")


class LaunchError(Exception):
    def __init__(self, status, code, msg):
        Exception.__init__(self, msg); self.status = status; self.code = code


def log(msg):
    try:
        os.makedirs(HOME, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
        if os.path.getsize(LOG) > 2_000_000:                       # keep the log small
            lines = open(LOG, encoding="utf-8", errors="replace").read().split("\n")[-3000:]
            open(LOG, "w", encoding="utf-8").write("\n".join(lines))
    except Exception:
        pass


def key():
    try:
        st = os.stat(KEY_FILE)
    except FileNotFoundError:
        raise LaunchError(0, "no_key", "مفيش مفتاح إطلاق — شغّل: python3 ~/.gadlytics/make_api_key.py launch-mac --launch")
    if stat.S_IMODE(st.st_mode) & 0o077:
        os.chmod(KEY_FILE, 0o600)
    k = open(KEY_FILE, encoding="utf-8").read().strip()
    if not k.startswith("gad_"):
        raise LaunchError(0, "no_key", "ملف المفتاح مش مظبوط — اعمله تاني بـ make_api_key.py launch-mac --launch")
    return k


_anon = None
def anon():
    global _anon
    if _anon:
        return _anon
    txt = ""
    for p in CONFIG_JS:
        try:
            txt = open(p, encoding="utf-8").read(); break
        except Exception:
            pass
    cache = os.path.join(HOME, ".anon_cache")
    if not txt:
        try:
            txt = open(cache, encoding="utf-8").read()
        except Exception:
            pass
    if not txt:
        txt = urllib.request.urlopen(CONFIG_URL, timeout=20).read().decode("utf-8", "replace")
        try:
            open(cache, "w", encoding="utf-8").write(txt); os.chmod(cache, 0o600)
        except Exception:
            pass
    m = re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"', txt)
    if not m:
        raise LaunchError(0, "no_anon", "مش لاقي الـ anon key في config.js")
    _anon = m.group(1)
    return _anon


def _call(url, method="GET", body=None, with_key=True, timeout=30):
    a = anon()
    h = {"Authorization": "Bearer " + a, "apikey": a, "content-type": "application/json"}
    if with_key:
        h["x-api-key"] = key()
    req = urllib.request.Request(url, method=method, headers=h, data=None if body is None else json.dumps(body).encode("utf-8"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            d = json.loads(raw)
        except Exception:
            d = {}
        raise LaunchError(e.code, str(d.get("code") or d.get("error_code") or e.code), str(d.get("error") or d.get("message") or raw[:200]))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LaunchError(0, "network", "مفيش اتصال: %s" % (getattr(e, "reason", e),))


def api(method, path, body=None, tries=4):
    """launch-api edge function (x-api-key = the launch key). A dropped connection is retried (2 s, 5 s, 10 s):
    a status line — above all the final draft / stopped one — must not be lost to a network blip."""
    for i in range(tries):
        try:
            return _call(API + path, method, body)
        except LaunchError as e:
            if e.code != "network" and e.status not in (502, 503, 504) or i == tries - 1:
                raise
            time.sleep((2, 5, 10)[min(i, 2)])


def poll(info):
    """rpc launch_poll: key check + heartbeat + claim, straight from Postgres (cheap enough to call every 2 s)."""
    try:
        return _call(SUPA + "/rest/v1/rpc/launch_poll", "POST", {"p_key": key(), "p_info": info}, with_key=False, timeout=20)
    except LaunchError as e:
        if e.code in ("28000",) or "unauthorized" in str(e):
            raise LaunchError(401, "unauthorized", "مفتاح الإطلاق غلط أو اتلغى — اعمل واحد جديد: python3 ~/.gadlytics/make_api_key.py launch-mac --launch")
        raise


def numlock(rid):
    """rpc launch_numlock: ask for the turn to take a NEW campaign number from the launch tool (one build at a time)."""
    return _call(SUPA + "/rest/v1/rpc/launch_numlock", "POST", {"p_key": key(), "p_id": rid}, with_key=False, timeout=20)


def kz(rid, links=None, takeover=False):
    """rpc launch_kz: Khzama links through the Chrome extension — submit the list (idempotent), read the result, or take over."""
    return _call(SUPA + "/rest/v1/rpc/launch_kz", "POST", {"p_key": key(), "p_id": rid, "p_links": links, "p_takeover": bool(takeover)},
                 with_key=False, timeout=20)


def tl(rid, inputs=None, takeover=False):
    """rpc launch_tl: the Tamkeen launch tool through the Chrome extension — submit the inputs once (idempotent), read the results, or take over."""
    for i in range(3):                                     # every call is safe to repeat: a dropped connection is tried again
        try:
            return _call(SUPA + "/rest/v1/rpc/launch_tl", "POST", {"p_key": key(), "p_id": rid, "p_inputs": inputs, "p_takeover": bool(takeover)},
                         with_key=False, timeout=20)
        except LaunchError as e:
            if e.code != "network" or i == 2:
                raise
            time.sleep(2)


def pause(rid, action="check", note=None):
    """rpc launch_pause: did Mahmoud ask to pause this build? (check) / the build has stopped at a safe point (paused)."""
    return _call(SUPA + "/rest/v1/rpc/launch_pause", "POST", {"p_key": key(), "p_id": rid, "p_action": action, "p_note": note}, with_key=False, timeout=20)


def prompt_path(rid, done=False):
    return os.path.join(DONE if done else QDIR, rid + ".prompt.txt")


def brief_path(rid, done=False):
    return os.path.join(DONE if done else QDIR, rid + ".brief.txt")


def mark_done(rid):
    """the build of this request was started (or refused): move its files out of the pending folder."""
    os.makedirs(DONE, exist_ok=True)
    for ext in (".json", ".prompt.txt", ".brief.txt"):
        src = os.path.join(QDIR, rid + ext)
        if os.path.exists(src):
            os.replace(src, os.path.join(DONE, rid + ext))
    try:
        os.remove(os.path.join(QDIR, rid + ".emitted"))
    except OSError:
        pass
    try:                                                   # messages of this campaign that were handed to the dispatcher
        for f in os.listdir(QDIR):
            if f.startswith(rid + ".msg-") and f.endswith(".json"):
                os.remove(os.path.join(QDIR, f))
    except OSError:
        pass


def set_final(rid, state):
    """remember that a final state (draft / stopped) was reported from THIS Mac — the watcher then leaves the news to the agent's
    own completion instead of waking the dispatcher a second time. state None = the build is running again."""
    f = os.path.join(DONE, rid + ".final")
    try:
        if state:
            os.makedirs(DONE, exist_ok=True); open(f, "w").write(state)
        elif os.path.exists(f):
            os.remove(f)
    except OSError:
        pass


def local_final(rid):
    try:
        return open(os.path.join(DONE, rid + ".final")).read().strip()
    except OSError:
        return ""
