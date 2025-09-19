const { computeTop, reseedDemo } = require("./_shared");
module.exports = async (req, res) => {
  try{
    const limit = parseInt(req.query.limit||"100",10);
    let data = await computeTop(Math.max(1, Math.min(limit, 200)));
    if(!data || !data.length){ reseedDemo(); data = await computeTop(Math.max(1, Math.min(limit, 200))); }
    res.status(200).json(data);
  }catch(e){
    res.status(500).json({error:String(e)});
  }
};
