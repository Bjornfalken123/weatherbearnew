const CACHE_TTL_SECONDS = 5 * 60; // 5 minuter

function normalizeCoord(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return n.toFixed(4);
}

function makeCacheKey(lat, lon) {
  return `https://weatherbear-cache.local/api/openmeteo-gust/${encodeURIComponent(
    lat
  )}/${encodeURIComponent(lon)}`;
}

async function getCachedResponse(context, lat, lon) {
  const cache = caches.default;
  const cacheRequest = new Request(makeCacheKey(lat, lon), {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshOpenMeteoGust(lat, lon);

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshOpenMeteoGust(lat, lon) {
  const apiUrl =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    "&current=wind_gusts_10m" +
    "&hourly=wind_gusts_10m" +
    "&wind_speed_unit=ms" +
    "&timezone=auto" +
    "&forecast_days=7";

  const response = await fetch(apiUrl);
  const text = await response.text();

  if (!response.ok) {
    return {
      error: true,
      source: "Open-Meteo",
      status: response.status,
      body: text
    };
  }

  const data = JSON.parse(text);

  const currentValue = data?.current?.wind_gusts_10m ?? null;
  const currentTime = data?.current?.time ?? null;

  const times = data?.hourly?.time ?? [];
  const gusts = data?.hourly?.wind_gusts_10m ?? [];

  const timeseries = times.map((time, index) => ({
    time,
    value: gusts[index] ?? null
  }));

  return {
    value: currentValue,
    time: currentTime,
    timeseries,
    source: "Open-Meteo",
    unit: "m/s"
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const lat = normalizeCoord(url.searchParams.get("lat"));
  const lon = normalizeCoord(url.searchParams.get("lon"));

  if (!lat || !lon) {
    return Response.json(
      {
        error: true,
        message: "lat och lon krävs"
      },
      { status: 400 }
    );
  }

  try {
    return await getCachedResponse(context, lat, lon);
  } catch (error) {
    return Response.json(
      {
        error: true,
        message: error.message
      },
      { status: 500 }
    );
  }
}
