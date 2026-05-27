const CACHE_TTL_SECONDS = 2 * 60; // 2 minuter

const PARAMS = {
  temp: 1,
  windDir: 3,
  windSpeed: 4,
  pressure: 9,
  gust: 21
};

function makeCacheKey(stationId) {
  return `https://weatherbear-cache.local/api/lighthouse-observations/${encodeURIComponent(
    stationId
  )}`;
}

function extractLatest(data) {
  if (Array.isArray(data?.value) && data.value.length > 0) {
    return data.value[data.value.length - 1];
  }

  if (Array.isArray(data?.values) && data.values.length > 0) {
    return data.values[data.values.length - 1];
  }

  return null;
}

async function fetchLatestForParam(paramId, stationId, headers) {
  for (const period of ["latest-hour", "latest-day"]) {
    const url =
      `https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/${paramId}` +
      `/station/${encodeURIComponent(stationId)}` +
      `/period/${encodeURIComponent(period)}` +
      `/data.json`;

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const latest = extractLatest(data);

      if (
        latest &&
        latest.value !== undefined &&
        latest.value !== null &&
        latest.value !== ""
      ) {
        return {
          value: latest.value,
          date: latest.date ?? null,
          time: latest.time ?? null,
          quality: latest.quality ?? null,
          period
        };
      }
    } catch (error) {
      continue;
    }
  }

  return null;
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

  const freshData = await fetchFreshLighthouseObservations(stationId);

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshLighthouseObservations(stationId) {
  const headers = {
    "User-Agent": "weather-dashboard/1.0 bjorn.falkenang@gmail.com"
  };

  const [temp, windDir, windSpeed, pressure, gust] = await Promise.all([
    fetchLatestForParam(PARAMS.temp, stationId, headers),
    fetchLatestForParam(PARAMS.windDir, stationId, headers),
    fetchLatestForParam(PARAMS.windSpeed, stationId, headers),
    fetchLatestForParam(PARAMS.pressure, stationId, headers),
    fetchLatestForParam(PARAMS.gust, stationId, headers)
  ]);

  return {
    stationId,
    observations: {
      temp,
      windDir,
      windSpeed,
      pressure,
      gust
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
        message: "stationId krävs"
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
