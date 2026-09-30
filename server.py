#!/usr/bin/env python3
"""The Daily Bias — Agent Desk board.

Local, read-only dashboard over the desk's real state files.
No third-party deps. Binds 127.0.0.1 only.

  python3 ~/workspace/desk/board/server.py [--port 8899]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

DESK = Path(os.environ.get("DESK_DIR", Path.home() / "workspace" / "desk"))
BOARD = DESK / "board"
HERMES = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
IST = ZoneInfo("Asia/Kolkata")
ET = ZoneInfo("America/New_York")

CA_CACHE: dict[str, tuple[float, object]] = {}
CACHE_TTL = 4.0


# ---------------------------------------------------------------- helpers
def cached(key: str, fn):
    hit = CA_CACHE.get(key)
    now = time.time()
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1]
    val = fn()
    CA_CACHE[key] = (now, val)
    return val


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def read_jsonl(path: Path) -> list[dict]:
    out = []
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        pass
    return out


def read_text(path: Path, limit: int = 4000) -> str:
    try:
        return path.read_text()[:limit]
    except Exception:
        return ""


def age_min(path: Path) -> float | None:
    try:
        return (time.time() - path.stat().st_mtime) / 60
    except Exception:
        return None


def parse_ts(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def next_occurrence(expr: str, now_et: datetime) -> datetime | None:
    """Minimal cron field matcher: minute hour dom month dow."""
    try:
        f = expr.split()
        if len(f) != 5:
            return None
        mins, hours, doms, months, dows = f

        def match(field, value, lo, hi):
            if field == "*":
                return True
            for part in field.split(","):
                step = 1
                if "/" in part:
                    part, s = part.split("/")
                    step = int(s)
                if part == "*":
                    return (value - lo) % step == 0
                if "-" in part:
                    a, b = part.split("-")
                    if int(a) <= value <= int(b) and (value - int(a)) % step == 0:
                        return True
                elif int(part) == value:
                    return True
            return False

        t = (now_et + timedelta(minutes=1)).replace(second=0, microsecond=0)
        for _ in range(60 * 24 * 8):
            nxt = t.strftime("%d").lstrip("0")
            if (
                t.minute <= hi_of(mins) and match(mins, t.minute, 0, 59)
                and match(hours, t.hour, 0, 23)
                and match(doms, int(nxt or "0"), 1, 31)
                and match(months, t.month, 1, 12)
                and match(dows, int(t.strftime("%w")), 0, 6)
            ):
                return t
            t += timedelta(minutes=1)
    except Exception:
        return None
    return None


def hi_of(field: str) -> int:
    return 59


# ---------------------------------------------------------------- sessions
def session_state(now_et: datetime) -> dict:
    """CME futures session + the desk's two killzones."""
    hour = now_et.hour + now_et.minute / 60
    dow = now_et.weekday()  # Mon=0

    # CME futures: Sun 18:00 ET -> Fri 17:00 ET, daily halt 17:00-18:00 ET
    halted = 17 <= hour < 18
    closed = (dow == 5) or (dow == 6 and hour < 18) or (dow == 4 and hour >= 17)
    if closed:
        market = "CLOSED"
    elif halted:
        market = "HALTED"
    else:
        market = "OPEN"

    zones = [
        ("Asia", 20, 26),   # 20:00 ET -> 02:00 ET next day
        ("NY", 9.5, 13.5),
    ]
    kill = None
    for name, a, b in zones:
        cur = hour if hour >= 20 else hour + 24
        if a <= cur < b:
            kill = name
            break

    if kill:
        sess = f"{kill} KILLZONE"
    elif 18 <= hour < 20:
        sess = "Asia run-up"
    elif 8 <= hour < 9.5:
        sess = "NY pre-market"
    elif 13.5 <= hour < 17:
        sess = "NY afternoon"
    else:
        sess = "dead zone"

    return {"market": market, "killzone": kill, "label": sess}


# ---------------------------------------------------------------- collectors
def playbook() -> list[dict]:
    pb = read_json(DESK / "playbook.json", {}) or {}
    out = []
    for key, obj in pb.items():
        if not isinstance(obj, dict):
            continue
        setups = []
        for s in (obj.get("setups") or [])[:3]:
            entry = s.get("entry")
            stop = s.get("stop")
            risk = abs((entry or 0) - (stop or 0)) or 1
            spot = s.get("spot") or obj.get("spot")
            tps = []
            for tp in (s.get("tps") or [])[:4]:
                p = tp.get("price") if isinstance(tp, dict) else tp
                if p is None:
                    continue
                r = (abs(spot - p) / risk) if spot else None
                tps.append(
                    {
                        "price": p,
                        "r": round(r, 2) if r else None,
                        "sources": (tp.get("sources") if isinstance(tp, dict) else None) or [],
                    }
                )
            dist = abs(spot - entry) if (spot and entry) else None
            setups.append(
                {
                    "bias": s.get("bias"),
                    "kind": s.get("kind"),
                    "grade": s.get("grade"),
                    "score": s.get("score"),
                    "zone": s.get("zone"),
                    "entry": entry,
                    "stop": stop,
                    "risk": round(risk, 2),
                    "risk_usd": s.get("risk_usd"),
                    "t1r": s.get("t1r"),
                    "t2r": s.get("t2r"),
                    "dist": round(dist, 2) if dist is not None else None,
                    "dist_atr": round(s.get("du"), 2) if s.get("du") is not None else None,
                    "conf": s.get("conf"),
                    "vote": s.get("vote"),
                    "vote_detail": s.get("vote_detail") or [],
                    "why": s.get("why") or [],
                    "tps": tps,
                }
            )
        out.append(
            {
                "key": key,
                "name": (obj.get("spec") or {}).get("name") or key.upper(),
                "spot": obj.get("spot"),
                "bias": obj.get("bias"),
                "vol": obj.get("vol"),
                "setups": setups,
            }
        )
    return out


def calls() -> dict:
    jobs = (read_json(DESK / "jobs.json", {}) or {}).get("jobs", [])
    if not jobs:
        return {"day": None, "rows": [], "stats": {}}
    day = jobs[-1].get("day")
    today = [j for j in jobs if j.get("day") == day]

    jr = read_jsonl(DESK / "journal.jsonl")
    latest: dict[str, dict] = {}
    for r in jr:
        if r.get("job"):
            latest[r["job"]] = r

    rows = []
    for j in today:
        jid = j.get("job")
        oc = latest.get(jid, {})
        risk = j.get("risk") or 0
        spread = None
        if j.get("zone") and len(j["zone"]) == 2:
            spread = round(abs(j["zone"][1] - j["zone"][0]), 2)
        rows.append(
            {
                "job": jid,
                "key": j.get("key"),
                "grade": j.get("grade"),
                "score": j.get("score"),
                "bias": j.get("bias"),
                "entry": j.get("entry"),
                "stop": j.get("stop"),
                "risk": round(risk, 2),
                "zone": j.get("zone"),
                "zone_pts": spread,
                "tps": j.get("tps") or [],
                "why": j.get("why") or [],
                "alerted": j.get("alerted"),
                "outcome": oc.get("outcome") or "pending",
                "outcome_when": oc.get("when") or "",
                "outcome_note": oc.get("note") or "",
            }
        )

    def n(o):
        return sum(1 for r in rows if r["outcome"] == o)

    stats = {
        "count": len(rows),
        "open": n("open"),
        "win": n("win"),
        "loss": n("loss"),
        "missed": n("missed"),
        "pending": n("pending"),
        "a_grade": sum(1 for r in rows if str(r["grade"]).startswith("A")),
        "top": max((r["score"] or 0) for r in rows) if rows else 0,
    }
    return {"day": day, "rows": rows[::-1], "stats": stats}


def paper() -> dict:
    rows = read_jsonl(DESK / "beta-results.jsonl")
    cum = 0.0
    curve = []
    for r in rows:
        if r.get("r") is not None:
            cum += r["r"]
            curve.append({"t": r.get("resolved_ts"), "cum": round(cum, 2)})
    resolved = [r for r in rows if r.get("final") and r.get("r") is not None]
    wins = [r for r in resolved if (r.get("r") or 0) > 0]
    return {
        "count": len(rows),
        "resolved": len(resolved),
        "cum_r": round(cum, 2),
        "win_rate": round(100 * len(wins) / len(resolved)) if resolved else None,
        "curve": curve[-40:],
        "rows": [
            {
                "rec_id": r.get("rec_id"),
                "event": r.get("event"),
                "key": r.get("key"),
                "bias": r.get("bias"),
                "kind": r.get("kind"),
                "grade": r.get("grade"),
                "r": r.get("r"),
                "final": r.get("final"),
                "session": r.get("session"),
                "hour_et": r.get("hour_et"),
                "zone": r.get("zone"),
            }
            for r in rows[::-1][:25]
        ],
    }


def lessons() -> list[dict]:
    txt = read_text(DESK / "lessons.md", 20000)
    out = []
    for block in re.split(r"\n##\s+", txt)[1:]:
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        head = lines[0] if lines else ""
        m = re.match(r"(\S+)\s+·\s+([\d\-: ]+)\s+ET\s+·\s+(\S+)\s+(\S+)\s+(\S+)\s+·\s+r=([-\d.]+)", head)
        body = [l for l in lines[1:] if not l.startswith("#")]
        out.append(
            {
                "head": head,
                "rec_id": m.group(1) if m else None,
                "when": m.group(2).strip() if m else None,
                "key": m.group(3) if m else None,
                "outcome": m.group(5) if m else None,
                "r": float(m.group(6)) if m else None,
                "body": body[:8],
            }
        )
    return out[::-1][:12]


def crons() -> list[dict]:
    raw = read_json(HERMES / "cron" / "jobs.json", [])
    jobs = raw if isinstance(raw, list) else raw.get("jobs", [])
    now = datetime.now(IST)
    now_et = datetime.now(ET)

    recent: dict[str, list] = {}
    db = HERMES / "cron" / "executions.db"
    sql = (
        "select job_id,status,started_at,finished_at,delivery_outcome from executions "
        "order by scheduled_instant desc limit 400"
    )
    rows = None
    for connect in (
        lambda: sqlite3.connect(db, timeout=4),
        lambda: sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=4),
    ):
        try:
            con = connect()
            try:
                rows = list(con.execute(sql))
            finally:
                con.close()
            break
        except Exception:
            continue
    for row in rows or []:
        jid, status, started, finished = row[0], row[1], row[2], row[3]
        delivery = row[4] if len(row) > 4 else None
        recent.setdefault(jid, []).append((status, started, finished, delivery))

    out = []
    for j in jobs:
        nxt = parse_ts(j.get("next_run_at"))
        sch = j.get("schedule") or {}
        expr = sch.get("expr") if isinstance(sch, dict) else None
        secs = (nxt - now).total_seconds() if nxt else None
        if nxt is None or (secs is not None and secs < -30) or expr is None:
            nxt = next_occurrence(expr, now_et) if expr else nxt
            secs = (nxt - now).total_seconds() if nxt else secs
            if secs is not None and secs < 0:
                secs = None
        runs = recent.get(j.get("id"), [])[:8]
        durs = []
        for row in runs:
            s, f = parse_ts(row[1]), parse_ts(row[2])
            if s and f:
                durs.append(round((f - s).total_seconds(), 1))
        deliveries = [row[3] for row in runs if len(row) > 3 and row[3]]
        last = parse_ts(j.get("last_run_at"))
        out.append(
            {
                "name": j.get("name"),
                "id": j.get("id"),
                "sched": (j.get("schedule") or {}).get("display") if isinstance(j.get("schedule"), dict) else None,
                "enabled": bool(j.get("enabled")),
                "no_agent": bool(j.get("no_agent")),
                "status": j.get("last_status"),
                "last_run": last.astimezone(IST).strftime("%d %b %H:%M") if last else None,
                "last_age_min": round(((now - last).total_seconds()) / 60) if last else None,
                "next_in_s": int(secs) if secs is not None else None,
                "failure_streak": j.get("failure_streak") or 0,
                "runs": [r[0] for r in runs],
                "deliveries": deliveries[:6],
                "avg_dur": round(sum(durs) / len(durs), 1) if durs else None,
                "max_dur": max(durs) if durs else None,
                "error": j.get("last_error"),
            }
        )
    out.sort(key=lambda r: (r["next_in_s"] if r["next_in_s"] is not None else 9e9))
    return out


def activity() -> list[dict]:
    """What the desk is actually churning on — newest touched artifacts."""
    rows = []
    for p in DESK.rglob("*"):
        if not p.is_file() or p.name.startswith("."):
            continue
        if any(part in {"__pycache__", "board", "tvdata", "hist"} for part in p.parts):
            continue
        if p.suffix not in {".py", ".json", ".md", ".txt", ".jsonl", ".sh"}:
            continue
        a = age_min(p)
        if a is None or a > 60 * 36:
            continue
        rows.append({"name": p.name, "age_min": round(a), "kb": round(p.stat().st_size / 1024, 1), "suffix": p.suffix})
    rows.sort(key=lambda r: r["age_min"])
    return rows[:14]


def outputs() -> list[dict]:
    return [
        {"title": "Latest post → Discord", "file": "post.txt", "body": read_text(DESK / "post.txt"), "age_min": age_min(DESK / "post.txt")},
        {"title": "Live card", "file": "live-card.txt", "body": read_text(DESK / "live-card.txt"), "age_min": age_min(DESK / "live-card.txt")},
        {"title": "Scanner note", "file": "scan-note.txt", "body": read_text(DESK / "scan-note.txt"), "age_min": age_min(DESK / "scan-note.txt")},
        {"title": "Playbook digest", "file": "digest.txt", "body": read_text(DESK / "digest.txt"), "age_min": age_min(DESK / "digest.txt")},
    ]


def doctrine() -> dict:
    txt = read_text(DESK / "CONSTITUTION.md", 60000)
    lines: list[str] = []
    keep = re.compile(r"(micro|risk|\$|limit|max|stop|\dR\b|prop|MFFU|killzone|one active|budget|never)", re.I)
    for raw in txt.splitlines():
        if not re.match(r"^[-*]\s", raw):  # real top-level bullets only
            continue
        s = re.sub(r"^[-*]\s*", "", raw).strip()
        if not (20 < len(s) < 190) or not keep.search(s):
            continue
        s = re.sub(r"\s*\|\s*#\d+.*$", "", s)          # drop citation tails
        s = re.sub(r"\*\*", "", s)
        if s and s not in lines:
            lines.append(s)
        if len(lines) >= 12:
            break
    return {"lines": lines, "size": len(txt), "age_min": age_min(DESK / "CONSTITUTION.md")}


def agent_pulse() -> dict:
    beat = HERMES / "cron" / "ticker_heartbeat"
    ok = HERMES / "cron" / "ticker_last_success"
    usage = HERMES / "cron" / "usage_audit.jsonl"
    today = datetime.now(IST).date().isoformat()
    runs = tokens = 0
    cost = 0.0
    last = None
    try:
        for line in usage.read_text().splitlines()[-4000:]:
            try:
                r = json.loads(line)
            except Exception:
                continue
            ts = str(r.get("ts") or r.get("timestamp") or r.get("time") or "")
            if ts.startswith(today):
                runs += 1
                tokens += int(r.get("total_tokens") or 0)
                cost += float(r.get("cost_usd") or 0)
                last = ts
    except Exception:
        pass
    return {
        "heartbeat_age_s": round(age_min(beat) * 60) if age_min(beat) is not None else None,
        "last_success_age_s": round(age_min(ok) * 60) if age_min(ok) is not None else None,
        "tokens_today": tokens,
        "cost_today": round(cost, 3),
        "runs_today": runs,
        "last_run": last,
    }


# ---------------------------------------------------------------- payload
def usd_per_pt(pb: list[dict]) -> dict:
    """Derive real $/point per instrument from the playbook's own risk math."""
    out = {}
    for inst in pb:
        for s in inst["setups"]:
            if s.get("risk_usd") and s.get("risk"):
                out[inst["key"]] = round(s["risk_usd"] / s["risk"])
                break
    return out


def _bands(levels: list[float], tick: float = 0.1, gap: float = 0.35) -> list[dict]:
    """Collapse a list of HVN/LVN price levels into contiguous bands."""
    if not levels:
        return []
    lv = sorted(float(x) for x in levels)
    out = [{"lo": lv[0], "hi": lv[0]}]
    for p in lv[1:]:
        if p - out[-1]["hi"] <= gap:
            out[-1]["hi"] = p
        else:
            out.append({"lo": p, "hi": p})
    for b in out:
        b["lo"] = round(b["lo"], 2)
        b["hi"] = round(b["hi"], 2)
        b["mid"] = round((b["lo"] + b["hi"]) / 2, 2)
    out.sort(key=lambda b: (b["hi"] - b["lo"]), reverse=True)
    return out


def structure() -> list[dict]:
    """HTF→LTF structure, volume profile, zones, sessions — straight from report-*.json."""
    out = []
    for key in ("mgc", "nq"):
        r = read_json(DESK / f"report-{key}.json", {}) or {}
        if not r:
            continue
        spot = r.get("price")
        zones = []
        for tf in ("240", "60", "30", "15", "5", "3"):
            for z in r.get(f"fvg_{tf}") or []:
                zones.append({"tf": tf, "kind": "FVG", "dir": z.get("dir"), "top": z.get("top"),
                              "bot": z.get("bot"), "age": z.get("age"), "state": z.get("state")})
            for z in r.get(f"ob_{tf}") or []:
                zones.append({"tf": tf, "kind": "OB", "dir": z.get("dir"), "top": z.get("top"),
                              "bot": z.get("bot"), "age": z.get("age"),
                              "state": "mitigated" if z.get("mitigated") else "open"})
        tfs = []
        for tf, v in (r.get("tfs") or {}).items():
            ev = [e for e in (v.get("events") or [])]
            atr = v.get("atr") or 0
            lh, ll = v.get("lastH") or [None, None], v.get("lastL") or [None, None]
            tfs.append({
                "tf": tf, "trend": v.get("trend"), "last": v.get("last"), "atr": round(atr, 2),
                "dist_atr": round(abs(spot - v.get("last", spot)) / atr, 1) if atr and spot else None,
                "event": ev[-1][1] if ev else None,
                "event_age": (ev[-1][0] if ev else None),
                "swingH": lh[1], "swingL": ll[1],
                "ci": v.get("ci") if isinstance(v.get("ci"), dict) else None,
                "ci_hi": v.get("ci_hi"), "ci_lo": v.get("ci_lo"),
                "events": [{"kind": e[1], "price": e[2]} for e in ev[-5:]],
            })
        vp = {}
        for name in ("vp_current", "vp_prior", "vp_composite"):
            v = r.get(name) or {}
            if not v:
                continue
            vp[name] = {
                "poc": v.get("poc"), "vah": v.get("vah"), "val": v.get("val"),
                "hi": v.get("hi"), "lo": v.get("lo"), "total": v.get("total"),
                "hvn": _bands(v.get("hvn") or [])[:5], "lvn": _bands(v.get("lvn") or [])[:5],
            }
        sessions = []
        for day in (r.get("session_order") or []):
            s = (r.get("sessions") or {}).get(day) or {}
            sessions.append({"day": day, **{k: s.get(k) for k in
                            ("open", "high", "low", "close", "rth_high", "rth_low", "on_high", "on_low", "ib_high", "ib_low")}})
        out.append({
            "key": key, "name": (r.get("spec") or {}).get("name") or key.upper(),
            "spot": spot, "spec": r.get("spec"), "tfs": tfs, "vp": vp,
            "tpo": r.get("tpo_current") or {}, "vwap": r.get("vwap_session") or {},
            "vwap_prior": r.get("vwap_prior") or {},
            "open_type": r.get("open_type") or {},
            "clusters": (r.get("clusters") or [])[:12],
            "zones": zones, "sessions": sessions,
            "zones_age_min": age_min(DESK / f"report-{key}.json"),
            "marks": read_json(DESK / f"plotted-{key}.json", {}) or {},
        })
    return out


def edge() -> dict:
    """Backtest lab: 61-trade study from trades-v4.json."""
    trades = read_json(DESK / "trades-v4.json", []) or []
    if not trades:
        return {"n": 0}
    trades = sorted(trades, key=lambda t: str(t.get("when")))
    rs = [t["r"] for t in trades if t.get("r") is not None]
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]

    def stats(rows):
        r = [x["r"] for x in rows if x.get("r") is not None]
        if not r:
            return None
        w = [x for x in r if x > 0]
        return {"n": len(r), "win": round(100 * len(w) / len(r)), "sum": round(sum(r), 2),
                "avg": round(sum(r) / len(r), 3), "best": round(max(r), 2), "worst": round(min(r), 2)}

    def group(field):
        keys = sorted({str(t.get(field)) for t in trades})
        return [{"k": k, **stats([t for t in trades if str(t.get(field)) == k])} for k in keys]

    cum, curve, peak, dd = 0.0, [], 0.0, 0.0
    for t in trades:
        cum += t.get("r") or 0
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
        curve.append({"when": t.get("when"), "cum": round(cum, 2), "r": t.get("r"),
                      "key": t.get("key"), "kind": t.get("kind"), "grade": t.get("grade"),
                      "dd": round(cum - peak, 2)})

    buckets = {}
    for r in rs:
        b = min(3, max(-1, int(r // 0.5) * 0.5))
        buckets[round(b, 1)] = buckets.get(round(b, 1), 0) + 1

    hours = {}
    for t in trades:
        w = str(t.get("when") or "")
        if len(w) >= 13 and w[11:13].isdigit():
            hours.setdefault(int(w[11:13]), []).append(t.get("r") or 0)

    return {
        "n": len(trades),
        "range": [trades[0].get("when"), trades[-1].get("when")],
        "sum_r": round(sum(rs), 2), "win_rate": round(100 * len(wins) / len(rs)),
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0,
        "pf": round(abs(sum(wins) / sum(losses)), 2) if losses and sum(losses) else None,
        "max_dd": round(dd, 2),
        "curve": curve,
        "hist": [{"b": b, "n": n} for b, n in sorted(buckets.items())],
        "by_kind": group("kind"), "by_grade": group("grade"), "by_key": group("key"), "by_bias": group("bias"),
        "hours": [{"h": h, "n": len(v), "sum": round(sum(v), 2), "avg": round(sum(v) / len(v), 2)}
                  for h, v in sorted(hours.items())],
        "scatter": [{"mae": t.get("mae"), "mfe": t.get("mfe"), "r": t.get("r"), "key": t.get("key"),
                     "kind": t.get("kind"), "grade": t.get("grade"), "when": t.get("when")} for t in trades],
        "table": [{"when": t.get("when"), "key": t.get("key"), "kind": t.get("kind"), "grade": t.get("grade"),
                   "bias": t.get("bias"), "r": t.get("r"), "mfe": t.get("mfe"), "mae": t.get("mae"),
                   "risk_pts": t.get("risk_pts"), "entry": t.get("entry")} for t in trades[::-1]],
        "age_min": age_min(DESK / "trades-v4.json"),
    }


def econ() -> list[dict]:
    """Upcoming high/medium-impact releases, times in IST (logic stays ET)."""
    files = sorted(DESK.glob("events-*.json"))
    if not files:
        return []
    data = read_json(files[-1], {}) or {}
    base = parse_ts(data.get("fetched_at"))
    if not base:
        return []
    base_et = base.astimezone(ET).replace(hour=0, minute=0, second=0, microsecond=0)
    now = datetime.now(ET)
    out = []
    for e in data.get("events") or []:
        m = e.get("min")
        if m is None:
            continue
        when_et = base_et + timedelta(minutes=int(m))
        if when_et < now - timedelta(minutes=15):
            continue
        out.append({
            "title": e.get("title"), "cur": e.get("cur"), "impact": e.get("impact"),
            "forecast": e.get("forecast"), "previous": e.get("previous"),
            "ist": when_et.astimezone(IST).strftime("%d %b %H:%M"),
            "et": when_et.astimezone(ET).strftime("%H:%M"),
            "in_min": round((when_et - now).total_seconds() / 60),
        })
    out.sort(key=lambda r: r["in_min"])
    return out[:9]


def tape() -> list[dict]:
    """Real one-liners for the ticker strip."""
    items = []
    for inst in playbook():
        top = (inst.get("setups") or [{}])[0]
        if top.get("grade"):
            items.append({"t": f"{inst['name']} {inst['bias'].upper()} {top['grade']} · POI "
                               f"{top['zone'][0]}-{top['zone'][1]} · entry {top['entry']}", "k": "red"})
    for e in econ()[:4]:
        items.append({"t": f"{e['title']} ({e['cur']}) {e['ist']} IST · in {e['in_min']}m", "k": "cy"})
    for c in crons()[:3]:
        if c.get("next_in_s") is not None:
            items.append({"t": f"{c['name']} in {c['next_in_s'] // 60}m", "k": "up"})
    post = read_text(DESK / "post.txt", 300).strip().splitlines()
    if post:
        head = re.sub(r"[*`]", "", post[0])[:90]
        items.append({"t": f"last post · {head}", "k": "red"})
    return items


def build_state() -> dict:
    now_ist = datetime.now(IST)
    now_et = datetime.now(ET)
    pb = playbook()
    c = calls()
    p = paper()
    cr = crons()
    return {
        "generated_at": now_ist.strftime("%Y-%m-%d %H:%M:%S"),
        "ist": now_ist.strftime("%H:%M:%S"),
        "et": now_et.strftime("%H:%M:%S"),
        "ist_date": now_ist.strftime("%a %d %b %Y"),
        "et_date": now_et.strftime("%a %d %b"),
        "session": session_state(now_et),
        "playbook": pb,
        "usd_per_pt": usd_per_pt(pb),
        "calls": c,
        "paper": p,
        "lessons": lessons(),
        "crons": cr,
        "activity": activity(),
        "outputs": outputs(),
        "doctrine": doctrine(),
        "pulse": agent_pulse(),
        "econ": econ(),
        "tape": tape(),
        "files": {
            "playbook.json": age_min(DESK / "playbook.json"),
            "jobs.json": age_min(DESK / "jobs.json"),
            "journal.jsonl": age_min(DESK / "journal.jsonl"),
            "beta-results.jsonl": age_min(DESK / "beta-results.jsonl"),
        },
    }


PIPELINE = [
    {"id": "scan", "name": "SCAN", "job": "sniper-scan", "desc": "5-min FVG/OB sweep, no LLM"},
    {"id": "wire", "name": "WIRE", "job": "desk-market-wire", "desc": "news ranked by market impact"},
    {"id": "build", "name": "BUILD", "job": "trade-playbook-build", "desc": "zones → grades → playbook"},
    {"id": "arm", "name": "ARM", "job": "trade-playbook-watch", "desc": "watch POIs, fire on the tap"},
    {"id": "post", "name": "POST", "job": None, "desc": "call → Discord + chart marks"},
    {"id": "journal", "name": "JOURNAL", "job": None, "desc": "resolve entry / TP / SL outcomes"},
    {"id": "learn", "name": "LEARN", "job": "beta-learnings", "desc": "lessons from resolved trades"},
]


def runs_feed(limit: int = 40) -> list[dict]:
    """Newest desk job outputs (one .md per run) — the live work log."""
    raw = read_json(HERMES / "cron" / "jobs.json", {})
    jobs = raw if isinstance(raw, list) else raw.get("jobs", [])
    names = {j.get("id"): j.get("name") for j in jobs}
    out = []
    root = HERMES / "cron" / "output"
    try:
        for f in root.glob("*/*.md"):
            try:
                st = f.stat()
            except Exception:
                continue
            out.append((st.st_mtime, f, st.st_size))
    except Exception:
        return []
    out.sort(reverse=True)
    rows = []
    for mtime, f, size in out[:limit]:
        body = read_text(f, 900)
        first = next((l.strip() for l in body.splitlines() if l.strip()), "")
        rows.append({
            "job": names.get(f.parent.name, f.parent.name),
            "ts": datetime.fromtimestamp(mtime, IST).strftime("%d %b %H:%M:%S"),
            "age_s": int(time.time() - mtime),
            "kb": round(size / 1024, 1),
            "head": re.sub(r"[#*`>]", "", first)[:150],
            "body": body[:600],
        })
    return rows


def heatmap(hours: int = 24) -> dict:
    """Job × hour run-status heat (borrowed from agent-observability dashboards)."""
    db = HERMES / "cron" / "executions.db"
    rows = None
    for connect in (lambda: sqlite3.connect(db, timeout=4),
                    lambda: sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=4)):
        try:
            con = connect()
            try:
                rows = list(con.execute(
                    "select job_id, started_at, status from executions "
                    "where scheduled_instant > datetime('now', ?) order by scheduled_instant desc",
                    (f"-{hours} hours",)))
            finally:
                con.close()
            break
        except Exception:
            continue
    raw = read_json(HERMES / "cron" / "jobs.json", {})
    jobs = raw if isinstance(raw, list) else raw.get("jobs", [])
    names = {j.get("id"): j.get("name") for j in jobs}
    now = datetime.now(IST)
    grid: dict[str, dict[int, str]] = {}
    for jid, started, status in rows or []:
        ts = parse_ts(started)
        if ts is None:
            continue
        ts = ts.astimezone(IST)
        age_h = int((now - ts).total_seconds() // 3600)
        if 0 <= age_h < hours:
            grid.setdefault(names.get(jid, jid), {})[age_h] = status
    return {"hours": hours, "grid": grid,
            "order": [n for n in (names.get(j.get("id")) for j in jobs) if n]}


def series(key: str = "mgc", tf: str = "5", n: int = 180) -> dict:
    d = read_json(DESK / f"hist/{key}-{tf}.json", {}) or {}
    bars = d.get("bars") or []
    return {"key": key, "tf": tf, "total": len(bars),
            "bars": [[b.get("time"), b.get("open"), b.get("high"), b.get("low"),
                      b.get("close"), b.get("volume")] for b in bars[-n:]]}


def flow() -> dict:
    cr = {c["name"]: c for c in crons()}
    steps = []
    for s in PIPELINE:
        c = cr.get(s.get("job")) if s.get("job") else None
        c = c or {}
        steps.append({
            "id": s["id"], "name": s["name"], "desc": s["desc"], "job": s.get("job"),
            "status": c.get("status") or ("auto" if s.get("job") is None else None),
            "next_in_s": c.get("next_in_s"), "last_run": c.get("last_run"),
            "avg_dur": c.get("avg_dur"), "max_dur": c.get("max_dur"),
            "runs": (c.get("runs") or [])[:6], "failure_streak": c.get("failure_streak", 0),
        })
    return {"steps": steps, "agents": crons(), "feed": runs_feed(30),
            "heat": heatmap(24), "econ": econ()}


def case() -> dict:
    """Investigation view: today's live case as an evidence file."""
    pb = playbook()
    if not pb:
        return {"ok": False}
    st = {i["key"]: i for i in structure()}
    cands = []
    for inst in pb:
        for s in inst["setups"]:
            cands.append((s.get("score", 0), inst, s))
    if not cands:
        return {"ok": False}
    _, inst, s = max(cands, key=lambda c: c[0])
    info = st.get(inst["key"], {})
    bias = (s.get("bias") or "").lower()
    up = bias.startswith("l")

    # --- HTF alignment (D / 4H / 1H vs bias)
    htf = [t for t in info.get("tfs", []) if t["tf"] in ("D", "240", "60")]
    aligned = [t for t in htf if (t["trend"] == ("up" if up else "down"))]
    ltf = [t for t in info.get("tfs", []) if t["tf"] in ("15", "5", "3")]
    ltf_aligned = [t for t in ltf if (t["trend"] == ("up" if up else "down"))]

    # --- volume context
    vp = (info.get("vp") or {}).get("vp_current") or {}
    zone = s.get("zone") or [None, None]
    zmid = None
    if zone[0] is not None and zone[1] is not None:
        zmid = (zone[0] + zone[1]) / 2
    vp_note = None
    if vp.get("vah") is not None and zmid is not None:
        if zmid > vp["vah"]:
            vp_note = f"POI sits above VAH {vp['vah']:.1f} (premium) — sellers defend value edges"
        elif zmid < vp["val"]:
            vp_note = f"POI sits below VAL {vp['val']:.1f} (discount) — buyers defend value edges"
        else:
            vp_note = f"POI is inside value ({vp['val']:.1f}–{vp['vah']:.1f}) — expect chop, demand a clean tap"

    # --- confluence at the zone
    conf = []
    for c in info.get("clusters") or []:
        if zmid is None or abs(c["avg"] - zmid) <= max(6.0, abs(zone[1] - zone[0]) * 3):
            conf.append({"price": c["avg"], "score": c["score"], "sources": c.get("sources") or []})

    evidence = [
        {"k": "HTF alignment", "v": f"{len(aligned)}/{len(htf)} higher TFs agree",
         "conf": round(100 * len(aligned) / max(1, len(htf))),
         "src": ", ".join(f"{t['tf']}:{t['trend']}" for t in htf)},
        {"k": "LTF confirmation", "v": f"{len(ltf_aligned)}/{len(ltf)} entry TFs agree",
         "conf": round(100 * len(ltf_aligned) / max(1, len(ltf))),
         "src": ", ".join(f"{t['tf']}:{t['trend']}" for t in ltf)},
        {"k": "Confluence stack", "v": f"{len(conf)} levels within reach of the POI",
         "conf": min(100, 30 * len(conf)),
         "src": "; ".join(f"{c['price']:.1f} ({', '.join(c['sources'])})" for c in conf[:4]) or "none"},
        {"k": "Volume context", "v": vp_note or "no live profile", "conf": 65 if vp_note else 20,
         "src": f"POC {vp.get('poc')} · VAH {vp.get('vah')} · VAL {vp.get('val')}"},
        {"k": "Reachability", "v": f"{s.get('dist')}pt away ({s.get('dist_atr')}×ATR)",
         "conf": 90 if (s.get("dist_atr") or 9) < 2.5 else 35,
         "src": "limit order at the POI — no chasing"},
        {"k": "Reward geometry", "v": f"TP1 {s.get('t1r')}R · TP2 {s.get('t2r')}R",
         "conf": min(100, round((s.get("t2r") or 0) * 22)),
         "src": f"{len(s.get('tps') or [])} targets mapped"},
    ]

    live = s.get("zone") and (s.get("dist_atr") or 99) < 2.5 and "OUT OF RANGE" not in " ".join(s.get("why") or [])

    story = []
    for r in (calls().get("rows") or []):
        story.append({"t": r.get("outcome_when") or "today", "k": "call", "title": f"{r['job']} · {r['key'].upper()} {str(r['bias']).upper()} {r['grade']}",
                      "detail": f"entry {r['entry']} stop {r['stop']} · {r['outcome']}",
                      "state": r.get("outcome"), "note": r.get("outcome_note")})
    for e in econ()[:3]:
        story.append({"t": e["ist"], "k": "event", "title": f"{e['title']} ({e['cur']})",
                      "detail": f"{e['impact']} impact · {e['et']} ET · in {e['in_min']}m", "state": "event"})

    inval = [{"label": "stop", "price": s.get("stop"), "note": "hard invalidation"},
             {"label": "zone edge", "price": max(zone) if None not in zone else None, "note": "close beyond the POI = stand down"},
             {"label": "entry", "price": s.get("entry"), "note": "limit, no market chase"}]
    for lv in (info.get("sessions") or [])[-1:]:
        if lv.get("ib_low"):
            inval.append({"label": "IB low", "price": lv["ib_low"], "note": "session structure"})

    return {"ok": True, "case_id": f"{inst['key'].upper()}-{calls().get('day') or 'live'}",
            "inst": inst["name"], "key": inst["key"], "spot": inst.get("spot"),
            "bias": s.get("bias"), "kind": s.get("kind"), "grade": s.get("grade"),
            "score": s.get("score"), "vote": s.get("vote"), "conf_n": s.get("conf"),
            "zone": s.get("zone"), "entry": s.get("entry"), "stop": s.get("stop"),
            "risk": s.get("risk"), "risk_usd": s.get("risk_usd"),
            "tps": s.get("tps") or [], "t1r": s.get("t1r"), "t2r": s.get("t2r"),
            "why": s.get("why") or [], "evidence": evidence, "confluence": conf,
            "invalidation": inval, "story": story, "live": bool(live),
            "verdict": ("ACTIONABLE — armed at the POI" if live else "WATCH — not actionable at this distance"),
            "open_poi": [z for z in (info.get("zones") or []) if z.get("state") == "open"][:10],
            "age_min": age_min(DESK / "playbook.json")}


TOPICS = {
    "state": ("playbook.json", "jobs.json", "journal.jsonl", "beta-results.jsonl", "post.txt",
              "live-card.txt", "scan-note.txt", "digest.txt", "watch-state.json", "lessons.md"),
    "structure": ("report-mgc.json", "report-nq.json", "plotted-mgc.json", "plotted-nq.json"),
    "edge": ("trades-v4.json",),
    "flow": ("events-2026-09-29.json",),
    "ops": ("jobs.json", "executions.db", "ticker_heartbeat", "usage_audit.jsonl"),
}


def topic_hashes() -> dict:
    """Cheap mtime+size fingerprint per topic — drives the SSE push stream."""
    out = {}
    for topic, names in TOPICS.items():
        h = hashlib.md5()
        for name in names:
            for base in (DESK, HERMES / "cron"):
                p = base / name
                try:
                    st = p.stat()
                    h.update(f"{p.name}:{int(st.st_mtime)}:{st.st_size}|".encode())
                    break
                except Exception:
                    continue
            else:
                h.update(f"{name}:-|".encode())
        out[topic] = h.hexdigest()[:12]
    return out


def snapshot_html() -> str:
    """Single self-contained HTML file: CSS + JS + the current data inlined (no server needed)."""
    html = (BOARD / "index.html").read_text()
    css = (BOARD / "styles.css").read_text()
    js = (BOARD / "app.js").read_text()
    data = {
        "/api/state": build_state(),
        "/api/structure": structure(),
        "/api/edge": edge(),
        "/api/flow": flow(),
        "/api/case": case(),
        "/api/series?key=mgc&tf=5&n=180": series("mgc", "5", 180),
        "/api/series?key=nq&tf=5&n=180": series("nq", "5", 180),
    }
    inline = (
        f"<style>\n{css}\n</style>\n"
        f"<script>window.__SNAP = {json.dumps(data, default=str)};</script>\n"
        f"<script>\n{js}\n</script>\n"
    )
    html = html.replace('<link rel="stylesheet" href="/styles.css" />', "")
    html = html.replace('<script src="/app.js"></script>', inline)
    stamp = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
    html = html.replace("Evergreen Investigation Console · The Daily Bias",
                        f"Evergreen Console · snapshot {stamp}")
    html = html.replace("The Daily Bias · Investigation Console", f"The Daily Bias · snapshot {stamp}")
    # snapshots are point-in-time: the freshness chip is written by header() at render time
    html = html.replace('<span class="chip" id="fresh"><span class="dot grey"></span><span>boot</span></span>',
                        f'<span class="chip" id="fresh"><span class="dot amber"></span><span>snapshot {stamp}</span></span>')
    return html


STATIC = {
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/preview.png": ("preview.png", "image/png"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "DeskBoard/2.0"

    def log_message(self, fmt, *args):
        if os.environ.get("BOARD_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, body: bytes, ctype: str, code: int = 200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _stream(self):
        """Server-sent events: push the topics whose backing files changed.

        The client refetches only what moved, so the board updates on the desk's
        own rhythm (a scan landing, a fill, a journal resolution) instead of a
        fixed poll interval.
        """
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
        except Exception:
            return
        last: dict = {}
        idle = 0
        try:
            while True:
                cur = topic_hashes()
                changed = [t for t, h in cur.items() if last.get(t) != h]
                if changed or not last:
                    payload = json.dumps({"topics": changed or list(cur), "at": datetime.now(IST).strftime("%H:%M:%S")})
                    self.wfile.write(f"event: update\ndata: {payload}\n\n".encode())
                    self.wfile.flush()
                    idle = 0
                else:
                    idle += 1
                    if idle % 7 == 0:                      # ~14s keepalive comment
                        self.wfile.write(f": ping {int(time.time())}\n\n".encode())
                        self.wfile.flush()
                last = cur
                time.sleep(2)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            f = BOARD / "index.html"
            self._send(f.read_bytes() if f.exists() else b"missing index.html",
                       "text/html; charset=utf-8", 200 if f.exists() else 500)
            return
        if path in STATIC:
            name, ctype = STATIC[path]
            f = BOARD / name
            self._send(f.read_bytes() if f.exists() else b"404", ctype, 200 if f.exists() else 404)
            return
        if path == "/health":
            self._send(b'{"status":"ok"}', "application/json")
            return
        if path == "/snapshot.html":
            try:
                self._send(cached("snapshot", snapshot_html).encode(), "text/html; charset=utf-8")
            except Exception as e:
                self._send(f"snapshot error: {e}".encode(), "text/plain", 200)
            return
        if path == "/api/stream":
            self._stream()
            return
        routes = {
            "/api/state": ("state", build_state),
            "/api/structure": ("structure", structure),
            "/api/edge": ("edge", edge),
            "/api/flow": ("flow", flow),
            "/api/case": ("case", case),
        }
        if path == "/api/series":
            q = dict(p.split("=", 1) for p in (self.path.split("?", 1)[1].split("&") if "?" in self.path else []) if "=" in p)
            key = re.sub(r"[^a-z0-9]", "", (q.get("key") or "mgc").lower())[:6] or "mgc"
            tf = re.sub(r"[^0-9]", "", q.get("tf") or "5")[:3] or "5"
            n = max(20, min(600, int(re.sub(r"\D", "", q.get("n") or "180") or 180)))
            try:
                self._send(json.dumps(cached(f"series-{key}-{tf}-{n}", lambda: series(key, tf, n)), default=str).encode(),
                           "application/json")
            except Exception as e:
                self._send(json.dumps({"error": str(e)}).encode(), "application/json", 200)
            return
        if path in routes:
            key, fn = routes[path]
            try:
                payload = cached(key, fn)
                self._send(json.dumps(payload, default=str).encode(), "application/json")
            except Exception as e:  # never 500 the board
                self._send(json.dumps({"error": str(e)}).encode(), "application/json", 200)
            return
        self._send(b"404", "text/plain", 404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"desk board -> http://{a.host}:{a.port}  (desk={DESK})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
