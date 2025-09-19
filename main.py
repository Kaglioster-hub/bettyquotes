import os, time, json, io, hashlib
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, redirect, make_response, send_file
import requests
import xlsxwriter

app = Flask(__name__)

# === ENV CONFIG ===
ODDS_API_KEY = (os.environ.get("ODDS_API_KEY") or "").strip()
BQ_REGION    = (os.environ.get("BQ_REGION") or "eu").strip()
SPORTS       = [s.strip() for s in (os.environ.get("BQ_SPORTS") or "soccer_epl,basketball_nba,tennis_atp").split(",") if s.strip()]
TTL_SEC      = int(os.environ.get("BQ_TTL_SECONDS") or 300)
SURE_MARGIN  = float(os.environ.get("BQ_SUREBET_MARGIN") or 0.02)
VALUE_TH     = float(os.environ.get("BQ_VALUE_THRESHOLD") or 0.07)
HASH_SALT    = os.environ.get("BQ_HASH_SALT","salty")

# === CACHE ===
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
    _cache[k] = (time.time()+ttl, data)

# === HELPERS ===
def _hash(data: str) -> str:
    return hashlib.sha256((data + HASH_SALT).encode("utf-8")).hexdigest()[:16]

def http_json(url, timeout=8):
    try:
        r = requests.get(url, timeout=timeout)
        return r.json(), dict(r.headers), r.status_code
    except Exception as e:
        return {"error": str(e)}, {}, 500

def reseed_demo():
    base_time = datetime.now(timezone.utc) + timedelta(hours=2)
    demo=[]
    for sp in SPORTS:
        demo.append({
            "id": f"demo-{sp}-1",
            "sport_key": sp,
            "commence_time": base_time.isoformat(),
            "home": "Team Alpha", "away": "Team Beta",
            "odds": [
                {"bookmaker":"SNAI","outcome":"Home","price":1.95},
                {"bookmaker":"SNAI","outcome":"Draw","price":3.30},
                {"bookmaker":"Bet365","outcome":"Away","price":2.05}
            ]
        })
    for ev in demo: cset(f"v4:{ev['sport_key']}:{BQ_REGION}", [ev])
    return demo

# === CORE: Odds API v4 ===
def fetch_v4(sport):
    if not ODDS_API_KEY: return []
    ck=f"v4:{sport}:{BQ_REGION}"
    hit=cget(ck)
    if hit is not None: return hit

    base="https://api.the-odds-api.com/v4"
    qs=f"regions={BQ_REGION}&markets=h2h&oddsFormat=decimal&dateFormat=iso&apiKey={ODDS_API_KEY}"
    data, hdr, st = http_json(f"{base}/sports/{sport}/odds?{qs}")

    if st!=200 or (isinstance(data,dict) and (data.get("message") or data.get("error"))):
        return []

    out=[]
    for ev in data or []:
        home=(ev.get("home_team") or "").strip()
        teams=ev.get("teams") or []
        away=teams[0] if teams and teams[0]!=home else (teams[1] if len(teams)>1 else "")
        rows=[]
        for bm in ev.get("bookmakers") or []:
            for mk in bm.get("markets") or []:
                if mk.get("key")!="h2h": continue
                for o in mk.get("outcomes") or []:
                    try: pr=float(o.get("price") or 0)
                    except: pr=0
                    rows.append({"bookmaker":bm.get("key"),"outcome":o.get("name"),"price":pr})
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
    best={}
    for r in ev.get("odds",[]):
        k=(r.get("outcome") or "").strip().lower()
        if not k: continue
        if k not in best or r["price"]>best[k]["price"]:
            best[k]=r
    return best

def detect_surebet(ev):
    b=best_prices(ev)
    if len(b)<2: return False, None
    inv=sum(1.0/max(1e-9,x["price"]) for x in b.values())
    return inv < (1.0 - SURE_MARGIN), inv

def compute_top(limit=100):
    items=[]
    for sp in SPORTS:
        for ev in fetch_v4(sp):
            best=best_prices(ev)
            if not best: continue
            # value score: max delta best vs avg
            groups={}
            for r in ev["odds"]:
                k=(r["outcome"] or "").strip().lower()
                groups.setdefault(k,[]).append(r["price"])
            score=-9e9
            for k,arr in groups.items():
                if not arr: continue
                avg=sum(arr)/len(arr)
                b=best.get(k,{"price":avg})
                v=(b["price"]/avg)-1.0
                if v>score: score=v
            sure,_=detect_surebet(ev)
            items.append({**ev,"value_score":score,"sure":sure})
    items.sort(key=lambda x:(not x.get("sure",False), -(x.get("value_score") or 0)))
    return items[:limit]

# === ROUTES ===
@app.route("/api/odds")
def api_odds():
    sport=request.args.get("sport") or (SPORTS[0] if SPORTS else "soccer_epl")
    data=fetch_v4(sport)
    if not data: data=reseed_demo()
    return jsonify(data)

@app.route("/api/top")
def api_top():
    try: limit=int(request.args.get("limit","100"))
    except: limit=100
    data=compute_top(limit=limit)
    if not data: data=reseed_demo()
    return jsonify(data)

@app.route("/api/ping_odds")
def api_ping():
    test=SPORTS[:2] or ["soccer_epl"]
    diag={"region":BQ_REGION,"key_present":bool(ODDS_API_KEY),"sports":test}
    res=[]
    for sp in test:
        data, hdr, st = http_json(f"https://api.the-odds-api.com/v4/sports/{sp}/odds?regions={BQ_REGION}&markets=h2h&oddsFormat=decimal&dateFormat=iso&apiKey={ODDS_API_KEY}")
        res.append({
            "sport":sp,"status":st,
            "remaining":hdr.get("x-requests-remaining"),
            "count": len(data) if isinstance(data,list) else 0,
            "msg": data.get("message") if isinstance(data,dict) else None
        })
    diag["results"]=res
    return jsonify(diag)

# === EXPORT ===
@app.route("/api/export_csv")
def api_export_csv():
    sport=request.args.get("sport", SPORTS[0])
    ev=fetch_v4(sport)
    out=io.StringIO()
    out.write("event_id,sport,commence_time,home,away,bookmaker,outcome,price\n")
    for e in ev:
        for row in e["odds"]:
            out.write(f'{e["id"]},{e.get("sport_key","")},{e["commence_time"]},{e["home"]},{e.get("away","")},{row["bookmaker"]},{row["outcome"]},{row["price"]}\n')
    resp=make_response(out.getvalue())
    resp.headers["Content-Type"]="text/csv"
    resp.headers["Content-Disposition"]=f'attachment; filename="bettyquotes_{sport}.csv"'
    return resp

@app.route("/api/export_xls")
def api_export_xls():
    sport=request.args.get("sport", SPORTS[0])
    ev=fetch_v4(sport)
    output=io.BytesIO()
    wb=xlsxwriter.Workbook(output, {"in_memory": True})
    ws=wb.add_worksheet("Odds")
    headers=["event_id","sport","commence_time","home","away","bookmaker","outcome","price"]
    for c,h in enumerate(headers): ws.write(0,c,h)
    r=1
    for e in ev:
        for row in e["odds"]:
            ws.write_row(r,0,[e["id"],e.get("sport_key",""),e["commence_time"],e["home"],e.get("away",""),row["bookmaker"],row["outcome"],row["price"]])
            r+=1
    wb.close()
    output.seek(0)
    return send_file(output, as_attachment=True, download_name=f"bettyquotes_{sport}.xlsx", mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

# === ENTRYPOINT ===
def handler(request, *args, **kwargs):
    return app(request, *args, **kwargs)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)
