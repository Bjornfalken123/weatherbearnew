const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 timmar
const CACHE_KEY = "https://weatherbear-cache.local/api/viva-stations";

async function getCachedResponse(context) {
  const cache = caches.default;
  const cacheRequest = new Request(CACHE_KEY, {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshVivaStations();

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshVivaStations() {
  const url =
    "https://services.viva.sjofartsverket.se:8080/output/vivaoutputservice.svc/vivastation";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "weather-dashboard/1.0 viva-stations"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      error: true,
      source: "VIVA",
      status: response.status,
      body: text
    };
  }

  const data = JSON.parse(text);

  const stations = Array.isArray(data?.GetStationsResult?.Stations)
    ? data.GetStationsResult.Stations
    : [];

  const cleaned = stations
    .map((station) => {
      const id = String(station?.ID ?? "").trim();
      const latitude = Number(station?.Lat);
      const longitude = Number(station?.Lon);

      if (!id || Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return null;
      }

      return {
        id,
        name: station?.Name || "Okänd station",
        latitude,
        longitude
      };
    })
    .filter(Boolean);

  return {
    stations: cleaned
  };
}

export async function onRequestGet(context) {
  try {
    return await getCachedResponse(context);
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
