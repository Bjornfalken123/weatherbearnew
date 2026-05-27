export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const lat = Number(url.searchParams.get("lat") || 58.6);
  const lon = Number(url.searchParams.get("lon") || 11.3);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json(
      {
        error: true,
        message: "lat och lon krävs"
      },
      { status: 400 }
    );
  }

  const apiUrl =
    "https://api.open-meteo.com/v1/ecmwf" +
    `?latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lon))}` +
    "&hourly=sea_level_height_msl" +
    "&forecast_hours=72" +
    "&timezone=GMT";

  try {
    const response = await fetch(apiUrl);
    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return Response.json(
        {
          error: true,
          status: response.status,
          apiUrl,
          body: text.slice(0, 1500)
        },
        { status: 500 }
      );
    }

    const times = Array.isArray(data?.hourly?.time)
      ? data.hourly.time
      : [];

    const values = Array.isArray(data?.hourly?.sea_level_height_msl)
      ? data.hourly.sea_level_height_msl
      : [];

    return Response.json({
      ok: true,
      apiUrl,
      hourlyKeys: Object.keys(data?.hourly || {}),
      count: values.length,
      unit: data?.hourly_units?.sea_level_height_msl || null,
      firstPoints: times.slice(0, 10).map((time, index) => ({
        time,
        value: values[index]
      }))
    });
  } catch (error) {
    return Response.json(
      {
        error: true,
        message: error.message,
        apiUrl
      },
      { status: 500 }
    );
  }
}
