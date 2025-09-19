const { fetchOddsV4, reseedDemo } = require("./_shared");

module.exports = async (req, res) => {
  try{
    const sportsEnv = (process.env.BQ_SPORTS||"").split(",").map(s=>s.trim()).filter(Boolean);
    const fallback = sportsEnv[0] || "soccer_epl";
    const sport = (req.query.sport||fallback||"").trim() || fallback;
    let data = await fetchOddsV4(sport);
    if(!data || !data.length){ reseedDemo(); data = await fetchOddsV4(sport); }
    res.status(200).json(data);
  }catch(e){
    res.status(500).json({error:String(e)});
  }
};
