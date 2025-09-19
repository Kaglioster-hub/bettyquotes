const { REGION, SPORTS, httpJSON } = require("./_shared"); const MARKETS=(process.env.BQ_MARKETS||"h2h,spreads,totals").trim();
module.exports = async (req, res) => {
  try{
    const key = (process.env.ODDS_API_KEY||"").trim();
    const test = SPORTS.slice(0,2);
    const results = [];
    for(const sp of test){
      const url = `https://api.the-odds-api.com/v4/sports/${sp}/odds?regions=${REGION}&markets=${MARKETS}&oddsFormat=decimal&dateFormat=iso&apiKey=${key}`;
      const {data, status, headers} = await httpJSON(url);
      results.push({
        sport: sp, status,
        remaining: headers["x-requests-remaining"],
        count: Array.isArray(data) ? data.length : 0,
        msg: (data && !Array.isArray(data)) ? (data.message||data.error||null) : null
      });
    }
    res.status(200).json({region:REGION, markets:MARKETS, key_present: !!key, sports:test, results});
  }catch(e){
    res.status(500).json({error:String(e)});
  }
};

