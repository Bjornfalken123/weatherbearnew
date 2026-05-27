const INDEX_URL =
  "https://data-download.smhi.se/data/oceanography/observation-forecast/";

export async function onRequestGet() {
  try {
    const indexResponse = await fetch(INDEX_URL, {
      headers: {
        "User-Agent": "weatherbear/1.0 bjornfalkenang@gmail.com"
      }
    });

    const indexText = await indexResponse.text();

    if (!indexResponse.ok) {
      return Response.json(
        {
          error: true,
          step: "index",
          status: indexResponse.status,
          body: indexText.slice(0, 1000)
        },
        { status: 500 }
      );
    }

    const forecastFiles = Array.from(
      indexText.matchAll(/SEALEVEL_NEMO_FCST_48H_\d+\.csv/g)
    )
      .map((match) => match[0])
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort();

    const observationFiles = Array.from(
      indexText.matchAll(/SEALEVEL_NEMO_OBS_48H_\d+\.csv/g)
    )
      .map((match) => match[0])
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort();

    const latestForecastFile = forecastFiles[forecastFiles.length - 1] || null;
    const latestObservationFile =
      observationFiles[observationFiles.length - 1] || null;

    if (!latestForecastFile) {
      return Response.json(
        {
          error: true,
          message: "Ingen SEALEVEL_NEMO_FCST_48H-fil hittades.",
          forecastFiles,
          observationFiles
        },
        { status: 404 }
      );
    }

    const forecastUrl = INDEX_URL + latestForecastFile;

    const forecastResponse = await fetch(forecastUrl, {
      headers: {
        "User-Agent": "weatherbear/1.0 bjornfalkenang@gmail.com"
      }
    });

    const forecastText = await forecastResponse.text();

    if (!forecastResponse.ok) {
      return Response.json(
        {
          error: true,
          step: "forecast_csv",
          status: forecastResponse.status,
          forecastUrl,
          body: forecastText.slice(0, 1000)
        },
        { status: 500 }
      );
    }

    const lines = forecastText
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 30);

    return Response.json({
      ok: true,
      latestForecastFile,
      latestObservationFile,
      forecastUrl,
      forecastLineCount: forecastText.split(/\r?\n/).length,
      firstLines: lines,
      forecastFiles: forecastFiles.slice(-5),
      observationFiles: observationFiles.slice(-5)
    });
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
