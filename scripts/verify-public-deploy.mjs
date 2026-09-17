import { readFile } from "node:fs/promises";

const publicUrl = "https://hejja-okofarm.hu/";
const hostname = new URL(publicUrl).hostname;
const workerRoutePattern = `${hostname}/*`;
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
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
