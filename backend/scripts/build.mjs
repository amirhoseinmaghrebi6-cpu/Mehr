// Production build of the API: type-check with tsc, then bundle src/server.ts into dist/server.js
// with esbuild. Workspace packages (@m2smart/contracts, published as TypeScript sources) are
// bundled in; npm dependencies stay external and are loaded from node_modules at runtime.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.entries(pkg.dependencies ?? {})
  .filter(([, version]) => !String(version).startsWith("workspace:"))
  .map(([name]) => name);

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external,
  logLevel: "info",
});
