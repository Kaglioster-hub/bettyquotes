const { reseedDemo } = require("./_shared");
module.exports = async (req, res) => { try { res.status(200).json(reseedDemo()); } catch(e){ res.status(500).json({error:String(e)}); } };
