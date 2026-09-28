// start.mjs

import builder from "./index.mjs";
import pkg from "stremio-addon-sdk";
import express from "express";

const { serveHTTP } = pkg;

const PORT = process.env.PORT || 7001;

const app = express();

/*
 * Serve logo and background files.
 */

app.get("/logo.png", (req, res) => {
  res.sendFile(
    "logo.png",
    {
      root: process.cwd(),
    }
  );
});

app.get("/background.jpg", (req, res) => {
  res.sendFile(
    "background.jpg",
    {
      root: process.cwd(),
    }
  );
});

/*
 * Start Stremio addon server.
 */

const addonInterface =
  builder.getInterface();

serveHTTP(
  addonInterface,
  {
    port: PORT,
  }
);

console.log("");
console.log("========================================");
console.log("🎬 DIGITAL RELEASES ADDON");
console.log("========================================");
console.log("");
console.log(
  `✅ Running at http://localhost:${PORT}`
);
console.log("");
console.log(
  `📋 Manifest: http://localhost:${PORT}/manifest.json`
);
console.log("");
console.log(
  `🖼️ Logo: http://localhost:${PORT}/logo.png`
);
console.log("");
console.log(
  `🎬 Background: http://localhost:${PORT}/background.jpg`
);
console.log("");
