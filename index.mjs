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

/*
 * ============================================================
 * BUILD RELEASE OPTIONS AUTOMATICALLY
 * ============================================================
 *
 * Current month + previous 24 months.
 *
 * Example:
 *
 * 2026 Sep
 * 2026 Aug
 * 2026 Jul
 * ...
 * 2025 Jan
 * 2024 Dec
 * ...
 * 2024 Sep
 *
 * No need to manually add years or months.
 */

const RELEASE_OPTIONS = [];

const currentDate = new Date();

const currentYear = currentDate.getFullYear();
const currentMonth = currentDate.getMonth() + 1;

for (let offset = 0; offset <= 24; offset++) {
  const date = new Date(
    currentYear,
    currentMonth - 1 - offset,
    1
  );

  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  RELEASE_OPTIONS.push(
    `${year} ${MONTH_NAMES[month - 1].slice(0, 3)}`
  );
}

/*
 * ============================================================
 * CACHE
 * ============================================================
 */

const cache = new Map();

const CACHE_TIME = 6 * 60 * 60 * 1000; // 6 hours
const STALE_TIME = 24 * 60 * 60 * 1000; // 24 hours

/*
 * ============================================================
 * URL
 * ============================================================
 */

function buildMonthUrl(year, month) {
  return `${BASE_URL}/digital-releases/${year}/${month}/`;
}

/*
 * ============================================================
 * FETCH PAGE
 * ============================================================
 */

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

/*
 * ============================================================
 * HTML HELPERS
 * ============================================================
 */

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(
      /&#(\d+);/g,
      (_, code) => String.fromCharCode(Number(code))
    );
}

function stripHtml(text) {
  return decodeHtml(
    text
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        ""
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        ""
      )
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * ============================================================
 * RELEASE DATE PARSER
 * ============================================================
 */

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

/*
 * ============================================================
 * MOVIE CELL PARSER
 * ============================================================
 */

function parseMovieCell(movieHtml, releaseDate) {
  /*
   * Find IMDb ID
   *
   * Example:
   * http://www.imdb.com/title/tt33070884/
   */

  const imdbMatch = movieHtml.match(
    /imdb\.com\/title\/(tt\d{7,9})/i
  );

  if (!imdbMatch) {
    console.log("⚠️ No IMDb ID found in movie cell");
    return null;
  }

  const imdbId = imdbMatch[1].toLowerCase();

  /*
   * Find movie title
   */

  let title = null;

  const linkRegex =
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch;

  while (
    (linkMatch = linkRegex.exec(movieHtml)) !== null
  ) {
    const linkText = stripHtml(linkMatch[1]);

    if (!linkText) {
      continue;
    }

    /*
     * Ignore IMDb rating numbers.
     */

    if (/^\d+(?:\.\d+)?$/.test(linkText)) {
      continue;
    }

    /*
     * Ignore unwanted link labels.
     */

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

  /*
   * Find poster
   */

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

  /*
   * Stremio catalog item
   */

  return {
    id: imdbId,
    type: "movie",
    name: title,
    poster,
    posterShape: "poster",
    releaseInfo: String(releaseDate.year),
  };
}

/*
 * ============================================================
 * EXTRACT MOVIES
 * ============================================================
 */

function extractMovies(
  html,
  selectedYear,
  selectedMonth
) {
  const movies = [];

  /*
   * Find release date sections.
   */

  const releaseDateRegex =
    /<td\b[^>]*class=['"][^'"]*\breldate\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi;

  const releaseDates = [];

  let releaseMatch;

  while (
    (releaseMatch =
      releaseDateRegex.exec(html)) !== null
  ) {
    const dateText = stripHtml(
      releaseMatch[1]
    );

    const releaseDate =
      parseReleaseDate(dateText);

    if (!releaseDate) {
      continue;
    }

    /*
     * Only selected year.
     */

    if (releaseDate.year !== selectedYear) {
      continue;
    }

    /*
     * Only selected month.
     */

    const monthNumber =
      MONTH_LOOKUP[
        releaseDate.monthName.toLowerCase()
      ];

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

  /*
   * Process each release date section.
   */

  for (
    let i = 0;
    i < releaseDates.length;
    i++
  ) {
    const section = releaseDates[i];

    const nextSection =
      releaseDates[i + 1]?.index ??
      html.length;

    const sectionHtml = html.slice(
      section.endIndex,
      nextSection
    );

    /*
     * Find movie cells.
     */

    const movieStartRegex =
      /<td\b[^>]*class=['"][^'"]*\bdvdcell\b[^'"]*['"][^>]*>/gi;

    const movieStarts = [];

    let movieStartMatch;

    while (
      (movieStartMatch =
        movieStartRegex.exec(sectionHtml)) !==
      null
    ) {
      movieStarts.push(
        movieStartMatch.index
      );
    }

    console.log(
      `   📦 ${section.date.dateText} → ${movieStarts.length} movie cells`
    );

    /*
     * Parse each movie.
     */

    for (
      let j = 0;
      j < movieStarts.length;
      j++
    ) {
      const start = movieStarts[j];

      const end =
        movieStarts[j + 1] ??
        sectionHtml.length;

      const movieHtml = sectionHtml.slice(
        start,
        end
      );

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

  /*
   * Remove duplicate IMDb IDs.
   */

  const uniqueMovies = [];

  const seen = new Set();

  for (const movie of movies) {
    if (seen.has(movie.id)) {
      continue;
    }

    seen.add(movie.id);

    uniqueMovies.push(movie);
  }
uniqueMovies.reverse();
  return uniqueMovies;
}

/*
 * ============================================================
 * LOAD MONTH
 * ============================================================
 */

async function loadMonth(year, month) {
  const key = `${year}-${month}`;

  const cached = cache.get(key);

  /*
   * Fresh cache.
   */

  if (
    cached &&
    Date.now() - cached.timestamp <
      CACHE_TIME
  ) {
    console.log(
      `💾 Cache hit: ${year}-${month}`
    );

    return cached.movies;
  }

  /*
   * Try fresh scrape.
   */

  try {
    const movies = await refreshMonth(
      year,
      month
    );

    return movies;
  } catch (error) {
    console.error(
      `❌ Failed to refresh ${year}-${month}:`,
      error.message
    );

    /*
     * Use stale cache if available.
     */

    if (
      cached &&
      Date.now() - cached.timestamp <
        STALE_TIME
    ) {
      console.log(
        `♻️ Using stale cache: ${year}-${month}`
      );

      return cached.movies;
    }

    /*
     * No usable cache.
     */

    throw error;
  }
}

/*
 * ============================================================
 * REFRESH MONTH
 * ============================================================
 */

async function refreshMonth(
  year,
  month
) {
  const key = `${year}-${month}`;

  const url = buildMonthUrl(
    year,
    month
  );

  console.log("");
  console.log(
    `🌐 Fetching: ${url}`
  );

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
    `✅ ${year}-${month}: ${movies.length} movies`
  );

  return movies;
}

/*
 * ============================================================
 * MANIFEST
 * ============================================================
 */

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

      pageSize: 100,

      /*
       * Stremio will display these as the
       * selector options.
       *
       * Example:
       * 2026 Sep
       * 2026 Aug
       * 2026 Jul
       * ...
       */

      extra: [
        {
          name: "genre",

          isRequired: false,

          options: RELEASE_OPTIONS,
        },

        /*
         * Keep skip for normal Stremio
         * pagination.
         */

        {
          name: "skip",

          isRequired: false,
        },
      ],

      /*
       * This matches the structure used by
       * working Stremio addons such as
       * the Top Seeded addon.
       */

      genres: RELEASE_OPTIONS,
    },
  ],
};

/*
 * ============================================================
 * ADDON BUILDER
 * ============================================================
 */

const builder = new addonBuilder(
  manifest
);

/*
 * ============================================================
 * CATALOG HANDLER
 * ============================================================
 */

builder.defineCatalogHandler(
  async (args) => {
    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "📥 CATALOG REQUEST"
    );

    console.log(
      "========================================"
    );

    console.log(
      "Type:",
      args.type
    );

    console.log(
      "Catalog:",
      args.id
    );

    console.log(
      "Extra:",
      args.extra
    );

    /*
     * Default = current month.
     */

    const defaultOption =
      `${currentYear} ${MONTH_NAMES[
        currentMonth - 1
      ].slice(0, 3)}`;

    /*
     * Read selected genre.
     *
     * Example:
     * "2026 Sep"
     */

    const releaseOption =
      args.extra?.genre ||
      defaultOption;

    console.log(
      "Selected release:",
      releaseOption
    );

    /*
     * Parse:
     *
     * 2026 Sep
     */

    const match =
      releaseOption.match(
        /^(\d{4})\s+([A-Za-z]{3})$/
      );

    if (!match) {
      console.log(
        "⚠️ Invalid release option:",
        releaseOption
      );

      return {
        metas: [],
      };
    }

    const year = Number(
      match[1]
    );

    const monthShort =
      match[2].toLowerCase();

    /*
     * Convert:
     *
     * Sep → 9
     * Aug → 8
     * Jul → 7
     * etc.
     */

    const month =
      MONTH_NAMES.findIndex(
        (name) =>
          name
            .slice(0, 3)
            .toLowerCase() ===
          monthShort
      ) + 1;

    if (
      !year ||
      month < 1 ||
      month > 12
    ) {
      console.log(
        "⚠️ Invalid year/month:",
        year,
        month
      );

      return {
        metas: [],
      };
    }

    console.log(
      `🔎 Loading releases for ${year}-${month}`
    );

    /*
     * Load the selected month.
     */

    let movies;

    try {
      movies = await loadMonth(
        year,
        month
      );
    } catch (error) {
      console.error(
        "❌ Catalog error:",
        error
      );

      return {
        metas: [],
      };
    }

    /*
     * Stremio pagination.
     */

    const skip = Math.max(
      0,
      Number(args.extra?.skip || 0)
    );

    const pageSize = 100;

    const paginatedMovies =
      movies.slice(
        skip,
        skip + pageSize
      );

    console.log(
      `📦 Total movies: ${movies.length}`
    );

    console.log(
      `📄 Returning: ${paginatedMovies.length}`
    );

    console.log(
      `⏭️ Skip: ${skip}`
    );

    /*
     * Return catalog.
     */

    return {
      metas: paginatedMovies,
    };
  }
);

/*
 * ============================================================
 * EXPORT
 * ============================================================
 */

export default builder;