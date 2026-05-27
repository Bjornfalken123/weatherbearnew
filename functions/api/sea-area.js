export async function onRequest(context) {
  const { request } = context;

  try {
    const url = new URL(request.url);

    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const radiusKm = Number(url.searchParams.get("radiusKm") || 30);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return jsonResponse(
        {
          error: "lat och lon krävs"
        },
        400
      );
    }

    const baseUrl = url.origin;

    const vivaStationsData = await safeJson(`${baseUrl}/api/viva-stations`);

    const rawStations = Array.isArray(vivaStationsData?.stations)
      ? vivaStationsData.stations
      : Array.isArray(vivaStationsData)
        ? vivaStationsData
        : [];

    const vivaStations = rawStations
      .map(normalizeStation)
      .filter(Boolean);

    const nearbyStations = vivaStations
      .map((station) => ({
        ...station,
        distanceKm: distanceKm(lat, lon, station.latitude, station.longitude)
      }))
      .filter((station) => station.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    let waterTemp = null;
    let waveHeight = null;
    let waterLevel = null;
    let wind = null;
    let gust = null;

    const stationResults = [];

    for (const station of nearbyStations.slice(0, 8)) {
      try {
        const stationData = await safeJson(
          `${baseUrl}/api/viva-station?stationId=${encodeURIComponent(station.id)}`
        );

        const actualStationData = stationData?.station || stationData;

        const waterTempSample = extractVivaSample(actualStationData, [
          "Vattentemperatur",
          "Vatten Temperatur",
          "Ytvattentemperatur",
          "VattenTemp",
          "Water temperature",
          "Sea temperature"
        ]);

        const waveSample = extractVivaSample(actualStationData, [
          "Våghöjd"
        ]);

        const waterLevelSample = extractVivaSample(actualStationData, [
          "Vattenstånd"
        ]);

        const windSample = extractVivaSample(actualStationData, [
          "Vindhastighet",
          "Medelvind"
        ]);

        const gustSample = extractVivaSample(actualStationData, [
          "Byvind",
          "Vindby"
        ]);

        if (waterTemp == null && waterTempSample) waterTemp = waterTempSample.value;
        if (waveHeight == null && waveSample) waveHeight = waveSample.value;
        if (waterLevel == null && waterLevelSample) waterLevel = waterLevelSample.value;
        if (wind == null && windSample) wind = windSample.value;
        if (gust == null && gustSample) gust = gustSample.value;

        stationResults.push({
          id: station.id,
          name: station.name,
          type: "VIVA",
          source: "VIVA",
          latitude: station.latitude,
          longitude: station.longitude,
          distanceKm: station.distanceKm,
          hasWaterTemp: Boolean(waterTempSample),
          hasWaveHeight: Boolean(waveSample),
          hasWaterLevel: Boolean(waterLevelSample),
          hasWind: Boolean(windSample),
          hasGust: Boolean(gustSample)
        });
      } catch (error) {
        stationResults.push({
          id: station.id,
          name: station.name,
          type: "VIVA",
          source: "VIVA",
          latitude: station.latitude,
          longitude: station.longitude,
          distanceKm: station.distanceKm,
          error: true,
          message: error.message
        });
      }
    }

    let smhiWaterTempStation = null;

    if (waterTemp == null) {
      smhiWaterTempStation = await findNearestSmhiSeaTemperature(lat, lon, radiusKm);

      if (smhiWaterTempStation) {
        waterTemp = smhiWaterTempStation.value;

        stationResults.push({
          id: smhiWaterTempStation.id,
          name: smhiWaterTempStation.name,
          type: "SMHI Havstemperatur",
          source: "SMHI",
          latitude: smhiWaterTempStation.latitude,
          longitude: smhiWaterTempStation.longitude,
          distanceKm: smhiWaterTempStation.distanceKm,
          hasWaterTemp: true,
          hasWaveHeight: false,
          hasWaterLevel: false,
          hasWind: false,
          hasGust: false
        });
      }
    }

    return jsonResponse({
      lat,
      lon,
      radiusKm,

      stationCountTotal: vivaStations.length,
      stationCountNearby: nearbyStations.length,

      waterTemp,
      waveHeight,
      waterLevel,
      wind,
      gust,

      waterTempText: formatTemp(waterTemp),
      waveHeightText: formatWave(waveHeight),
      waterLevelText: formatWaterLevel(waterLevel),
      windText: formatWind(wind),
      gustText: formatWind(gust),

      waterTempSource: smhiWaterTempStation ? "SMHI" : waterTemp != null ? "VIVA" : null,

      stations: stationResults
    });
  } catch (error) {
    console.error("sea-area error", error);

    return jsonResponse(
      {
        error: "Kunde inte hämta havsområde",
        message: error.message
      },
      500
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function toRad(value) {
  return value * Math.PI / 180;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTemp(value) {
  return value == null ? "--" : `${Number(value).toFixed(1)} °C`;
}

function formatWave(value) {
  return value == null ? "--" : `${Number(value).toFixed(1)} m`;
}

function formatWaterLevel(value) {
  return value == null ? "--" : `${Number(value).toFixed(1)} cm`;
}

function formatWind(value) {
  return value == null ? "--" : `${Number(value).toFixed(1)} m/s`;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function extractNumericValue(value) {
  if (value == null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const match = String(value)
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/);

  if (!match) return null;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

async function safeJson(url) {
  const response = await fetch(url);
  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      text ||
      `Fel vid hämtning: ${url}`
    );
  }

  return data;
}

function normalizeStation(station) {
  const id = firstDefined(
    station.id,
    station.Id,
    station.ID,
    station.stationId,
    station.StationId,
    station.key
  );

  const name = firstDefined(
    station.name,
    station.Name,
    station.stationName,
    station.StationName
  );

  const latitude = Number(
    firstDefined(
      station.latitude,
      station.Latitude,
      station.lat,
      station.Lat
    )
  );

  const longitude = Number(
    firstDefined(
      station.longitude,
      station.Longitude,
      station.lon,
      station.lng,
      station.Lon,
      station.Lng
    )
  );

  if (!id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    id: String(id),
    name: name || "Okänd station",
    latitude,
    longitude
  };
}

function extractVivaSample(stationData, names) {
  const samples = Array.isArray(stationData?.Samples)
    ? stationData.Samples
    : Array.isArray(stationData?.samples)
      ? stationData.samples
      : [];

  for (const wantedName of names) {
    const sample = samples.find((item) => {
      const sampleName = firstDefined(item?.Name, item?.name);
      return sampleName === wantedName;
    });

    if (!sample) continue;

    const value = firstDefined(sample.Value, sample.value);
    const numericValue = extractNumericValue(value);

    if (numericValue == null) continue;

    return {
      name: firstDefined(sample.Name, sample.name),
      value: numericValue,
      updated: firstDefined(sample.Updated, sample.updated, sample.Time, sample.time)
    };
  }

  return null;
}

async function findNearestSmhiSeaTemperature(lat, lon, radiusKm) {
  const endpoints = [
    "https://opendata-download-ocobs.smhi.se/api/version/latest/parameter/5/station-set/all/period/latest-hour/data.json",
    "https://opendata-download-ocobs.smhi.se/api/version/latest/parameter/5/station-set/all/period/latest-day/data.json"
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await safeJson(endpoint);
      const observations = extractSmhiSeaTemperatureObservations(data);

      const nearby = observations
        .map((station) => ({
          ...station,
          distanceKm: distanceKm(lat, lon, station.latitude, station.longitude)
        }))
        .filter((station) => station.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);

      if (nearby.length) {
        return nearby[0];
      }
    } catch (error) {
      console.warn("SMHI havstemperatur kunde inte hämtas", error);
    }
  }

  return null;
}

function extractSmhiSeaTemperatureObservations(data) {
  const results = [];

  function walk(item) {
    if (!item) return;

    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }

    if (typeof item !== "object") return;

    const id = firstDefined(
      item.key,
      item.id,
      item.stationId,
      item.station?.key,
      item.station?.id
    );

    const name = firstDefined(
      item.name,
      item.stationName,
      item.station?.name,
      item.title
    );

    const latitude = Number(
      firstDefined(
        item.latitude,
        item.lat,
        item.Latitude,
        item.station?.latitude,
        item.station?.lat
      )
    );

    const longitude = Number(
      firstDefined(
        item.longitude,
        item.lon,
        item.lng,
        item.Longitude,
        item.station?.longitude,
        item.station?.lon,
        item.station?.lng
      )
    );

    const value = extractSmhiLatestValue(item);

    if (
      id &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      value != null
    ) {
      results.push({
        id: String(id),
        name: name || "SMHI havstemperatur",
        latitude,
        longitude,
        value
      });
    }

    for (const child of Object.values(item)) {
      if (child && typeof child === "object") {
        walk(child);
      }
    }
  }

  walk(data);

  const unique = new Map();

  for (const result of results) {
    const key = `${result.id}:${result.latitude}:${result.longitude}`;

    if (!unique.has(key)) {
      unique.set(key, result);
    }
  }

  return Array.from(unique.values());
}

function extractSmhiLatestValue(item) {
  if (!item || typeof item !== "object") return null;

  const directValue = firstDefined(item.value, item.Value);

  if (!Array.isArray(directValue)) {
    const numeric = extractNumericValue(directValue);
    if (numeric != null) return numeric;
  }

  const valueArrays = [
    item.value,
    item.values,
    item.Value,
    item.Values
  ].filter(Array.isArray);

  for (const values of valueArrays) {
    for (let i = values.length - 1; i >= 0; i--) {
      const entry = values[i];

      const numeric = extractNumericValue(
        firstDefined(
          entry?.value,
          entry?.Value,
          entry?.val,
          entry?.Val
        )
      );

      if (numeric != null) return numeric;
    }
  }

  return null;
}
