import { readFile } from "node:fs/promises";
import ts from "typescript";

const publicUrl = "https://hejja-okofarm.hu/";
const hostname = new URL(publicUrl).hostname;
const workerRoutePattern = `${hostname}/*`;

// A wrangler.jsonc JSONC (JSON + sor- és blokk-kommentek), nem sima JSON -
// ezt eddig a sima JSON.parse() figyelmen kívül hagyta, ami a kommentek
// miatt "SyntaxError: Expected double-quoted property name" hibát dobott.
// A projekt sem a wrangler, sem egy önálló jsonc csomagot nem telepíti
// közvetlenül használható formában - a TypeScript (már meglévő
// devDependency) viszont ugyanezt a JSONC-dialektust (comments + trailing
// comma a tsconfig.json-ban is megszokott) hivatalos, publikus API-val tudja
// feloldani, új csomag bevezetése és a wrangler.jsonc tartalmának (pl. a
// kommentek) módosítása nélkül.
const wranglerJsoncText = await readFile("wrangler.jsonc", "utf8");
const { config, error } = ts.parseConfigFileTextToJson("wrangler.jsonc", wranglerJsoncText);

if (error) {
  throw new Error(
    `A wrangler.jsonc nem valid JSONC: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
  );
}
const hasPublicRoute = config.routes?.some((route) =>
  typeof route === "string"
    ? route === workerRoutePattern
    : route.custom_domain !== true && route.pattern === workerRoutePattern,
);

if (!hasPublicRoute) {
  throw new Error(
    `A wrangler.jsonc nem tartalmazza a ${hostname} Worker Route-ot (${workerRoutePattern}), a DNS externally managed, ezért Custom Domain helyett plain Worker Route szükséges.`,
  );
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);

try {
  const response = await fetch(publicUrl, {
    signal: controller.signal,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`A publikus domain HTTP ${response.status} választ adott.`);
  }

  console.log(`Public deploy verified: ${publicUrl} -> HTTP ${response.status}`);
} finally {
  clearTimeout(timeout);
}
