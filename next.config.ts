import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "https://stockroom-marketing.vercel.app/" },
        { source: "/_assets/:path*", destination: "https://stockroom-marketing.vercel.app/_assets/:path*" },
        { source: "/favicon.ico", destination: "https://stockroom-marketing.vercel.app/favicon.ico" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
