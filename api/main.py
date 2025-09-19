
import os, json, time, hashlib, io
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, redirect, make_response, send_file
import requests
import xlsxwriter

app = Flask(__name__)

SPORTS = os.getenv("BQ_SPORTS","soccer_epl,basketball_nba,tennis_atp").split(",")
TTL_MIN = int(os.getenv("BQ_TTL_MIN", "120"))
TTL_MAX = int(os.getenv("BQ_TTL_MAX", "600"))
VALUE_THRESHOLD = float(os.getenv("BQ_VALUE_THRESHOLD","0.07"))
SURE_MARGIN = float(os.getenv("BQ_SUREBET_MARGIN","0.02"))
FORCE_TOKEN = os.getenv("BQ_FORCE_TOKEN","")
HASH_SALT = os.getenv("BQ_HASH_SALT","salty")

CACHE = {"events":{}, "clicks":[], "pv":0}

def _now():
    return datetime.now(timezone.utc)

def _load_referrals():
    here = os.path.dirname(__file__)
    path = os.path.abspath(os.path.join(here, "..", "public", "referrals.json"))
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def _load_partners():
    here = os.path.dirname(__file__)
    path = os.path.abspath(os.path.join(here, "..", "public", "partners.json"))
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return []

def fetch_odds(sport):
    # Cached?
    c = CACHE["events"].get(sport)
    if c and c["exp"] > _now():
        return c["data"]

    key = os.getenv("ODDS_API_KEY")
    data = []
    if key:
        try:
            url = f"https://api.the-odds-api.com/v4/sports/{sport}/odds"
            params = {"apiKey": key, "regions": os.getenv("BQ_REGION","eu"), "markets":"h2h","oddsFormat":"decimal"}
            r = requests.get(url, params=params, timeout=10)
            r.raise_for_status()
            js = r.json()
            for ev in js:
                rows = []
                for bk in ev.get("bookmakers", []):
                    for m in bk.get("markets", []):
                        for o in m.get("outcomes", []):
                            rows.append({
                                "bookmaker": bk.get("title"),
                                "outcome": o.get("name"),
                                "price": float(o.get("price", 0))
                            })
                data.append({
                    "id": ev.get("id"),
                    "sport_key": ev.get("sport_key", sport),
                    "commence_time": ev.get("commence_time"),
                    "home": ev.get("home_team",""),
                    "away": ev.get("away_team",""),
                    "odds": rows
                })
        except Exception as e:
            data = []
    if not data:
        # demo data if no API or failed
        data = demo_data(sport)

    ttl = max(TTL_MIN, min(TTL_MAX, int(os.getenv("BQ_TTL_SECONDS","300"))))
    CACHE["events"][sport] = {"data": data, "exp": _now() + timedelta(seconds=ttl)}
    return data

def demo_data(sport):
    base_time = _now() + timedelta(hours=2)
    return [{
        "id": f"demo-{sport}-1",
        "sport_key": sport,
        "commence_time": base_time.isoformat(),
        "home": "Team Alpha",
        "away": "Team Beta",
        "odds": [
            {"bookmaker":"SNAI","outcome":"Home","price":1.95},
            {"bookmaker":"Bet365","outcome":"Away","price":2.05},
            {"bookmaker":"WilliamHill","outcome":"Home","price":2.02},
            {"bookmaker":"Planetwin","outcome":"Away","price":1.98}
        ]
    },{
        "id": f"demo-{sport}-2",
        "sport_key": sport,
        "commence_time": (base_time+timedelta(hours=3)).isoformat(),
        "home": "Team Gamma",
        "away": "Team Delta",
        "odds": [
            {"bookmaker":"SNAI","outcome":"Home","price":2.10},
            {"bookmaker":"Bet365","outcome":"Away","price":1.80},
            {"bookmaker":"WilliamHill","outcome":"Home","price":2.05},
            {"bookmaker":"Planetwin","outcome":"Away","price":1.85}
        ]
    }]

def compute_valuebets(events):
    out = []
    for ev in events:
        prices = ev["odds"]
        # Compute fair odds by average of best price per outcome
        outcomes = {}
        for row in prices:
            outcomes.setdefault(row["outcome"], []).append(row["price"])
        fair = {}
        for k, arr in outcomes.items():
            fair[k] = sum(arr)/len(arr)
        # Determine edge for each price vs fair for its outcome
        best_edge = -1e9
        for row in prices:
            f = fair.get(row["outcome"], row["price"])
            edge = (row["price"]/f) - 1.0
            if edge > best_edge:
                best_edge = edge
        ev2 = dict(ev)
        ev2["edge"] = best_edge
        if best_edge >= float(os.getenv("BQ_VALUE_THRESHOLD","0.07")):
            out.append(ev2)
    return out

def compute_surebets(events):
    out = []
    for ev in events:
        # take best Home and best Away price among bookmakers
        best = {}
        for row in ev["odds"]:
            k = row["outcome"].lower()
            if k not in best or row["price"] > best[k]["price"]:
                best[k] = row
        if "home" in best and "away" in best:
            s = 1.0/best["home"]["price"] + 1.0/best["away"]["price"]
            sure = s < (1.0 - SURE_MARGIN)
            ev2 = dict(ev)
            ev2["sure"] = bool(sure)
            out.append(ev2)
    return [e for e in out if e.get("sure")]

def _hash(data: str) -> str:
    return hashlib.sha256((data + HASH_SALT).encode("utf-8")).hexdigest()[:16]

@app.route("/api/odds")
def api_odds():
    sport = request.args.get("sport", SPORTS[0])
    return jsonify(fetch_odds(sport))

@app.route("/api/valuebets")
def api_value():
    sport = request.args.get("sport", SPORTS[0])
    ev = fetch_odds(sport)
    return jsonify(compute_valuebets(ev))

@app.route("/api/surebets")
def api_sure():
    sport = request.args.get("sport", SPORTS[0])
    ev = fetch_odds(sport)
    return jsonify(compute_surebets(ev))

@app.route("/api/track", methods=["POST"])
def api_track():
    try:
        payload = request.get_json(silent=True) or {}
        ip = request.headers.get("x-forwarded-for", request.remote_addr or "")
        click_id = _hash(f"{ip}|{time.time()}")
        rec = {"id": click_id, "ts": int(time.time()), **payload}
        CACHE["clicks"].append(rec)
        return ("", 204)
    except Exception as e:
        return ("", 204)

@app.route("/api/pv", methods=["POST"])
def api_pv():
    CACHE["pv"] += 1
    return ("", 204)

@app.route("/api/admin")
def api_admin():
    token = request.args.get("token", "")
    if FORCE_TOKEN and token != FORCE_TOKEN:
        return jsonify({"error":"unauthorized"}), 403
    return jsonify({
        "pv": CACHE["pv"],
        "clicks": len(CACHE["clicks"]),
        "last_click": CACHE["clicks"][-1] if CACHE["clicks"] else None
    })

@app.route("/api/export_csv")
def api_export_csv():
    sport = request.args.get("sport", SPORTS[0])
    ev = fetch_odds(sport)
    out = io.StringIO()
    out.write("event_id,sport,commence_time,home,away,bookmaker,outcome,price\n")
    for e in ev:
        for row in e["odds"]:
            out.write(f'{e["id"]},{e.get("sport_key","")},{e["commence_time"]},{e["home"]},{e.get("away","")},{row["bookmaker"]},{row["outcome"]},{row["price"]}\n')
    resp = make_response(out.getvalue())
    resp.headers["Content-Type"] = "text/csv"
    resp.headers["Content-Disposition"] = f'attachment; filename="bettyquotes_{sport}.csv"'
    return resp

@app.route("/api/export_xls")
def api_export_xls():
    sport = request.args.get("sport", SPORTS[0])
    ev = fetch_odds(sport)
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet("Odds")
    headers = ["event_id","sport","commence_time","home","away","bookmaker","outcome","price"]
    for c,h in enumerate(headers): ws.write(0,c,h)
    r=1
    for e in ev:
        for row in e["odds"]:
            ws.write_row(r,0,[e["id"], e.get("sport_key",""), e["commence_time"], e["home"], e.get("away",""), row["bookmaker"], row["outcome"], row["price"]])
            r+=1
    wb.close()
    output.seek(0)
    return send_file(output, as_attachment=True, download_name=f"bettyquotes_{sport}.xlsx", mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@app.route("/go/<bookmaker>")
def go_redirect(bookmaker):
    refs = _load_referrals()
    base = refs.get(bookmaker.lower())
    if not base:
        return redirect("/", code=302)
    # Attach simple UTM and click id
    ip = request.headers.get("x-forwarded-for", request.remote_addr or "")
    click_id = _hash(f"{ip}|{time.time()}")
    sep = "&" if "?" in base else "?"
    url = f"{base}{sep}utm_source=bq&utm_medium=referral&utm_campaign={bookmaker}&cid={click_id}"
    return redirect(url, code=302)

@app.route("/api/reseed_demo")
def reseed():
    CACHE["events"] = {}
    return jsonify({"ok": True, "msg":"demo reseeded"})



# ==== SmartYield Monetization Layer ====
def _load_monetize():
    here = os.path.dirname(__file__)
    path = os.path.abspath(os.path.join(here, "..", "public", "monetize.json"))
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {"campaigns":[]}

def _device_from_ua(ua: str):
    if not ua: return "desktop"
    low = ua.lower()
    if "mobi" in low or "android" in low or "iphone" in low: return "mobile"
    return "desktop"

def _country_from_headers():
    # Vercel provides x-vercel-ip-country, fallback 'IT'
    return request.headers.get("x-vercel-ip-country", "IT")

def _score_campaign(c, ctx, ctr_boost):
    score = c.get("payout_score", 50)
    w = c.get("weights", {})
    score *= w.get("country", {}).get(ctx["country"], 1.0)
    score *= w.get("sport", {}).get(ctx["sport"], 1.0)
    score *= w.get("device", {}).get(ctx["device"], 1.0)
    score *= w.get("lang", {}).get(ctx["lang"], 1.0)
    score *= (1.0 + ctr_boost.get(c["id"], 0.0))
    return score

def _apply_params(url, params: dict):
    if not params: return url
    sep = "&" if "?" in url else "?"
    from urllib.parse import urlencode
    return f"{url}{sep}{urlencode(params)}"

@app.route("/api/ads")
def api_ads():
    js = _load_monetize()
    country = request.args.get("country") or _country_from_headers()
    lang = request.args.get("lang") or (request.accept_languages.best_match(["it","en"]) or "en")
    device = request.args.get("device") or _device_from_ua(request.headers.get("user-agent",""))
    sport = request.args.get("sport","soccer_epl")
    slot = request.args.get("slot","sidebar")
    count = int(js.get("slots",{}).get(slot,{}).get("count", 3))
    # CTR boost
    ctr_boost = {}
    imps = app.config.setdefault("AD_IMP", {})
    clks = app.config.setdefault("AD_CLK", {})
    for cid, imp in imps.items():
        clk = clks.get(cid, 0)
        ctr = (clk + 1) / (imp + 5)  # smoothed
        ctr_boost[cid] = min(0.30, ctr)  # max +30%
    ctx = {"country":country, "lang":lang, "device":device, "sport":sport}
    cands = []
    for c in js.get("campaigns", []):
        cands.append(( _score_campaign(c, ctx, ctr_boost), c ))
    cands.sort(key=lambda x: x[0], reverse=True)
    items = [{
        "id": c["id"], "name": c["name"], "slug": c["slug"],
        "tags": c.get("tags", [])
    } for _, c in cands[:count]]
    return jsonify({"items": items})

@app.route("/api/ad_imp", methods=["POST"])
def api_ad_imp():
    payload = request.get_json(silent=True) or {}
    ids = payload.get("ids", [])
    d = app.config.setdefault("AD_IMP", {})
    for cid in ids:
        d[cid] = d.get(cid, 0) + 1
    return ("", 204)

@app.route("/go_smart/<slug>")
def go_smart(slug):
    js = _load_monetize()
    country = _country_from_headers()
    # pick the campaign by slug
    camp = next((c for c in js.get("campaigns", []) if c.get("slug")==slug), None)
    if not camp:
        return redirect("/", code=302)
    # base url and params
    base = camp.get("url")
    # cid
    ip = request.headers.get("x-forwarded-for", request.remote_addr or "")
    cid = _hash(f"{ip}|{time.time()}|{slug}")
    params = {}
    # append param style
    style = camp.get("param_style", {}).get("append", {})
    for k,v in style.items():
        params[k] = v.replace("{cid}", cid)
    url = _apply_params(base, params)

    # track click
    d = app.config.setdefault("AD_CLK", {})
    d[camp["id"]] = d.get(camp["id"], 0) + 1

    return redirect(url, code=302)

# Vercel entrypoint
def handler(request, *args, **kwargs):
    return app(request, *args, **kwargs)

# Local debug
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)
