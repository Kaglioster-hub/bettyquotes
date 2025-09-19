
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
            {"bookmaker":"SNAI","outcome":"Home","price":1.95}, {"bookmaker":"SNAI","outcome":"Draw","price":3.30},
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
            {"bookmaker":"SNAI","outcome":"Home","price":2.10}, {"bookmaker":"SNAI","outcome":"Draw","price":3.40},
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



def best_prices_by_outcome(ev):
    best = {}
    for row in ev.get("odds", []):
        k = row["outcome"].strip().lower()
        if k not in best or row["price"] > best[k]["price"]:
            best[k] = row
    return best

def detect_surebet_generic(ev):
    # generic N-outcome surebet: sum(1/price_i) < 1 - margin
    best = best_prices_by_outcome(ev)
    if len(best) < 2:
        return False, None
    s = sum(1.0/max(1e-9,b["price"]) for b in best.values())
    sure = s < (1.0 - SURE_MARGIN)
    return sure, s

def compute_top_picks(limit=50):
    items = []
    for sport in SPORTS:
        events = fetch_odds(sport)
        for ev in events:
            best = best_prices_by_outcome(ev)
            if not best: 
                continue
            # 'value score' = max price / average price for that outcome - 1
            # compute per outcome, take max
            outcomes = {}
            for row in ev["odds"]:
                k = row["outcome"].strip().lower()
                outcomes.setdefault(k, []).append(row["price"])
            score = -1e9
            best_outcome = None
            for k, arr in outcomes.items():
                avg = sum(arr)/len(arr)
                b = best.get(k, {"price": avg})
                val = (b["price"]/avg)-1.0
                if val > score:
                    score = val; best_outcome = k
            sure, s = detect_surebet_generic(ev)
            items.append({
                **ev,
                "sport_key": ev.get("sport_key") or sport,
                "value_score": score,
                "sure": bool(sure),
                "best_outcome": best_outcome
            })
    # sort: surebets first, then highest value
    items.sort(key=lambda x: (not x.get("sure", False), -(x.get("value_score") or 0)), reverse=False)
    return items[:limit]

@app.route("/api/top")
def api_top():
    try:
        limit = int(request.args.get("limit","50"))
    except:
        limit = 50
    return jsonify(compute_top_picks(limit=limit))

# Vercel entrypoint
def handler(request, *args, **kwargs):
    return app(request, *args, **kwargs)

# Local debug
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)

# === BQ_PATCH_V4: robust Odds API v4 client + diagnostics ===
import os, time, json, hashlib
from datetime import datetime, timedelta
from flask import request

ODDS_API_KEY = os.environ.get('ODDS_API_KEY','').strip()
BQ_REGION    = os.environ.get('BQ_REGION','eu').strip() or 'eu'
SPORTS       = [s.strip() for s in os.environ.get('BQ_SPORTS','soccer_epl,basketball_nba,tennis_atp').split(',') if s.strip()]
TTL_SEC      = int(os.environ.get('BQ_TTL_SECONDS','300') or 300)
DAYS_AHEAD   = int(os.environ.get('BQ_DAYS_AHEAD','3') or 3)  # prossimi N giorni
SURE_MARGIN  = float(os.environ.get('BQ_SUREBET_MARGIN','0.02') or 0.02)
VALUE_TH     = float(os.environ.get('BQ_VALUE_THRESHOLD','0.07') or 0.07)

_cache = {}  # key -> (expires, payload, meta)

def _cache_get(k):
    v = _cache.get(k)
    if not v: return None
    exp, payload, meta = v
    if exp < time.time(): 
        _cache.pop(k, None); 
        return None
    return payload

def _cache_set(k, payload, meta=None, ttl=TTL_SEC):
    _cache[k] = (time.time()+ttl, payload, meta or {})

def _http_json(url):
    import requests
    r = requests.get(url, timeout=8)
    meta = {'status': r.status_code, 'headers': dict(r.headers)}
    try: data = r.json()
    except Exception: data = {'error':'invalid_json','body': r.text[:400]}
    return data, meta

def fetch_odds_v4(sport_key):
    """
    The Odds API v4: /sports/{sport}/odds?regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso&apiKey=...
    Finestra: prossimi DAYS_AHEAD giorni (usando dateFormat=iso).
    """
    if not ODDS_API_KEY: 
        return []
    cache_key = f"odds:{sport_key}:{BQ_REGION}:{DAYS_AHEAD}"
    got = _cache_get(cache_key)
    if got is not None: 
        return got
    base = "https://api.the-odds-api.com/v4"
    # NOTA: v4 non accetta date-from/to nei param standard; ma molti sport tornano eventi futuri prossimi.
    qs = f"regions={BQ_REGION}&markets=h2h&oddsFormat=decimal&dateFormat=iso&apiKey={ODDS_API_KEY}"
    url = f"{base}/sports/{sport_key}/odds?{qs}"
    data, meta = _http_json(url)
    # gestione errori frequenti: key invalid, quota finita, sport non supportato
    if isinstance(data, dict) and data.get('message') or data.get('error'):
        # non cachiamo hard error
        return []
    # normalizza in formato atteso dal frontend
    out = []
    for ev in data or []:
        commence = ev.get('commence_time')
        try:
            when = datetime.fromisoformat(commence.replace('Z','+00:00'))
            if when > datetime.utcnow() + timedelta(days=DAYS_AHEAD):
                continue
        except Exception:
            pass
        home = (ev.get('home_team') or '').strip()
        away = ''
        teams = ev.get('teams') or []
        if teams and home:
            away = teams[0] if teams[0]!=home else (teams[1] if len(teams)>1 else '')
        odds_rows = []
        for bm in ev.get('bookmakers') or []:
            bm_key = bm.get('key'); 
            for mk in bm.get('markets') or []:
                if mk.get('key') != 'h2h': 
                    continue
                for outc in mk.get('outcomes') or []:
                    odds_rows.append({
                        'bookmaker': bm_key,
                        'outcome': outc.get('name'),
                        'price': float(outc.get('price') or 0),
                    })
        out.append({
            'id': ev.get('id'),
            'sport_key': sport_key,
            'commence_time': commence,
            'home': home, 'away': away,
            'odds': odds_rows
        })
    _cache_set(cache_key, out, meta={'diag':meta})
    return out

def best_prices_by_outcome(ev):
    best = {}
    for row in ev.get('odds', []):
        k = (row.get("outcome") or '').strip().lower()
        if not k: 
            continue
        if k not in best or row["price"] > best[k]["price"]:
            best[k] = row
    return best

def detect_surebet_generic(ev):
    best = best_prices_by_outcome(ev)
    if len(best) < 2: return False, None
    inv = sum(1.0/max(1e-9,b["price"]) for b in best.values())
    return (inv < (1.0 - SURE_MARGIN)), inv

def compute_top_picks(limit=100):
    items=[]
    for sp in SPORTS:
        for ev in fetch_odds_v4(sp):
            best = best_prices_by_outcome(ev)
            if not best: 
                continue
            # value score = delta best vs media
            groups = {}
            for r in ev['odds']:
                k=(r['outcome'] or '').strip().lower()
                groups.setdefault(k, []).append(r['price'])
            score=-9e9; best_out=None
            for k,arr in groups.items():
                avg = sum(arr)/len(arr)
                b = best.get(k, {'price':avg})
                v = (b['price']/avg) - 1.0
                if v > score:
                    score=v; best_out=k
            sure, inv = detect_surebet_generic(ev)
            items.append({**ev,'value_score':score,'sure':bool(sure),'best_outcome':best_out})
    items.sort(key=lambda x:(not x.get('sure',False), -(x.get('value_score') or 0)))
    return items[:limit]

@app.route('/api/odds')
def api_odds():
    sport = request.args.get('sport') or (SPORTS[0] if SPORTS else 'soccer_epl')
    data = fetch_odds_v4(sport)
    if not data:
        # fallback demo se vuoto
        try:
            reseed_demo()
            data = fetch_odds_v4(sport)
        except Exception:
            pass
    return jsonify(data)

@app.route('/api/top')
def api_top():
    try: limit=int(request.args.get('limit','100'))
    except: limit=100
    data = compute_top_picks(limit=limit)
    if not data:
        try:
            reseed_demo()
            data = compute_top_picks(limit=limit)
        except Exception:
            pass
    return jsonify(data)

@app.route('/api/ping_odds')
def api_ping():
    """Diagnostica: controlla key, quota residua, sport primi 1-2."""
    test_sports = SPORTS[:2] or ['soccer_epl']
    diag = {'region':BQ_REGION,'sports':test_sports,'key_present': bool(ODDS_API_KEY)}
    results=[]
    for sp in test_sports:
        data, meta = _http_json(f"https://api.the-odds-api.com/v4/sports/{sp}/odds?regions={BQ_REGION}&markets=h2h&oddsFormat=decimal&dateFormat=iso&apiKey={ODDS_API_KEY}")
        results.append({'sport':sp,'status': meta.get('status'), 'remaining': meta.get('headers',{}).get('x-requests-remaining'), 'msg': (data.get('message') if isinstance(data,dict) else None), 'count': (len(data) if isinstance(data,list) else 0)})
    diag['results']=results
    return jsonify(diag)
# === END BQ_PATCH_V4 ===
