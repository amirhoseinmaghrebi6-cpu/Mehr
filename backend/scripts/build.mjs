// Production build of the API: type-check with tsc, then bundle with esbuild src/server.ts into
// dist/server.js and the migration tool into dist/db/migrate.js (which, as from src/db, finds the
// SQL files three folders up). Everything is bundled in, npm packages too, so a server needs no
// node_modules.
import { build } from "esbuild";

await build({
  entryPoints: { server: "src/server.ts", "db/migrate": "src/db/migrate.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  // pg's optional native driver is never used.
  external: ["pg-native"],
  logLevel: "info",
});
