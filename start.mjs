// start.mjs

import builder from "./index.mjs";

import pkg from "stremio-addon-sdk";

const { serveHTTP } = pkg;

const PORT = process.env.PORT || 7001;

serveHTTP(builder.getInterface(), {
  port: PORT,
});

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