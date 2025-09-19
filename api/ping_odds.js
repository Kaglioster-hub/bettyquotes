const { REGION, SPORTS, MARKETS, httpJSON } = require("./_shared");

module.exports = async (req, res) => {
  try {
    const key = (process.env.ODDS_API_KEY || "").trim();
    if (!key) {
      return res
        .status(500)
        .json({ error: "Missing ODDS_API_KEY in environment variables" });
    }

    const test = SPORTS.slice(0, 2);
    if (!test.length) {
      return res.status(500).json({ error: "No SPORTS configured" });
    }

    const results = [];
    for (const sp of test) {
      const url = `https://api.the-odds-api.com/v4/sports/${sp}/odds?regions=${REGION}&markets=${MARKETS}&oddsFormat=decimal&dateFormat=iso&apiKey=${key}`;
      const { data, status, headers } = await httpJSON(url);

      results.push({
        sport: sp,
        status,
        remaining: headers ? headers["x-requests-remaining"] : null,
        count: Array.isArray(data) ? data.length : 0,
        msg:
          data && !Array.isArray(data)
            ? data.message || data.error || null
            : null,
      });
    }

    res.status(200).json({
      region: REGION,
      markets: MARKETS,
      key_present: !!key,
      sports: test,
      results,
    });
  } catch (e) {
    console.error("ping_odds error:", e);
    res.status(500).json({ error: String(e) });
  }
};
