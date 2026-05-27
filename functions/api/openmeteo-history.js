const CACHE_TTL_SECONDS = 60 * 60; // 1 timme

function normalizeCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4);
}

function normalizeDate(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function makeCacheKey(lat, lon, date) {
  return `https://weatherbear-cache.local/api/openmeteo-history/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(date)}`;
}

function offsetToString(seconds) {
  const n = Number(seconds || 0);
  const sign = n >= 0 ? "+" : "-";
  const abs = Math.abs(n);
  const hours = String(Math.floor(abs / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function weatherCodeToYrSymbol(code) {
  const c = Number(code);

  if (c === 0) return "clearsky";
  if (c === 1) return "fair";
  if (c === 2) return "partlycloudy";
  if (c === 3) return "cloudy";
  if (c === 45 || c === 48) return "fog";
  if (c === 51 || c === 53 || c === 55 || c === 56 || c === 57) return "lightrain";
  if (c === 61 || c === 80) return "lightrain";
  if (c === 63 || c === 81) return "rain";
  if (c === 65 || c === 82) return "heavyrain";
  if (c === 66 || c === 67 || c === 71 || c === 73 || c === 77 || c === 85) return "lightsnow";
  if (c === 75 || c === 86) return "snow";
  if (c === 95 || c === 96 || c === 99) return "rainshowers";

  return "cloudy";
}

async function fetchFreshHistory(lat, lon, date) {
  const hourly = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "weather_code",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m"
  ].join(",");

  const apiUrl =
    "https://historical-forecast-api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&start_date=${encodeURIComponent(date)}` +
    `&end_date=${encodeURIComponent(date)}` +
    `&hourly=${encodeURIComponent(hourly)}` +
    "&wind_speed_unit=ms" +
    "&timezone=auto";

  const response = await fetch(apiUrl);
  const text = await response.text();

  if (!response.ok) {
    return {
      error: true,
      source: "Open-Meteo Historical Forecast",
      status: response.status,
      body: text
    };
  }

  const data = JSON.parse(text);
  const offset = offsetToString(data.utc_offset_seconds);
  const h = data.hourly || {};
  const times = Array.isArray(h.time) ? h.time : [];

  const timeseries = times.map((time, index) => {
    const weatherCode = h.weather_code?.[index] ?? null;
    const precipitation = h.precipitation?.[index] ?? 0;

    return {
      time: `${time}${offset}`,
      data: {
        instant: {
          details: {
            air_temperature: h.temperature_2m?.[index] ?? null,
            apparent_temperature: h.apparent_temperature?.[index] ?? null,
            relative_humidity: h.relative_humidity_2m?.[index] ?? null,
            air_pressure_at_sea_level: h.pressure_msl?.[index] ?? null,
            wind_speed: h.wind_speed_10m?.[index] ?? null,
            wind_from_direction: h.wind_direction_10m?.[index] ?? null,
            wind_speed_of_gust: h.wind_gusts_10m?.[index] ?? null
          }
        },
        next_1_hours: {
          summary: {
            symbol_code: weatherCodeToYrSymbol(weatherCode)
          },
          details: {
            precipitation_amount: precipitation == null ? 0 : precipitation
          }
        }
      }
    };
  });

  return {
    source: "Open-Meteo Historical Forecast",
    date,
    timezone: data.timezone || null,
    properties: {
      timeseries
    }
  };
}

async function getCachedResponse(context, lat, lon, date) {
  const cache = caches.default;
  const cacheRequest = new Request(makeCacheKey(lat, lon, date), { method: "GET" });
  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshHistory(lat, lon, date);
  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));
  return response;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = normalizeCoord(url.searchParams.get("lat"));
  const lon = normalizeCoord(url.searchParams.get("lon"));
  const date = normalizeDate(url.searchParams.get("date"));

  if (!lat || !lon || !date) {
    return Response.json(
      { error: true, message: "lat, lon och date krävs" },
      { status: 400 }
    );
  }

  try {
    return await getCachedResponse(context, lat, lon, date);
  } catch (error) {
    return Response.json(
      { error: true, message: error.message },
      { status: 500 }
    );
  }
}
