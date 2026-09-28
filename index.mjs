// index.mjs

const BASE_URL = "https://www.dvdsreleasedates.com";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_LOOKUP = Object.fromEntries(
  MONTH_NAMES.map((name, index) => [
    name.toLowerCase(),
    index + 1,
  ])
);

// --------------------------------------------------
// Release options
// --------------------------------------------------

function buildReleaseOptions() {
  const options = [];

  // Current year through 2030
  for (let year = 2026; year <= 2030; year++) {
    for (const month of MONTH_NAMES) {
      options.push(`${year} ${month}`);
    }
  }

  return options;
}

const RELEASE_OPTIONS = buildReleaseOptions();

// --------------------------------------------------
// Cache
// --------------------------------------------------

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const STALE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const cache = new Map();

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function buildMonthUrl(year, month) {
  return `${BASE_URL}/digital-releases/${year}/${month}/`;
}

async function fetchPage(url) {
  console.log(`🌐 Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} while fetching ${url}`
    );
  }

  return await response.text();
}

function decodeHtml(value) {
  if (!value) return "";

  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function stripHtml(value) {
  if (!value) return "";

  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// --------------------------------------------------
// Release date parser
// --------------------------------------------------

function parseReleaseDate(value) {
  if (!value) return null;

  const clean = stripHtml(value);

  // Example:
  // Tuesday September 1, 2026

  const match = clean.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i
  );

  if (!match) return null;

  const monthName = match[1];
  const day = Number(match[2]);
  const year = Number(match[3]);

  const month = MONTH_LOOKUP[monthName.toLowerCase()];

  if (!month) return null;

  return {
    year,
    month,
    day,
    monthName,
  };
}

// --------------------------------------------------
// Movie parser
// --------------------------------------------------

function parseMovieCell(movieHtml, releaseDate) {
  const imdbMatch = movieHtml.match(
    /imdb\.com\/title\/(tt\d{7,9})/i
  );

  if (!imdbMatch) {
    console.log("⚠️ No IMDb ID found in movie cell");
    return null;
  }

  const imdbId = imdbMatch[1].toLowerCase();

  let title = null;

  const linkRegex =
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch;

  while ((linkMatch = linkRegex.exec(movieHtml)) !== null) {
    const linkText = stripHtml(linkMatch[1]);

    if (!linkText) continue;

    if (/^\d+(?:\.\d+)?$/.test(linkText)) {
      continue;
    }

    if (
      linkText.toLowerCase() === "imdb" ||
      linkText.toLowerCase() === "trailer"
    ) {
      continue;
    }

    title = linkText;
    break;
  }

  if (!title) {
    console.log(`⚠️ No title found for ${imdbId}`);
    return null;
  }

  let poster = null;

  const posterMatch = movieHtml.match(
    /<img\b[^>]*src\s*=\s*['"]([^'"]+)['"]/i
  );

  if (posterMatch) {
    const posterUrl = decodeHtml(
      posterMatch[1]
    ).trim();

    if (
      posterUrl.startsWith("http://") ||
      posterUrl.startsWith("https://")
    ) {
      poster = posterUrl;
    } else if (posterUrl.startsWith("/")) {
      poster = `${BASE_URL}${posterUrl}`;
    } else {
      poster = `${BASE_URL}/${posterUrl}`;
    }
  }

  return {
    id: imdbId,
    type: "movie",
    name: title,
    poster,
    posterShape: "poster",
    releaseInfo: String(releaseDate.year),
  };
}

// --------------------------------------------------
// Extract movies from page
// --------------------------------------------------

function extractMovies(html, selectedYear, selectedMonth) {
  const movies = [];
  const seen = new Set();

  // Find release-date sections.
  //
  // The site contains nested <td> elements, so we don't
  // try to match the entire td with a simple regex.
  const releaseDateRegex =
    /<td\b[^>]*class=['"][^'"]*\breldate\b[^'"]*['"][^>]*>/gi;

  const sections = [];

  let match;

  while (
    (match = releaseDateRegex.exec(html)) !== null
  ) {
    sections.push({
      start: match.index,
      tagStart: match.index,
    });
  }

  console.log(
    `📅 Release date sections found: ${sections.length}`
  );

  for (let i = 0; i < sections.length; i++) {
    const sectionStart = sections[i].start;

    const sectionEnd =
      i + 1 < sections.length
        ? sections[i + 1].start
        : html.length;

    const sectionHtml = html.slice(
      sectionStart,
      sectionEnd
    );

    const dateText = stripHtml(
      sectionHtml.slice(0, 1000)
    );

    const releaseDate =
      parseReleaseDate(dateText);

    if (!releaseDate) {
      console.log(
        "⚠️ Could not parse release date section"
      );
      continue;
    }

    if (
      releaseDate.year !== selectedYear ||
      releaseDate.month !== selectedMonth
    ) {
      continue;
    }

    // Find every dvdcell inside this release-date section.
    const movieStartRegex =
      /<td\b[^>]*class=['"][^'"]*\bdvdcell\b[^'"]*['"][^>]*>/gi;

    const movieStarts = [];

    let movieMatch;

    while (
      (movieMatch =
        movieStartRegex.exec(sectionHtml)) !== null
    ) {
      movieStarts.push(movieMatch.index);
    }

    console.log(
      `   📦 ${dateText.slice(0, 60)} → ${movieStarts.length} movie cells`
    );

    for (let j = 0; j < movieStarts.length; j++) {
      const movieStart = movieStarts[j];

      const movieEnd =
        j + 1 < movieStarts.length
          ? movieStarts[j + 1]
          : sectionHtml.length;

      const movieHtml = sectionHtml.slice(
        movieStart,
        movieEnd
      );

      const movie = parseMovieCell(
        movieHtml,
        releaseDate
      );

      if (!movie) continue;

      if (seen.has(movie.id)) {
        continue;
      }

      seen.add(movie.id);
      movies.push(movie);
    }
  }

  console.log(
    `🎬 Movies extracted: ${movies.length}`
  );

  return movies;
}

// --------------------------------------------------
// Cache handling
// --------------------------------------------------

async function loadMonth(year, month) {
  const key = `${year}-${month}`;

  const cached = cache.get(key);

  if (cached) {
    const age = Date.now() - cached.timestamp;

    if (age < CACHE_TTL) {
      console.log(
        `💾 Using fresh cache for ${key}`
      );

      return cached.movies;
    }

    if (age < STALE_TTL) {
      console.log(
        `💾 Using stale cache for ${key}`
      );

      // Refresh in background.
      refreshMonth(year, month).catch((error) => {
        console.error(
          `❌ Background refresh failed for ${key}:`,
          error.message
        );
      });

      return cached.movies;
    }
  }

  return await refreshMonth(year, month);
}

async function refreshMonth(year, month) {
  const key = `${year}-${month}`;
  const url = buildMonthUrl(year, month);

  try {
    const html = await fetchPage(url);

    const movies = extractMovies(
      html,
      year,
      month
    );

    cache.set(key, {
      timestamp: Date.now(),
      movies,
    });

    console.log(
      `✅ Returning ${movies.length} movies`
    );

    return movies;
  } catch (error) {
    console.error(
      `❌ Failed to load ${key}:`,
      error.message
    );

    // If we have old cache, use it.
    const cached = cache.get(key);

    if (cached) {
      console.log(
        `⚠️ Returning old cached data for ${key}`
      );

      return cached.movies;
    }

    throw error;
  }
}

// --------------------------------------------------
// Release option parser
// --------------------------------------------------

function parseReleaseOption(value) {
  if (!value) return null;

  const match = value.match(
    /^(\d{4})\s+(.+)$/i
  );

  if (!match) return null;

  const year = Number(match[1]);
  const monthName = match[2].trim();

  const month =
    MONTH_LOOKUP[monthName.toLowerCase()];

  if (!month) return null;

  return {
    year,
    month,
    monthName,
  };
}

// --------------------------------------------------
// Default release
// --------------------------------------------------

function getDefaultRelease() {
  const now = new Date();

  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    monthName:
      MONTH_NAMES[now.getMonth()],
  };
}

// --------------------------------------------------
// Manifest
// --------------------------------------------------

const manifest = {
  id: "com.digitalreleases.addon",
  version: "1.1.0",
  name: "Digital Releases",
  description:
    "Digital movie release calendar based on DVD Release Dates.",
  resources: ["catalog"],
  types: ["movie"],

  catalogs: [
    {
      type: "movie",
      id: "digital-releases",
      name: "Digital Releases",

      extra: [
        {
          name: "release",
          isRequired: false,
          options: RELEASE_OPTIONS,
        },

        {
          name: "search",
          isRequired: false,
        },

        {
          name: "skip",
          isRequired: false,
        },
      ],
    },
  ],
};

// --------------------------------------------------
// Catalog handler
// --------------------------------------------------

async function catalogHandler(args) {
  console.log("");
  console.log("========================================");
  console.log("📚 CATALOG REQUEST");
  console.log("========================================");

  console.log(
    "Extra:",
    JSON.stringify(args.extra || {})
  );

  let selectedRelease =
    args.extra?.release;

  let parsedRelease =
    parseReleaseOption(selectedRelease);

  // If no release filter was selected,
  // use the current month.
  if (!parsedRelease) {
    parsedRelease = getDefaultRelease();

    console.log(
      `📅 No release selected, using default: ${parsedRelease.year} ${parsedRelease.monthName}`
    );
  }

  const {
    year,
    month,
    monthName,
  } = parsedRelease;

  console.log(
    `📅 Selected release: ${year} ${monthName}`
  );

  if (!year || !month) {
    console.log(
      "⚠️ Invalid release selection"
    );

    return {
      metas: [],
    };
  }

  try {
    let movies = await loadMonth(
      year,
      month
    );

    // ------------------------------------------------
    // Search
    // ------------------------------------------------

    const search =
      args.extra?.search?.trim();

    if (search) {
      const searchLower =
        search.toLowerCase();

      movies = movies.filter((movie) =>
        movie.name
          .toLowerCase()
          .includes(searchLower)
      );

      console.log(
        `🔎 Search "${search}" → ${movies.length} movies`
      );
    }

    // ------------------------------------------------
    // Pagination
    // ------------------------------------------------

    const skip = Number(
      args.extra?.skip || 0
    );

    const pageSize = 100;

    movies = movies.slice(
      skip,
      skip + pageSize
    );

    console.log(
      `📦 Returning ${movies.length} movies`
    );

    return {
      metas: movies,
    };
  } catch (error) {
    console.error(
      "❌ Catalog error:",
      error
    );

    return {
      metas: [],
    };
  }
}

// --------------------------------------------------
// Stremio addon interface
// --------------------------------------------------

const builder = {
  manifest,

  getInterface() {
    return {
      manifest,

      async catalog(type, id, extra) {
        return await catalogHandler({
          type,
          id,
          extra,
        });
      },
    };
  },
};

export default builder;
