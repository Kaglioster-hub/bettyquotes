const fetch = require("node-fetch");

const KEY = (process.env.ODDS_API_KEY || "").trim();
const REGION = (process.env.BQ_REGION || "eu").trim();
const MARKETS = (process.env.BQ_MARKETS || "h2h,spreads,totals").trim();
const SPORTS = (process.env.BQ_SPORTS || "soccer_epl,basketball_nba,tennis_atp")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const TTL = parseInt(process.env.BQ_TTL_SECONDS || "300", 10);
const SURE_MARGIN = parseFloat(process.env.BQ_SUREBET_MARGIN || "0.02");

const CACHE = new Map();
const now = () => Date.now();

function cget(k) {
  const v = CACHE.get(k);
  if (!v) return null;
  if (v.exp < now()) {
    CACHE.delete(k);
    return null;
  }
  return v.data;
}
function cset(k, data, ttl = TTL) {
  CACHE.set(k, { exp: now() + ttl * 1000, data });
}

async function httpJSON(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "bettyquotes/1" } });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: "invalid_json", body: text.slice(0, 400) };
    }
    return {
      data: json,
      status: r.status,
      headers: Object.fromEntries(r.headers.entries()),
    };
  } catch (err) {
    return { data: { error: String(err) }, status: 500, headers: {} };
  }
}

async function fetchOddsV4(sport) {
  if (!KEY) return [];
  const ck = `v4:${sport}:${REGION}`;
  const hit = cget(ck);
  if (hit) return hit;

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=${REGION}&markets=${MARKETS}&oddsFormat=decimal&dateFormat=iso&apiKey=${KEY}`;
  const { data, status } = await httpJSON(url);

  if (status !== 200) {
    console.error(`[fetchOddsV4] ${sport} failed:`, data);
    return [];
  }
  if (data && !Array.isArray(data) && (data.message || data.error)) {
    console.error(`[fetchOddsV4] ${sport} API error:`, data);
    return [];
  }

  const list = (Array.isArray(data) ? data : []).map(ev => {
    const home = (ev.home_team || "").trim();
    const teams = ev.teams || [];
    const away = teams[0] && teams[0] !== home ? teams[0] : teams[1] || "";
    const rows = [];
    for (const bm of ev.bookmakers || []) {
      const bk = bm.key;
      for (const mk of bm.markets || []) {
        if (mk.key !== "h2h") continue;
        for (const o of mk.outcomes || []) {
          const price = Number(o.price || 0);
          rows.push({ bookmaker: bk, outcome: o.name, price });
        }
      }
    }
    return {
      id: ev.id,
      sport_key: sport,
      commence_time: ev.commence_time,
      home,
      away,
      odds: rows,
    };
  });

  cset(ck, list);
  return list;
}

function reseedDemo() {
  for (const sp of SPORTS) {
    const ev = {
      id: `demo_${sp}`,
      sport_key: sp,
      commence_time: new Date(Date.now() + 86400000).toISOString(),
      home: "Demo A",
      away: "Demo B",
      odds: [
        { bookmaker: "demo", outcome: "Home", price: 1.9 },
        { bookmaker: "demo", outcome: "Draw", price: 3.4 },
        { bookmaker: "demo", outcome: "Away", price: 3.9 },
      ],
    };
    const ck = `v4:${sp}:${REGION}`;
    cset(ck, [ev], 180);
  }
  return { ok: true };
}

module.exports = {
  REGION,
  SPORTS,
  MARKETS,
  fetchOddsV4,
  reseedDemo,
  httpJSON,
};
