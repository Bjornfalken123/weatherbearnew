app.get("/api/depth", async function(req, res){
  try{
    var lat = Number(req.query.lat);
    var lon = Number(req.query.lon);

    if(!isFinite(lat) || !isFinite(lon)){
      return res.status(400).json({
        error: "Ogiltiga koordinater"
      });
    }

    return res.json({
      depthMeters: null,
      source: "EMODnet Bathymetry",
      note: "Depth point lookup not connected yet"
    });
  }catch(err){
    console.error("Depth API error", err);

    return res.status(500).json({
      error: "Kunde inte hämta djup"
    });
  }
});
