#!/usr/bin/env python3
"""Generate a SYNTHETIC demo desk so the console can be run with no real data.

    python3 demo/make-demo.py            # writes demo/*.json
    DESK_DIR="$(pwd)/demo" python3 server.py --port 8901

Everything written here is invented sample data (a toy book of gold/nasdaq
setups) — it is NOT market data and must not be presented as such.
"""
import json
import math
import random
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent
random.seed(7)
NOW = int(time.time())


def zones(spot, n=6):
    out = []
    for i in range(n):
        side = "bear" if i % 2 == 0 else "bull"
        mid = spot + (18 + i * 11) * (1 if side == "bear" else -1)
        top, bot = mid + 3.4, mid
        out.append({"dir": side, "top": round(top, 2), "bot": round(bot, 2), "i": 250 + i,
                    "age": 6 + i * 3, "state": "open" if i % 3 else "filled"})
    return out


def report(key, name, spot, tick, atr_d, hvn):
    tfs = {}
    for tf, mult, trend in (("D", 1.0, "down"), ("240", .42, "down"), ("60", .2, "up"),
                            ("30", .14, "down"), ("15", .1, "up"), ("5", .05, "up"),
                            ("3", .03, "up"), ("1", .016, "down")):
        atr = round(atr_d * mult, 2)
        tfs[tf] = {"n": 300, "trend": trend, "last": round(spot, 2), "atr": atr,
                   "lastH": [290, round(spot + atr * 1.4, 2)], "lastL": [293, round(spot - atr * 1.5, 2)],
                   "events": [[288, "BOS_down", round(spot + atr * 2, 2)], [292, "CHoCH_up", round(spot, 2)],
                              [296, "BOS_up" if trend == "up" else "BOS_down", round(spot, 2)]]}
    vp = {"poc": round(spot, 2), "vah": round(spot + tick * 20, 2), "val": round(spot - tick * 20, 2),
          "hi": round(spot + tick * 60, 2), "lo": round(spot - tick * 60, 2), "total": 9000.0,
          "hvn": hvn, "lvn": [round(spot + tick * 40, 2), round(spot + tick * 41, 2)]}
    clusters = [{"avg": round(spot - tick * 90, 2), "hi": round(spot - tick * 88, 2), "lo": round(spot - tick * 92, 2),
                 "items": [[round(spot - tick * 90, 2), "4H swingL"]], "sources": ["4H swingL", "prior low"], "score": 2},
                {"avg": round(spot + tick * 30, 2), "hi": round(spot + tick * 32, 2), "lo": round(spot + tick * 28, 2),
                 "items": [[round(spot + tick * 30, 2), "1H-FVG-B"]], "sources": ["1H-FVG-B"], "score": 1}]
    return {
        "key": key, "spec": {"name": name, "tick": tick, "rth": [8, 20], "rth_end": [13, 30],
                             "rth_str": "08:20-13:30 ET"}, "price": round(spot, 2),
        "tfs": tfs, "sessions": {"2026-09-29": {"n": 23, "high": round(spot + 8, 2), "low": round(spot - 12, 2),
                                                "open": round(spot - 4, 2), "close": round(spot - 1, 2),
                                                "rth_high": round(spot + 6, 2), "rth_low": round(spot - 9, 2),
                                                "on_high": round(spot + 7, 2), "on_low": round(spot - 10, 2),
                                                "ib_high": round(spot + 5, 2), "ib_low": round(spot - 6, 2)}},
        "session_order": ["2026-09-29"],
        "vp_current": vp, "vp_prior": dict(vp, poc=round(spot - 12, 2)), "vp_composite": dict(vp, poc=round(spot + 40, 2)),
        "tpo_current": {"poc": round(spot, 2), "vah": round(spot + 4, 2), "val": round(spot - 4, 2), "singles": []},
        "vwap_session": {"vwap": round(spot - 1, 2), "s1u": round(spot + 3, 2), "s1d": round(spot - 5, 2),
                         "s2u": round(spot + 7, 2), "s2d": round(spot - 9, 2)},
        "vwap_prior": {"vwap": round(spot - 14, 2), "s1u": round(spot - 9, 2), "s1d": round(spot - 19, 2),
                       "s2u": round(spot - 4, 2), "s2d": round(spot - 24, 2)},
        "fvg_60": zones(spot)[:2], "fvg_15": zones(spot)[1:3], "fvg_5": zones(spot)[:3],
        "ob_60": zones(spot)[2:3], "ob_15": [], "ob_5": zones(spot)[3:4],
        "open_type": {"sess_open": round(spot - 2, 2), "ib_high": None, "ib_low": None, "ib_range": None,
                      "extended_up": False, "extended_down": False},
        "clusters": clusters,
    }


def bars(key, spot, tick, n=180):
    out, price = [], spot - tick * 25
    for i in range(n):
        price += math.sin(i / 9) * tick * 4 + (random.random() - .48) * tick * 6
        o = price
        c = price + (random.random() - .5) * tick * 5
        hi, lo = max(o, c) + random.random() * tick * 3, min(o, c) - random.random() * tick * 3
        out.append({"time": NOW - (n - i) * 300, "open": round(o, 2), "high": round(hi, 2),
                    "low": round(lo, 2), "close": round(c, 2), "volume": random.randint(120, 900)})
        price = c
    return {"key": key, "tf": "5", "bars": out}


# ---------------------------------------------------------------- files
mgc_spot, nq_spot = 4216.4, 30714.0
(OUT / "playbook.json").write_text(json.dumps({
    "mgc": {"spot": mgc_spot, "bias": "short", "vol": [1.1, "normal"], "setups": [
        {"key": "mgc", "name": "MGC", "bias": "short", "kind": "FVG", "zone": [mgc_spot + 20, mgc_spot + 23],
         "entry": mgc_spot + 20, "stop": mgc_spot + 37, "risk": 17.0, "risk_usd": 170, "spot": mgc_spot, "du": 1.2,
         "conf": 2, "vote": 5, "vote_detail": ["reachable +1", "VA edge +1", "premium/disc +1"],
         "tps": [{"price": mgc_spot + 5, "conf": 2, "sources": ["prior close"]},
                 {"price": mgc_spot - 35, "conf": 3, "sources": ["15m-FVG-B", "1H-OB-B"]}],
         "score": 9, "raw": 11, "penalty": 2, "grade": "B+",
         "why": ["HTF 2/3", "conf 2", "VA edge", "17.4pt (1.3xATR) away", "TP2 3.2R", "3 targets", "thin session"],
         "t1r": 1.2, "t2r": 3.2},
        {"key": "mgc", "name": "MGC", "bias": "short", "kind": "OB", "zone": [mgc_spot + 70, mgc_spot + 80],
         "entry": mgc_spot + 70, "stop": mgc_spot + 88, "risk": 18.0, "risk_usd": 180, "spot": mgc_spot, "du": 5.4,
         "conf": 2, "vote": 4, "vote_detail": ["OB +1"], "tps": [{"price": mgc_spot, "conf": 2, "sources": ["session high"]}],
         "score": 6, "raw": 7, "penalty": 1, "grade": "C",
         "why": ["HTF 2/3", "mid-range", "73pt (5.5xATR) away", "OUT OF RANGE - not actionable now"], "t1r": 4.1, "t2r": 6.4}]},
    "nq": {"spot": nq_spot, "bias": "long", "vol": [0.9, "normal"], "setups": [
        {"key": "nq", "name": "NQ", "bias": "long", "kind": "FVG", "zone": [nq_spot - 180, nq_spot - 120],
         "entry": nq_spot - 120, "stop": nq_spot - 165, "risk": 45.0, "risk_usd": 90, "spot": nq_spot, "du": 6.1,
         "conf": 4, "vote": 5, "vote_detail": ["VA edge +1", "discount +1"],
         "tps": [{"price": nq_spot - 60, "conf": 2, "sources": ["15m-FVG-B"]}, {"price": nq_spot + 40, "conf": 3, "sources": ["1H-FVG-B"]}],
         "score": 8, "raw": 9, "penalty": 1, "grade": "B+",
         "why": ["HTF 2/3", "conf 4", "VA edge", "104pt (6.1xATR) away", "TP2 3.8R", "OUT OF RANGE - not actionable now"],
         "t1r": 2.5, "t2r": 3.8}]}}, indent=1))
(OUT / "report-mgc.json").write_text(json.dumps(report("mgc", "MGC (Micro Gold)", mgc_spot, 0.1, 87.8, [4198.6, 4198.9, 4190.8]), indent=1))
(OUT / "report-nq.json").write_text(json.dumps(report("nq", "NQ (E-mini Nasdaq)", nq_spot, 1.0, 440.2, [30560.0, 30561.5]), indent=1))
(OUT / "plot-mgc.json").write_text("{}")

jobs = []
for i, (k, g, bias, side) in enumerate([("mgc", "A", "short", 1), ("mgc", "B+", "short", 1),
                                        ("mgc", "C", "short", 1), ("nq", "C", "long", -1), ("nq", "A", "long", -1)], 1):
    spot = mgc_spot if k == "mgc" else nq_spot
    entry = spot + side * (12 if k == "mgc" else 60)
    jobs.append({"job": f"{k.upper()}-0929-0{i}", "key": k, "day": "2026-09-29", "grade": g, "score": 11 - i,
                 "bias": bias, "zone": [entry, entry + side * 8], "entry": entry,
                 "stop": entry + side * (11 if k == "mgc" else 40), "risk": 11 if k == "mgc" else 40,
                 "tps": [round(entry - side * 12, 2), round(entry - side * 40, 2)], "why": ["HTF 2/3", "VA edge"],
                 "alerted": True, "penalty": 0})
(OUT / "jobs.json").write_text(json.dumps({"jobs": jobs}, indent=1))
(OUT / "journal.jsonl").write_text("\n".join(json.dumps(r) for r in [
    {"job": "MGC-0929-01", "key": "mgc", "entry": jobs[0]["entry"], "stop": jobs[0]["stop"], "outcome": "win",
     "note": "auto: TP1 then BE", "when": "09-29 14:10", "grade": "A", "score": 11, "why": ["HTF 2/3"]},
    {"job": "NQ-0929-04", "key": "nq", "entry": jobs[3]["entry"], "stop": jobs[3]["stop"], "outcome": "missed",
     "note": "demoted to idea - never filled", "when": "09-29 16:40", "grade": "C", "score": 7, "why": ["mid-range"]}]) + "\n")
(OUT / "beta-results.jsonl").write_text("\n".join(json.dumps(r) for r in [
    {"rec_id": "D1", "event": "trailed", "final": True, "key": "mgc", "bias": "short", "kind": "FVG",
     "grade": "A", "zone": [mgc_spot + 20, mgc_spot + 23], "entry": mgc_spot + 20, "stop": mgc_spot + 25,
     "tp1": mgc_spot + 15, "tp2": mgc_spot + 10, "risk": 5.5, "r": 1.02, "session": "ny", "hour_et": 10},
    {"rec_id": "D2", "event": "stopped", "final": True, "key": "nq", "bias": "long", "kind": "OB",
     "grade": "B+", "zone": [nq_spot - 180, nq_spot - 120], "entry": nq_spot - 120, "stop": nq_spot - 165,
     "tp1": nq_spot - 60, "tp2": nq_spot + 40, "risk": 45, "r": -1.0, "session": "asia", "hour_et": 22}]) + "\n")
(OUT / "trades-v4.json").write_text(json.dumps([
    {"key": "mgc" if i % 2 else "nq", "kind": ["FVG", "OB", "BB"][i % 3], "grade": ["A", "A+", "B+"][i % 3],
     "bias": "long" if i % 2 else "short", "when": f"2026-08-{6 + i:02d} 1{i % 9}:00",
     "r": round(random.choice([1.4, 1.0, 0.6, -1.0, -1.0, 2.1]), 2), "mfe": round(random.uniform(.3, 2.6), 2),
     "mae": round(random.uniform(.1, 1.3), 2), "risk_pts": round(random.uniform(12, 140), 2),
     "entry": round(random.uniform(4100, 4300), 2), "zone": [4100, 4120], "conf": 4} for i in range(12)], indent=1))
(OUT / "CONSTITUTION.md").write_text("# Desk constitution (demo)\n\n- Risk stated in both points and $/contract every time.\n"
                                     "- Never force a trade. No qualifying setup → plot the idea with its condition.\n"
                                     "- Draw → verify → notify. The chart carries the full plan before any alert leaves.\n")
(OUT / "lessons.md").write_text("# Beta trade lessons (demo)\n\n## D1 · 09-29 10:00 ET · MGC short win · r=1.02\n\n- entry tapped exactly, trailed to 1.02R\n")
(OUT / "post.txt").write_text("DEMO DESK — sample call\n\nMGC SHORT · grade B+ (9/14)\nPOI 4236.4 – 4239.4  FVG\nENTRY 4236.40  STOP 4253.40\nRISK 17.0pt · $170/contract\n")
(OUT / "live-card.txt").write_text("DEMO live card · MGC short\nENTRY 4236.40 STOP 4253.40 · TP1 4221.40 1.2R\n")
(OUT / "scan-note.txt").write_text("Demo scanner note: sample data, every 5 min.\n")
(OUT / "digest.txt").write_text("DEMO digest · playbook sample\n")
(OUT / "watch-state.json").write_text(json.dumps({"day": "2026-09-29", "alerts": 2, "notified": {}}))
(OUT / "events-2026-09-29.json").write_text(json.dumps(
    {"fetched_at": "2026-09-29T20:01:00-04:00",
     "events": [{"et": "21:30", "min": 1290, "title": "NBS Manufacturing PMI", "cur": "CNY", "impact": "HIGH",
                 "forecast": 50.1, "previous": 49.8}]}, indent=1))
(OUT / "hist").mkdir(exist_ok=True)
(OUT / "hist" / "mgc-5.json").write_text(json.dumps(bars("mgc", mgc_spot, 0.1)))
(OUT / "hist" / "nq-5.json").write_text(json.dumps(bars("nq", nq_spot, 1.0)))
print(f"demo desk written to {OUT} — synthetic sample data only")
