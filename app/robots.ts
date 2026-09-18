import type { MetadataRoute } from "next";

const BASE_URL = "https://hejja-okofarm.hu";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy-policy"],
      disallow: [
        "/preorder",
        "/history",
        "/profile",
        "/admin",
        "/login",
        "/register",
        "/forgot-password",
        "/auth",
        "/auth-test",
        "/api",
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
