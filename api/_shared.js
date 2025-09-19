const KEY = (process.env.ODDS_API_KEY || "").trim();
const REGION = (process.env.BQ_REGION || "eu").trim(); // può essere "eu,uk"
const SPORTS = (process.env.BQ_SPORTS || "soccer_epl,basketball_nba,tennis_atp")
  .split(",").map(s => s.trim()).filter(Boolean);
const TTL = parseInt(process.env.BQ_TTL_SECONDS || "300", 10);
const SURE_MARGIN = parseFloat(process.env.BQ_SUREBET_MARGIN || "0.02");

const CACHE = new Map();
const now = () => Date.now();
function cget(k){ const v=CACHE.get(k); if(!v) return null; if(v.exp<now()){ CACHE.delete(k); return null; } return v.data; }
function cset(k,data,ttl=TTL){ CACHE.set(k,{exp:now()+ttl*1000,data}); }

async function httpJSON(url){
  const r = await fetch(url, {headers:{'user-agent':'bettyquotes/1'}});
  const text = await r.text();
  let json; try{ json = JSON.parse(text) }catch{ json = { error:'invalid_json', body: text.slice(0,400) } }
  return { data: json, status: r.status, headers: Object.fromEntries(r.headers.entries()) };
}

async function fetchOddsV4(sport){
  if(!KEY) return [];
  const ck = `v4:${sport}:${REGION}`;
  const hit = cget(ck); if(hit) return hit;
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=${REGION}&markets=${MARKETS}&oddsFormat=decimal&dateFormat=iso&apiKey=${KEY}`;
  const {data} = await httpJSON(url);
  if (data && !Array.isArray(data) && (data.message || data.error)) return [];
  const list = (Array.isArray(data)?data:[]).map(ev=>{
    const home = (ev.home_team||"").trim();
    const teams = ev.teams||[];
    const away = teams[0] && teams[0]!==home ? teams[0] : (teams[1]||"");
    const rows=[];
    for(const bm of (ev.bookmakers||[])){
      const bk=bm.key;
      for(const mk of (bm.markets||[])){
        if(mk.key!=='h2h') continue;
        for(const o of (mk.outcomes||[])){
          const price = Number(o.price||0);
          rows.push({bookmaker: bk, outcome: o.name, price});
        }
      }
    }
    return { id: ev.id, sport_key:sport, commence_time: ev.commence_time, home, away, odds: rows };
  });
  cset(ck, list);
  return list;
}

function bestPrices(ev){
  const best={};
  for(const r of (ev.odds||[])){
    const k = String(r.outcome||"").toLowerCase();
    if(!k) continue;
    if(!best[k] || r.price > best[k].price) best[k] = r;
  }
  return best;
}
function isSurebet(ev){
  const b = bestPrices(ev); const ks = Object.keys(b);
  if(ks.length < 2) return false;
  const inv = ks.reduce((s,k)=> s + 1/Math.max(1e-9, b[k].price), 0);
  return inv < (1 - SURE_MARGIN);
}

async function computeTop(limit=100){
  const items=[];
  for(const sp of SPORTS){
    const arr = await fetchOddsV4(sp);
    for(const ev of arr){
      const groups={};
      for(const r of ev.odds){ const k=String(r.outcome||"").toLowerCase(); (groups[k]=groups[k]||[]).push(r.price); }
      let score=-1e9;
      for(const k in groups){
        const a=groups[k]; if(!a.length) continue;
        const avg=a.reduce((x,y)=>x+y,0)/a.length;
        const best=bestPrices(ev)[k]||{price:avg};
        const v=(best.price/avg)-1; if(v>score) score=v;
      }
      items.push({...ev, value_score:score, sure:isSurebet(ev)});
    }
  }
  items.sort((a,b)=> (a.sure===b.sure ? (b.value_score - a.value_score) : (a.sure ? -1 : 1)));
  return items.slice(0,limit);
}

function reseedDemo(){
  for(const sp of SPORTS){
    const ev = {
      id: `demo_${sp}`,
      sport_key: sp,
      commence_time: new Date(Date.now()+86400000).toISOString(),
      home: 'Demo A', away: 'Demo B',
      odds: [
        {bookmaker:'demo', outcome:'Home', price:1.9},
        {bookmaker:'demo', outcome:'Draw', price:3.4},
        {bookmaker:'demo', outcome:'Away', price:3.9}
      ]
    };
    const ck = `v4:${sp}:${REGION}`; cset(ck, [ev], 180);
  }
  return {ok:true};
}

module.exports = { REGION, SPORTS, fetchOddsV4, computeTop, reseedDemo, httpJSON };

