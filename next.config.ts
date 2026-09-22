import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Helyi `next dev` alatt is elérhetővé teszi a wrangler.jsonc-ben deklarált
// Cloudflare binding-okat (pl. a karbantartási mód MAINTENANCE_KV namespace-ét).
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ehzrhaizvbfyjpogrnrr.supabase.co",
      },
    ],
  },
};

export default nextConfig;