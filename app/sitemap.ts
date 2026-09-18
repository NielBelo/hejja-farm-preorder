import type { MetadataRoute } from "next";

const BASE_URL = "https://hejja-okofarm.hu";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      changeFrequency: "yearly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/privacy-policy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
