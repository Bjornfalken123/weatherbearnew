const CACHE_TTL_SECONDS = 2 * 60; // 2 minuter

function makeCacheKey(stationId) {
  return `https://weatherbear-cache.local/api/viva-station/${encodeURIComponent(
    stationId
  )}`;
}

async function getCachedResponse(context, stationId) {
  const cache = caches.default;
  const cacheRequest = new Request(makeCacheKey(stationId), {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshVivaStation(stationId);

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshVivaStation(stationId) {
  const url =
    "https://services.viva.sjofartsverket.se:8080/output/vivaoutputservice.svc/vivastation/" +
    encodeURIComponent(stationId);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "weather-dashboard/1.0 viva-station"
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
  const rawStation = data?.GetSingleStationResult || null;
  const samples = Array.isArray(rawStation?.Samples) ? rawStation.Samples : [];

  return {
    station: {
      ID: rawStation?.ID ?? stationId,
      Name: rawStation?.Name || "Okänd station",
      Lat: Number(rawStation?.Lat),
      Lon: Number(rawStation?.Lon),
      Samples: samples
    }
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const stationId = String(url.searchParams.get("stationId") || "").trim();

  if (!stationId) {
    return Response.json(
      {
        error: true,
        message: "stationId saknas"
      },
      { status: 400 }
    );
  }

  try {
    return await getCachedResponse(context, stationId);
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
