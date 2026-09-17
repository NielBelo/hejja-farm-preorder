import { readFile } from "node:fs/promises";

const publicUrl = "https://hejja-okofarm.hu/";
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const hasPublicRoute = config.routes?.some(
  (route) => route.custom_domain === true && route.pattern === "hejja-okofarm.hu",
);

if (!hasPublicRoute) {
  throw new Error(
    `A wrangler.jsonc nem tartalmazza a ${new URL(publicUrl).hostname} custom domain route-ot.`,
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
