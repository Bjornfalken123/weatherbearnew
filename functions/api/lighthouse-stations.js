const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 timmar
const CACHE_KEY = "https://weatherbear-cache.local/api/lighthouse-stations";

const PARAMS = {
  temp: 1,
  windDir: 3,
  windSpeed: 4,
  pressure: 9,
  gust: 21
};

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function normalizeName(item) {
  return (
    item.name ||
    item.stationName ||
    item.station_name ||
    item.title ||
    "Okänd station"
  );
}

function normalizeLat(item) {
  const values = [
    item.latitude,
    item.lat,
    item.position?.latitude,
    item.position?.lat,
    item.summary?.position?.latitude
  ];

  for (const value of values) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }

  return NaN;
}

function normalizeLon(item) {
  const values = [
    item.longitude,
    item.lon,
    item.position?.longitude,
    item.position?.lon,
    item.summary?.position?.longitude
  ];

  for (const value of values) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }

  return NaN;
}

function extractStations(data) {
  if (Array.isArray(data?.station)) return data.station;
  if (Array.isArray(data?.stations)) return data.stations;
  if (Array.isArray(data?.resource)) return data.resource;
  return [];
}

function extractValues(data) {
  if (Array.isArray(data?.value)) return data.value;
  if (Array.isArray(data?.values)) return data.values;
  return [];
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`SMHI returned ${response.status} for ${url}`);
  }

  return response.json();
}

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

  const freshData = await fetchFreshLighthouseStations();

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshLighthouseStations() {
  const headers = {
    "User-Agent": "weather-dashboard/1.0 bjorn.falkenang@gmail.com"
  };

  const stationUrls = Object.values(PARAMS).map(
    (param) =>
      `https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/${param}.json`
  );

  const latestHourUrls = Object.values(PARAMS).map(
    (param) =>
      `https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/${param}/station-set/all/period/latest-hour/data.json`
  );

  const stationResults = await Promise.allSettled(
    stationUrls.map((url) => fetchJson(url, headers))
  );

  const latestResults = await Promise.allSettled(
    latestHourUrls.map((url) => fetchJson(url, headers))
  );

  const stationMap = new Map();

  stationResults.forEach((result) => {
    if (result.status !== "fulfilled") return;

    const stations = extractStations(result.value);

    stations.forEach((station) => {
      const id = normalizeId(
        station.id ?? station.key ?? station.stationId ?? station.station
      );

      const lat = normalizeLat(station);
      const lon = normalizeLon(station);

      if (!id || Number.isNaN(lat) || Number.isNaN(lon)) return;

      if (!stationMap.has(id)) {
        stationMap.set(id, {
          id,
          name: normalizeName(station),
          latitude: lat,
          longitude: lon,
          hasCurrentWind: false
        });
      }
    });
  });

  const activeIds = new Set();

  latestResults.forEach((result) => {
    if (result.status !== "fulfilled") return;

    const values = extractValues(result.value);

    values.forEach((item) => {
      const id = normalizeId(
        item.station ?? item.stationId ?? item.id ?? item.key
      );

      if (id) activeIds.add(id);
    });
  });

  for (const [id, station] of stationMap.entries()) {
    station.hasCurrentWind = activeIds.has(id);
    stationMap.set(id, station);
  }

  const stations = Array.from(stationMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "sv")
  );

  return {
    stations
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
