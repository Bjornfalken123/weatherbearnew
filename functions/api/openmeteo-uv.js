export async function onRequestGet(context){
  try{
    var request = context.request;
    var url = new URL(request.url);

    var lat = Number(url.searchParams.get("lat"));
    var lon = Number(url.searchParams.get("lon"));

    if(!isFinite(lat) || !isFinite(lon)){
      return Response.json({
        error: "lat/lon saknas eller är ogiltiga"
      }, { status: 400 });
    }

    var openMeteoUrl =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=" + encodeURIComponent(String(lat)) +
      "&longitude=" + encodeURIComponent(String(lon)) +
      "&hourly=uv_index" +
      "&forecast_days=7" +
      "&timezone=auto";

    var response = await fetch(openMeteoUrl);
    var data = await response.json();

    if(!response.ok){
      return Response.json({
        error: "Open-Meteo UV kunde inte hämtas",
        details: data
      }, { status: response.status });
    }

    var times = data.hourly && data.hourly.time ? data.hourly.time : [];
    var values = data.hourly && data.hourly.uv_index ? data.hourly.uv_index : [];

    var timeseries = times.map(function(time, index){
      return {
        time: time,
        uvIndex: values[index]
      };
    }).filter(function(row){
      return row.time && row.uvIndex != null && isFinite(Number(row.uvIndex));
    });

    return Response.json({
      source: "open-meteo",
      timeseries: timeseries
    });
  }catch(error){
    console.error(error);

    return Response.json({
      error: "UV-index kunde inte hämtas"
    }, { status: 500 });
  }
}
