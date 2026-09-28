// index.mjs

import pkg from "stremio-addon-sdk";

const { addonBuilder } = pkg;

/*
 * ============================================================
 * CONFIGURATION
 * ============================================================
 */

const BASE_URL =
  "https://www.dvdsreleasedates.com";

const GITHUB_OWNER = "komals1";
const GITHUB_REPO =
  "stremio-digital-releases-addon";

const GITHUB_BRANCH = "main";

/*
 * IMPORTANT:
 * Never put your GitHub token directly in this file.
 *
 * Render:
 * GITHUB_TOKEN=your_token
 *
 * Local testing:
 * PowerShell:
 * $env:GITHUB_TOKEN="your_token"
 */

const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || "";

/*
 * GitHub API base.
 */

const GITHUB_API =
  "https://api.github.com";

/*
 * How often the CURRENT month may be refreshed.
 *
 * 2 days = 172800000 ms
 */

const CURRENT_MONTH_REFRESH_TIME =
  2 * 24 * 60 * 60 * 1000;

/*
 * ============================================================
 * MONTH NAMES
 * ============================================================
 */

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
 * CURRENT DATE
 * ============================================================
 */

function getCurrentDate() {
  return new Date();
}

/*
 * ============================================================
 * BUILD 25 RELEASE OPTIONS
 * ============================================================
 *
 * Current month + previous 24 months.
 */

function buildReleaseOptions() {
  const options = [];

  const now = getCurrentDate();

  const currentYear =
    now.getFullYear();

  const currentMonth =
    now.getMonth() + 1;

  for (
    let offset = 0;
    offset <= 24;
    offset++
  ) {
    const date = new Date(
      currentYear,
      currentMonth - 1 - offset,
      1
    );

    const year =
      date.getFullYear();

    const month =
      date.getMonth() + 1;

    options.push(
      `${year} ${MONTH_NAMES[
        month - 1
      ].slice(0, 3)}`
    );
  }

  return options;
}

const RELEASE_OPTIONS =
  buildReleaseOptions();

/*
 * ============================================================
 * MONTH HELPERS
 * ============================================================
 */

function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(
    2,
    "0"
  )}`;
}

function getDataPath(year, month) {
  return `data/${getMonthKey(
    year,
    month
  )}.json`;
}

function getPreviousMonth(year, month) {
  if (month === 1) {
    return {
      year: year - 1,
      month: 12,
    };
  }

  return {
    year,
    month: month - 1,
  };
}

function getNextMonth(year, month) {
  if (month === 12) {
    return {
      year: year + 1,
      month: 1,
    };
  }

  return {
    year,
    month: month + 1,
  };
}

/*
 * ============================================================
 * RELEASE OPTION PARSER
 * ============================================================
 */

function parseReleaseOption(option) {
  const match =
    option.match(
      /^(\d{4})\s+([A-Za-z]{3})$/
    );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);

  const monthShort =
    match[2].toLowerCase();

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
    return null;
  }

  return {
    year,
    month,
  };
}

/*
 * ============================================================
 * DVD RELEASE DATES URL
 * ============================================================
 */

function buildMonthUrl(year, month) {
  return `${BASE_URL}/digital-releases/${year}/${month}/`;
}

/*
 * ============================================================
 * FETCH DVD RELEASE DATES
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
      `DVDReleaseDates HTTP ${response.status} ${response.statusText}`
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
      (_, code) =>
        String.fromCharCode(
          Number(code)
        )
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
      .replace(
        /<[^>]+>/g,
        " "
      )
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

  const monthNumber =
    MONTH_LOOKUP[
      match[2].toLowerCase()
    ];

  if (!monthNumber) {
    return null;
  }

  return {
    dateText: match[0],
    monthName: match[2],
    day: Number(match[3]),
    year: Number(match[4]),
    month: monthNumber,
  };
}

/*
 * ============================================================
 * MOVIE CELL PARSER
 * ============================================================
 */

function parseMovieCell(
  movieHtml,
  releaseDate
) {
  /*
   * IMDb ID
   */

  const imdbMatch =
    movieHtml.match(
      /imdb\.com\/title\/(tt\d{7,9})/i
    );

  if (!imdbMatch) {
    console.log(
      "⚠️ No IMDb ID found"
    );

    return null;
  }

  const imdbId =
    imdbMatch[1].toLowerCase();

  /*
   * Movie title
   */

  let title = null;

  const linkRegex =
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch;

  while (
    (linkMatch =
      linkRegex.exec(movieHtml)) !==
    null
  ) {
    const linkText =
      stripHtml(linkMatch[1]);

    if (!linkText) {
      continue;
    }

    /*
     * Ignore rating numbers.
     */

    if (
      /^\d+(?:\.\d+)?$/.test(
        linkText
      )
    ) {
      continue;
    }

    /*
     * Ignore IMDb/trailer links.
     */

    if (
      linkText.toLowerCase() ===
        "imdb" ||
      linkText.toLowerCase() ===
        "trailer"
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
   * Poster
   */

  let poster = null;

  const posterMatch =
    movieHtml.match(
      /<img\b[^>]*src\s*=\s*['"]([^'"]+)['"]/i
    );

  if (posterMatch) {
    const posterUrl =
      decodeHtml(
        posterMatch[1]
      ).trim();

    if (
      posterUrl.startsWith(
        "http://"
      ) ||
      posterUrl.startsWith(
        "https://"
      )
    ) {
      poster = posterUrl;
    } else if (
      posterUrl.startsWith("/")
    ) {
      poster =
        `${BASE_URL}${posterUrl}`;
    } else {
      poster =
        `${BASE_URL}/${posterUrl}`;
    }
  }

  /*
   * Actual release date.
   *
   * Stored so we can sort explicitly.
   */

  const releaseDateIso =
    `${releaseDate.year}-${String(
      releaseDate.month
    ).padStart(2, "0")}-${String(
      releaseDate.day
    ).padStart(2, "0")}`;

  return {
    id: imdbId,
    type: "movie",
    name: title,
    poster,
    posterShape: "poster",
    releaseInfo: String(
      releaseDate.year
    ),

    /*
     * Internal fields.
     * These are removed before sending
     * the object to Stremio.
     */

    _releaseDate:
      releaseDateIso,

    _releaseTimestamp:
      new Date(
        releaseDate.year,
        releaseDate.month - 1,
        releaseDate.day
      ).getTime(),
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
  selectedMonth,
  isCurrentMonth
) {
  const movies = [];

  /*
   * Find all release date sections.
   */

  const releaseDateRegex =
    /<td\b[^>]*class=['"][^'"]*\breldate\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi;

  const releaseDates = [];

  let releaseMatch;

  while (
    (releaseMatch =
      releaseDateRegex.exec(html)) !==
    null
  ) {
    const dateText =
      stripHtml(
        releaseMatch[1]
      );

    const releaseDate =
      parseReleaseDate(
        dateText
      );

    if (!releaseDate) {
      continue;
    }

    if (
      releaseDate.year !==
      selectedYear
    ) {
      continue;
    }

    if (
      releaseDate.month !==
      selectedMonth
    ) {
      continue;
    }

    releaseDates.push({
      index:
        releaseMatch.index,

      endIndex:
        releaseDateRegex.lastIndex,

      date: releaseDate,
    });
  }

  console.log(
    `📅 Release date sections found: ${releaseDates.length}`
  );

  /*
   * Today's date.
   *
   * We compare calendar dates rather than
   * exact timestamps.
   */

  const now =
    getCurrentDate();

  const todayYear =
    now.getFullYear();

  const todayMonth =
    now.getMonth() + 1;

  const todayDay =
    now.getDate();

  /*
   * YYYY-MM-DD number for easy comparison.
   */

  const todayNumber =
    todayYear * 10000 +
    todayMonth * 100 +
    todayDay;

  /*
   * Process each date section.
   */

  for (
    let i = 0;
    i < releaseDates.length;
    i++
  ) {
    const section =
      releaseDates[i];

    /*
     * If this is the current month,
     * do not include future dates.
     */

    const releaseDate =
      section.date;

    const releaseNumber =
      releaseDate.year * 10000 +
      releaseDate.month * 100 +
      releaseDate.day;

    if (
      isCurrentMonth &&
      releaseNumber > todayNumber
    ) {
      console.log(
        `⏭️ Skipping future date: ${releaseDate.dateText}`
      );

      continue;
    }

    const nextSection =
      releaseDates[i + 1]
        ?.index ??
      html.length;

    const sectionHtml =
      html.slice(
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
        movieStartRegex.exec(
          sectionHtml
        )) !== null
    ) {
      movieStarts.push(
        movieStartMatch.index
      );
    }

    console.log(
      `   📦 ${releaseDate.dateText} → ${movieStarts.length} movie cells`
    );

    /*
     * Parse each movie.
     */

    for (
      let j = 0;
      j < movieStarts.length;
      j++
    ) {
      const start =
        movieStarts[j];

      const end =
        movieStarts[j + 1] ??
        sectionHtml.length;

      const movieHtml =
        sectionHtml.slice(
          start,
          end
        );

      const movie =
        parseMovieCell(
          movieHtml,
          releaseDate
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
    if (
      seen.has(movie.id)
    ) {
      continue;
    }

    seen.add(movie.id);

    uniqueMovies.push(movie);
  }

  /*
   * ==========================================================
   * NEWEST RELEASE FIRST
   * ==========================================================
   */

  uniqueMovies.sort(
    (a, b) =>
      b._releaseTimestamp -
      a._releaseTimestamp
  );

  return uniqueMovies;
}

/*
 * ============================================================
 * CLEAN MOVIE FOR STREMIO
 * ============================================================
 */

function cleanMovie(movie) {
  const {
    _releaseDate,
    _releaseTimestamp,
    ...stremioMovie
  } = movie;

  return stremioMovie;
}

/*
 * ============================================================
 * GITHUB API HEADERS
 * ============================================================
 */

function githubHeaders() {
  if (!GITHUB_TOKEN) {
    throw new Error(
      "GITHUB_TOKEN environment variable is missing"
    );
  }

  return {
    Authorization:
      `Bearer ${GITHUB_TOKEN}`,

    Accept:
      "application/vnd.github+json",

    "X-GitHub-Api-Version":
      "2022-11-28",

    "User-Agent":
      "Digital-Releases-Stremio-Addon",
  };
}

/*
 * ============================================================
 * GET FILE FROM GITHUB
 * ============================================================
 */

async function getGitHubFile(
  path
) {
  const url =
    `${GITHUB_API}/repos/` +
    `${GITHUB_OWNER}/` +
    `${GITHUB_REPO}/contents/` +
    `${path}?ref=${encodeURIComponent(
      GITHUB_BRANCH
    )}`;

  const response =
    await fetch(url, {
      headers:
        githubHeaders(),
    });

  if (
    response.status === 404
  ) {
    return null;
  }

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `GitHub GET failed: ${response.status} ${text}`
    );
  }

  return await response.json();
}

/*
 * ============================================================
 * READ MONTH FROM GITHUB
 * ============================================================
 */

async function readMonthFromGitHub(
  year,
  month
) {
  const path =
    getDataPath(
      year,
      month
    );

  console.log(
    `📖 Reading GitHub cache: ${path}`
  );

  const file =
    await getGitHubFile(
      path
    );

  if (!file) {
    console.log(
      `📭 No GitHub cache found: ${path}`
    );

    return null;
  }

  /*
   * GitHub returns Base64.
   */

  const content =
    Buffer.from(
      file.content,
      "base64"
    ).toString("utf8");

  const data =
    JSON.parse(content);

  return {
    file,
    data,
  };
}

/*
 * ============================================================
 * WRITE MONTH TO GITHUB
 * ============================================================
 */

async function writeMonthToGitHub(
  year,
  month,
  data,
  existingSha = null
) {
  const path =
    getDataPath(
      year,
      month
    );

  const content =
    JSON.stringify(
      data,
      null,
      2
    );

  const encoded =
    Buffer.from(
      content,
      "utf8"
    ).toString("base64");

  const url =
    `${GITHUB_API}/repos/` +
    `${GITHUB_OWNER}/` +
    `${GITHUB_REPO}/contents/` +
    `${path}`;

  const body = {
    message:
      `Update digital releases ${getMonthKey(
        year,
        month
      )}`,

    content: encoded,

    branch:
      GITHUB_BRANCH,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  console.log(
    `💾 Saving GitHub cache: ${path}`
  );

  const response =
    await fetch(url, {
      method: "PUT",

      headers: {
        ...githubHeaders(),

        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify(body),
    });

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `GitHub PUT failed: ${response.status} ${text}`
    );
  }

  console.log(
    `✅ GitHub cache saved: ${path}`
  );
}

/*
 * ============================================================
 * SCRAPE A MONTH
 * ============================================================
 */

async function scrapeMonth(
  year,
  month
) {
  const url =
    buildMonthUrl(
      year,
      month
    );

  console.log("");
  console.log(
    `🌐 Scraping: ${url}`
  );

  const html =
    await fetchPage(url);

  /*
   * Determine whether this is
   * the current month.
   */

  const now =
    getCurrentDate();

  const isCurrentMonth =
    year ===
      now.getFullYear() &&
    month ===
      now.getMonth() + 1;

  const movies =
    extractMovies(
      html,
      year,
      month,
      isCurrentMonth
    );

  console.log(
    `🎬 Scraped ${movies.length} movies`
  );

  /*
   * Store the internal release date
   * in GitHub as well.
   *
   * This lets us sort correctly even
   * after reading the archive later.
   */

  const archiveData = {
    year,
    month,

    monthName:
      MONTH_NAMES[
        month - 1
      ],

    scrapedAt:
      new Date().toISOString(),

    movies,
  };

  return archiveData;
}

/*
 * ============================================================
 * GET MONTH DATA
 * ============================================================
 *
 * Rules:
 *
 * CURRENT MONTH:
 *   - Scrape if no cache exists.
 *   - Refresh every 2 days.
 *
 * PREVIOUS MONTH:
 *   - On/after the 2nd of the new month,
 *     perform one final scrape.
 *
 * OLDER MONTHS:
 *   - Never scrape again.
 */

async function getMonthData(
  year,
  month
) {
  const now =
    getCurrentDate();

  const currentYear =
    now.getFullYear();

  const currentMonth =
    now.getMonth() + 1;

  const currentDay =
    now.getDate();

  const isCurrentMonth =
    year === currentYear &&
    month === currentMonth;

  const previousMonth =
    getPreviousMonth(
      currentYear,
      currentMonth
    );

  const isPreviousMonth =
    year ===
      previousMonth.year &&
    month ===
      previousMonth.month;

  /*
   * Read existing GitHub archive.
   */

  const existing =
    await readMonthFromGitHub(
      year,
      month
    );

  /*
   * ==========================================================
   * CURRENT MONTH
   * ==========================================================
   */

  if (isCurrentMonth) {
    /*
     * No cache → scrape now.
     */

    if (!existing) {
      console.log(
        "🆕 Current month has no cache. Scraping..."
      );

      const data =
        await scrapeMonth(
          year,
          month
        );

      await writeMonthToGitHub(
        year,
        month,
        data
      );

      return data;
    }

    /*
     * Check when it was scraped.
     */

    const scrapedAt =
      new Date(
        existing.data.scrapedAt
      ).getTime();

    const age =
      Date.now() -
      scrapedAt;

    /*
     * Less than 2 days old.
     */

    if (
      age <
      CURRENT_MONTH_REFRESH_TIME
    ) {
      console.log(
        "💾 Current month cache is still fresh."
      );

      return existing.data;
    }

    /*
     * More than 2 days old.
     */

    console.log(
      "🔄 Current month cache is older than 2 days. Refreshing..."
    );

    const data =
      await scrapeMonth(
        year,
        month
      );

    await writeMonthToGitHub(
      year,
      month,
      data,
      existing.file.sha
    );

    return data;
  }

  /*
   * ==========================================================
   * PREVIOUS MONTH
   * ==========================================================
   */

  if (isPreviousMonth) {
    /*
     * Before the 2nd:
     *
     * If we have data, use it.
     * If not, scrape it.
     */

    if (currentDay < 2) {
      if (existing) {
        console.log(
          "📦 Previous month cache exists. Keeping it until finalization."
        );

        return existing.data;
      }

      console.log(
        "🆕 Previous month has no cache. Scraping..."
      );

      const data =
        await scrapeMonth(
          year,
          month
        );

      await writeMonthToGitHub(
        year,
        month,
        data
      );

      return data;
    }

    /*
     * On the 2nd or later:
     *
     * The previous month gets its
     * final scrape.
     *
     * We mark it finalized.
     */

    if (
      existing?.data?.finalized ===
      true
    ) {
      console.log(
        "🔒 Previous month is permanently finalized."
      );

      return existing.data;
    }

    console.log(
      "🔒 Finalizing previous month with one last scrape..."
    );

    const data =
      await scrapeMonth(
        year,
        month
      );

    data.finalized =
      true;

    data.finalizedAt =
      new Date().toISOString();

    await writeMonthToGitHub(
      year,
      month,
      data,
      existing?.file?.sha ??
        null
    );

    return data;
  }

  /*
   * ==========================================================
   * OLDER MONTHS
   * ==========================================================
   */

  if (existing) {
    console.log(
      "🔒 Older month found in permanent archive. No scraping."
    );

    return existing.data;
  }

  /*
   * This should normally only happen
   * for a month that was never archived.
   *
   * We scrape it once and permanently
   * save it.
   */

  console.log(
    "📦 Older month has no archive. Scraping once..."
  );

  const data =
    await scrapeMonth(
      year,
      month
    );

  data.finalized = true;

  data.finalizedAt =
    new Date().toISOString();

  await writeMonthToGitHub(
    year,
    month,
    data
  );

  return data;
}

/*
 * ============================================================
 * MANIFEST
 * ============================================================
 */

const manifest = {
  id:
    "com.digitalreleases.addon",

  version:
    "1.0.0",

  name:
    "Digital Releases",

  description:
    "Digital movie release calendar based on DVD Release Dates.",

  /*
   * Replace these two URLs with the actual
   * Render URLs for your uploaded files
   * after deployment.
   */

  logo:
    "https://YOUR-RENDER-URL/logo.png",

  background:
    "https://YOUR-RENDER-URL/background.jpg",

  resources: [
    "catalog",
  ],

  types: [
    "movie",
  ],

  catalogs: [
    {
      type: "movie",

      id:
        "digital-releases",

      name:
        "Digital Releases",

      pageSize: 100,

      extra: [
        {
          name:
            "genre",

          isRequired:
            false,

          options:
            RELEASE_OPTIONS,
        },

        {
          name:
            "skip",

          isRequired:
            false,
        },
      ],

      genres:
        RELEASE_OPTIONS,
    },
  ],
};

/*
 * ============================================================
 * ADDON BUILDER
 * ============================================================
 */

const builder =
  new addonBuilder(
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
      "📥 DIGITAL RELEASES REQUEST"
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
     * Default to current month.
     */

    const now =
      getCurrentDate();

    const defaultOption =
      `${now.getFullYear()} ${MONTH_NAMES[
        now.getMonth()
      ].slice(0, 3)}`;

    const releaseOption =
      args.extra?.genre ||
      defaultOption;

    console.log(
      "Selected:",
      releaseOption
    );

    /*
     * Parse selected month.
     */

    const parsed =
      parseReleaseOption(
        releaseOption
      );

    if (!parsed) {
      console.log(
        "⚠️ Invalid release option:",
        releaseOption
      );

      return {
        metas: [],
      };
    }

    const {
      year,
      month,
    } = parsed;

    /*
     * Make sure the user cannot request
     * a future month.
     */

    const currentYear =
      now.getFullYear();

    const currentMonth =
      now.getMonth() + 1;

    if (
      year >
        currentYear ||
      (
        year ===
          currentYear &&
        month >
          currentMonth
      )
    ) {
      console.log(
        "⏭️ Future month requested. Returning empty catalog."
      );

      return {
        metas: [],
      };
    }

    /*
     * Load month.
     */

    let monthData;

    try {
      monthData =
        await getMonthData(
          year,
          month
        );
    } catch (error) {
      console.error(
        "❌ Failed to load month:",
        error
      );

      return {
        metas: [],
      };
    }

    if (
      !monthData ||
      !Array.isArray(
        monthData.movies
      )
    ) {
      return {
        metas: [],
      };
    }

    /*
     * Sort newest first again.
     *
     * This protects us even if the GitHub
     * archive was created in a different order.
     */

    const movies =
      [...monthData.movies]
        .sort(
          (a, b) =>
            (
              b._releaseTimestamp ??
              0
            ) -
            (
              a._releaseTimestamp ??
              0
            )
        );

    /*
     * Stremio pagination.
     */

    const skip =
      Math.max(
        0,
        Number(
          args.extra?.skip ||
            0
        )
      );

    const pageSize = 100;

    const selectedMovies =
      movies.slice(
        skip,
        skip + pageSize
      );

    /*
     * Remove internal fields before
     * returning to Stremio.
     */

    const metas =
      selectedMovies.map(
        cleanMovie
      );

    console.log(
      `📦 Total movies: ${movies.length}`
    );

    console.log(
      `📄 Returning: ${metas.length}`
    );

    console.log(
      `⏭️ Skip: ${skip}`
    );

    console.log(
      "========================================"
    );

    return {
      metas,
    };
  }
);

/*
 * ============================================================
 * EXPORT
 * ============================================================
 */

export default builder;
