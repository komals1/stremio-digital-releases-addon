// index.mjs

import pkg from "stremio-addon-sdk";

const { addonBuilder } = pkg;

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

// Cache
const cache = new Map();

const CACHE_TIME = 6 * 60 * 60 * 1000;
const STALE_TIME = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// URL
// ------------------------------------------------------------

function buildMonthUrl(year, month) {
  return `${BASE_URL}/digital-releases/${year}/${month}/`;
}

// ------------------------------------------------------------
// Fetch
// ------------------------------------------------------------

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  return await response.text();
}

// ------------------------------------------------------------
// HTML helpers
// ------------------------------------------------------------

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number(code))
    );
}

function stripHtml(text) {
  return decodeHtml(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------
// Release date parser
// ------------------------------------------------------------

function parseReleaseDate(text) {
  const match = text.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/i
  );

  if (!match) {
    return null;
  }

  return {
    dateText: match[0],
    monthName: match[2],
    day: Number(match[3]),
    year: Number(match[4]),
  };
}

// ------------------------------------------------------------
// Parse one movie
// ------------------------------------------------------------


function parseMovieCell(movieHtml, releaseDate) {
  // ----------------------------------------------------------
  // IMDb ID
  // ----------------------------------------------------------

  const imdbMatch = movieHtml.match(
    /imdb\.com\/title\/(tt\d{7,9})/i
  );

  if (!imdbMatch) {
    console.log("⚠️ No IMDb ID found in movie cell");
    return null;
  }

  const imdbId = imdbMatch[1].toLowerCase();

  // ----------------------------------------------------------
  // Movie title
  // ----------------------------------------------------------

  let title = null;

  // The DVD Release Dates site has movie links like:
  //
  // <a href='/movies/12812/the-brink-of-war'>
  //   The Brink of War
  // </a>
  //
  // Instead of depending on the exact URL, find the first
  // meaningful link containing text.

  const linkRegex =
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch;

  while ((linkMatch = linkRegex.exec(movieHtml)) !== null) {
    const linkText = stripHtml(linkMatch[1]);

    if (!linkText) {
      continue;
    }

    // Ignore the IMDb rating link.
    if (/^\d+(?:\.\d+)?$/.test(linkText)) {
      continue;
    }

    // Ignore common navigation/link text.
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
    console.log(
      `⚠️ No title found for ${imdbId}`
    );
    return null;
  }

  // ----------------------------------------------------------
  // Poster
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // Result
  // ----------------------------------------------------------

  return {
    id: imdbId,
    type: "movie",
    name: title,
    poster,
    posterShape: "poster",
    releaseInfo: String(releaseDate.year),
  };
}


// ------------------------------------------------------------
// Extract movies
// ------------------------------------------------------------

function extractMovies(html, selectedYear, selectedMonth) {
  const movies = [];

  // Find release-date cells.
  //
  // Example:
  // <td class='reldate past'>
  // Tuesday September 1, 2026
  // </td>
  const releaseDateRegex =
    /<td\b[^>]*class=['"][^'"]*\breldate\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi;

  const releaseDates = [];

  let releaseMatch;

  while ((releaseMatch = releaseDateRegex.exec(html)) !== null) {
    const dateText = stripHtml(releaseMatch[1]);
    const releaseDate = parseReleaseDate(dateText);

    if (!releaseDate) {
      continue;
    }

    if (releaseDate.year !== selectedYear) {
      continue;
    }

    const monthNumber =
      MONTH_LOOKUP[releaseDate.monthName.toLowerCase()];

    if (monthNumber !== selectedMonth) {
      continue;
    }

    releaseDates.push({
      index: releaseMatch.index,
      endIndex: releaseDateRegex.lastIndex,
      date: releaseDate,
    });
  }

  console.log(
    `📅 Release date sections found: ${releaseDates.length}`
  );

  // Process each release-date section.
  for (let i = 0; i < releaseDates.length; i++) {
    const section = releaseDates[i];

    const nextSection =
      releaseDates[i + 1]?.index ?? html.length;

    const sectionHtml = html.slice(
      section.endIndex,
      nextSection
    );

    // Find every dvdcell start.
    const movieStartRegex =
      /<td\b[^>]*class=['"][^'"]*\bdvdcell\b[^'"]*['"][^>]*>/gi;

    const movieStarts = [];

    let movieStartMatch;

    while (
      (movieStartMatch = movieStartRegex.exec(sectionHtml)) !==
      null
    ) {
      movieStarts.push(movieStartMatch.index);
    }

    console.log(
      `   📦 ${section.date.dateText} → ${movieStarts.length} movie cells`
    );

    // Extract each movie cell by slicing from one dvdcell
    // to the next dvdcell.
    for (let j = 0; j < movieStarts.length; j++) {
      const start = movieStarts[j];

      const end =
        movieStarts[j + 1] ?? sectionHtml.length;

      const movieHtml = sectionHtml.slice(start, end);

      const movie = parseMovieCell(
        movieHtml,
        section.date
      );

      if (!movie) {
        continue;
      }

      movies.push(movie);
    }
  }

  // Remove duplicate IMDb IDs.
  const uniqueMovies = [];
  const seen = new Set();

  for (const movie of movies) {
    if (seen.has(movie.id)) {
      continue;
    }

    seen.add(movie.id);
    uniqueMovies.push(movie);
  }

  return uniqueMovies;
}

// ------------------------------------------------------------
// Load month
// ------------------------------------------------------------

async function loadMonth(year, month) {
  const cacheKey = `${year}-${month}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);

  if (cached) {
    const age = now - cached.timestamp;

    if (age < CACHE_TIME) {
      console.log(
        `💾 Using cached data for ${year}-${String(month).padStart(
          2,
          "0"
        )}`
      );

      return cached.movies;
    }

    if (age < STALE_TIME) {
      console.log(
        `💾 Using stale cache for ${year}-${String(month).padStart(
          2,
          "0"
        )}`
      );

      // Refresh in background.
      refreshMonth(year, month).catch((error) => {
        console.error(
          "⚠️ Background refresh failed:",
          error.message
        );
      });

      return cached.movies;
    }
  }

  return await refreshMonth(year, month);
}

// ------------------------------------------------------------
// Refresh month
// ------------------------------------------------------------

async function refreshMonth(year, month) {
  const url = buildMonthUrl(year, month);

  console.log("");
  console.log(`📀 Loading: ${url}`);

  const html = await fetchPage(url);

  console.log(`📄 HTML size: ${html.length} characters`);

  const movies = extractMovies(
    html,
    year,
    month
  );

  console.log(`🎬 Movies extracted: ${movies.length}`);

  cache.set(`${year}-${month}`, {
    timestamp: Date.now(),
    movies,
  });

  return movies;
}

// ------------------------------------------------------------
// Manifest
// ------------------------------------------------------------

const manifest = {
  id: "com.digitalreleases.addon",
  version: "1.0.0",
  name: "Digital Releases",
  description:
    "Digital movie release calendar based on DVD Release Dates.",

  resources: [
    "catalog",
  ],

  types: [
    "movie",
  ],

  catalogs: [
    {
      type: "movie",
      id: "digital-releases",
      name: "Digital Releases",

      extra: [
        {
          name: "year",
          isRequired: true,
          options: [
            "2026",
            "2027",
            "2028",
            "2029",
            "2030",
          ],
        },

        {
          name: "month",
          isRequired: true,
          options: MONTH_NAMES,
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

// ------------------------------------------------------------
// Addon
// ------------------------------------------------------------

const builder = new addonBuilder(manifest);

// ------------------------------------------------------------
// Catalog handler
// ------------------------------------------------------------

builder.defineCatalogHandler(async (args) => {
  console.log("");
  console.log("========================================");
  console.log("📺 CATALOG REQUEST");
  console.log("========================================");

  console.log("Type:", args.type);
  console.log("ID:", args.id);
  console.log("Extra:", args.extra);

  const year = Number(args.extra?.year);

  const monthName =
    args.extra?.month || "January";

  const month =
    MONTH_LOOKUP[monthName.toLowerCase()];

  console.log(
    `📅 Selected: ${year}-${String(month).padStart(2, "0")}`
  );

  if (!year || !month) {
    console.log("❌ Invalid year or month");

    return {
      metas: [],
    };
  }

  try {
    let movies = await loadMonth(
      year,
      month
    );

    // Search support
    const search =
      args.extra?.search?.trim().toLowerCase();

    if (search) {
      movies = movies.filter((movie) =>
        movie.name
          .toLowerCase()
          .includes(search)
      );
    }

    // Pagination
    const skip = Number(
      args.extra?.skip || 0
    );

    const pageSize = 100;

    movies = movies.slice(
      skip,
      skip + pageSize
    );

    console.log(
      `✅ Returning ${movies.length} movies`
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
});

export default builder;