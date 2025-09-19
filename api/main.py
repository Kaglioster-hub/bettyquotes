import os, time, io, json, hashlib
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, make_response, send_file, send_from_directory
import requests, xlsxwriter
from dotenv import load_dotenv

# ===== ENV: carica prima .env.local poi .env (solo in dev) =====
for f in (".env.local", ".env"):
    if os.path.exists(f):
        load_dotenv(f)

# ===== PATH STATICI (per dev) =====
HERE = os.path.abspath(os.path.dirname(__file__))
PUBLIC_DIR = os.path.abspath(os.path.join(HERE, "..", "public"))

# ===== APP =====
app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="/")

# ===== CONFIG =====
ODDS_API_KEY = (os.getenv("ODDS_API_KEY") or "").strip()
BQ_REGION    = (os.getenv("BQ_REGION") or "eu").strip()                 # es: "eu,uk"
BQ_MARKETS   = [m.strip() for m in (os.getenv("BQ_MARKETS") or "h2h").split(",") if m.strip()]  # es: h2h,spreads,totals
SPORTS       = [s.strip() for s in (os.getenv("BQ_SPORTS") or "soccer_epl").split(",") if s.strip()]
TTL_SEC      = int(os.getenv("BQ_TTL_SECONDS") or 300)
SURE_MARGIN  = float(os.getenv("BQ_SUREBET_MARGIN") or 0.02)
VALUE_TH     = float(os.getenv("BQ_VALUE_THRESHOLD") or 0.07)
HASH_SALT    = os.getenv("BQ_HASH_SALT", "salty")

# ===== CACHE =====
_cache = {}
def cget(k):
    v = _cache.get(k)
    if not v: return None
    exp, data = v
    if exp < time.time():
        _cache.pop(k, None)
        return None
    return data

def cset(k, data, ttl=TTL_SEC):
    _cache[k] = (time.time() + ttl, data)

# ===== HTTP helper =====
UA = {"user-agent": "bettyquotes/1 (+vercel)"}

def http_json(url, timeout=10):
    try:
        r = requests.get(url, timeout=timeout, headers=UA)
        status = r.status_code
        headers = dict(r.headers)
        try:
            data = r.json()
        except Exception:
            data = {"error": "invalid_json", "body": r.text[:400]}
        return data, headers, status
    except Exception as e:
        return {"error": str(e)}, {}, 500

# ===== DEMO SEED =====
def reseed_demo():
    base_time = datetime.now(timezone.utc) + timedelta(hours=2)
    demo = []
    for sp in SPORTS[:6]:
        demo.append({
            "id": f"demo-{sp}-1",
            "sport_key": sp,
            "commence_time": base_time.isoformat(),
            "home": "Team Alpha", "away": "Team Beta",
            "odds": [
                {"bookmaker": "snai",   "outcome": "Home", "price": 1.95},
                {"bookmaker": "snai",   "outcome": "Draw", "price": 3.30},
                {"bookmaker": "bet365", "outcome": "Away", "price": 2.05}
            ]
        })
    for ev in demo:
        cset(f"v4:{ev['sport_key']}:{BQ_REGION}:{','.join(BQ_MARKETS)}", [ev], ttl=180)
    return demo

# ===== ODDS API v4 =====
def fetch_v4(sport):
    if not ODDS_API_KEY:
        return []
    ck = f"v4:{sport}:{BQ_REGION}:{','.join(BQ_MARKETS)}"
    hit = cget(ck)
    if hit is not None:
        return hit

    base = "https://api.the-odds-api.com/v4"
    qs = (
        f"regions={BQ_REGION}"
        f"&markets={','.join(BQ_MARKETS)}"
        f"&oddsFormat=decimal&dateFormat=iso"
        f"&apiKey={ODDS_API_KEY}"
    )
    data, hdr, st = http_json(f"{base}/sports/{sport}/odds?{qs}")

    # errori “soft” → nessun cache, ritorna []
    if st != 200 or (isinstance(data, dict) and (data.get("message") or data.get("error"))):
        return []

    out = []
    for ev in data or []:
        home = (ev.get("home_team") or "").strip()
        teams = ev.get("teams") or []
        away = teams[0] if teams and teams[0] != home else (teams[1] if len(teams) > 1 else "")
        rows = []
        for bm in ev.get("bookmakers") or []:
            bk = (bm.get("key") or "").lower()
            for mk in bm.get("markets") or []:
                if mk.get("key") not in BQ_MARKETS:
                    continue
                for o in mk.get("outcomes") or []:
                    try:
                        pr = float(o.get("price") or 0)
                    except Exception:
                        pr = 0.0
                    rows.append({"bookmaker": bk, "outcome": o.get("name"), "price": pr})
        out.append({
            "id": ev.get("id"),
            "sport_key": sport,
            "commence_time": ev.get("commence_time"),
            "home": home, "away": away,
            "odds": rows
        })

    cset(ck, out)
    return out

def best_prices(ev):
    best = {}
    for r in ev.get("odds", []):
        k = (r.get("outcome") or "").strip().lower()
        if not k:
            continue
        if k not in best or r["price"] > best[k]["price"]:
            best[k] = r
    return best

def detect_surebet(ev):
    b = best_prices(ev)
    if len(b) < 2:
        return False, None
    inv = sum(1.0 / max(1e-9, x["price"]) for x in b.values())
    return inv < (1.0 - SURE_MARGIN), inv

def compute_top(limit=100):
    items = []
    for sp in SPORTS:
        for ev in fetch_v4(sp):
            best = best_prices(ev)
            if not best:
                continue
            groups = {}
            for r in ev["odds"]:
                k = (r["outcome"] or "").strip().lower()
                groups.setdefault(k, []).append(r["price"])
            score = -1e9
            for k, arr in groups.items():
                if not arr: 
                    continue
                avg = sum(arr) / len(arr)
                b = best.get(k, {"price": avg})
                v = (b["price"] / avg) - 1.0
                if v > score:
                    score = v
            sure, _ = detect_surebet(ev)
            # opzionale: filtra per VALUE_TH se vuoi mostrare solo value >= soglia
            items.append({**ev, "value_score": score, "sure": sure})
    # surebets prima, poi value_score desc
    items.sort(key=lambda x: (not x.get("sure", False), -(x.get("value_score") or 0)))
    return items[:limit]

# ===== API =====
@app.route("/api/odds")
def api_odds():
    sport = request.args.get("sport") or (SPORTS[0] if SPORTS else "soccer_epl")
    data = fetch_v4(sport)
    if not data:
        data = reseed_demo()
    return jsonify(data)

@app.route("/api/top")
def api_top():
    try:
        limit = int(request.args.get("limit", "100"))
    except Exception:
        limit = 100
    data = compute_top(limit=limit)
    if not data:
        data = reseed_demo()
    return jsonify(data)

@app.route("/api/ping_odds")
def api_ping():
    test = SPORTS[:2] or ["soccer_epl"]
    diag = {"region": BQ_REGION, "key_present": bool(ODDS_API_KEY), "sports": test}
    res = []
    base = "https://api.the-odds-api.com/v4"
    for sp in test:
        qs = (
            f"regions={BQ_REGION}&markets={','.join(BQ_MARKETS)}"
            f"&oddsFormat=decimal&dateFormat=iso&apiKey={ODDS_API_KEY}"
        )
        data, hdr, st = http_json(f"{base}/sports/{sp}/odds?{qs}")
        res.append({
            "sport": sp,
            "status": st,
            "remaining": hdr.get("x-requests-remaining"),
            "count": (len(data) if isinstance(data, list) else 0),
            "msg": (data.get("message") if isinstance(data, dict) else None)
        })
    diag["results"] = res
    return jsonify(diag)

@app.route("/api/reseed_demo")
def api_reseed():
    return jsonify({"ok": True, "data": reseed_demo()})

@app.route("/api/pv", methods=["POST"])
def api_pv():
    # semplice sink; puoi contare su log/analytics Vercel
    return ("", 204)

@app.route("/api/track", methods=["POST"])
def api_track():
    try:
        payload = request.get_json(silent=True) or {}
        bm = (payload.get("bookmaker") or "").lower()
        ts = int(time.time())
        hid = hashlib.sha256(f"{bm}{ts}{HASH_SALT}".encode()).hexdigest()[:12]
        # path assoluto a referrals.json
        try:
            with open(os.path.join(PUBLIC_DIR, "referrals.json"), "r", encoding="utf-8") as f:
                refs = json.load(f)
        except Exception:
            refs = {}
        url = refs.get(bm) or refs.get("bet365") or "https://www.bet365.com/"
        return jsonify({"redirect": url, "token": hid})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# ===== EXPORT =====
@app.route("/api/export_csv")
def api_export_csv():
    sport = request.args.get("sport") or (SPORTS[0] if SPORTS else "soccer_epl")
    ev = fetch_v4(sport) or []
    out = io.StringIO()
    out.write("event_id,sport,commence_time,home,away,bookmaker,outcome,price\n")
    for e in ev:
        for row in e.get("odds", []):
            out.write(
                f'{e.get("id","")},{e.get("sport_key","")},{e.get("commence_time","")},'
                f'{e.get("home","")},{e.get("away","")},{row.get("bookmaker","")},'
                f'{(row.get("outcome") or "").replace(",","/")},{row.get("price",0)}\n'
            )
    resp = make_response(out.getvalue())
    resp.headers["Content-Type"] = "text/csv"
    resp.headers["Content-Disposition"] = f'attachment; filename="bettyquotes_{sport}.csv"'
    return resp

@app.route("/api/export_xls")
def api_export_xls():
    sport = request.args.get("sport") or (SPORTS[0] if SPORTS else "soccer_epl")
    ev = fetch_v4(sport) or []
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = wb.add_worksheet("Odds")
    headers = ["event_id", "sport", "commence_time", "home", "away", "bookmaker", "outcome", "price"]
    for c, h in enumerate(headers):
        ws.write(0, c, h)
    r = 1
    for e in ev:
        for row in e.get("odds", []):
            ws.write_row(r, 0, [
                e.get("id", ""), e.get("sport_key", ""), e.get("commence_time", ""),
                e.get("home", ""), e.get("away", ""), row.get("bookmaker", ""),
                row.get("outcome", ""), row.get("price", 0)
            ])
            r += 1
    wb.close()
    output.seek(0)
    return send_file(output, as_attachment=True,
                     download_name=f"bettyquotes_{sport}.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

# ===== STATIC DEV ONLY =====
# In locale serviamo anche l'UI; su Vercel ci pensa vercel.json.
@app.route("/")
def _index():
    return send_from_directory(PUBLIC_DIR, "index.html")

@app.route("/<path:path>")
def _static_proxy(path):
    safe_path = path.replace("..", "")
    return send_from_directory(PUBLIC_DIR, safe_path)

# ===== Local run =====
if __name__ == "__main__":
    # In locale continua a servire anche lo statico
    app.run(host="0.0.0.0", port=3000)
