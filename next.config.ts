import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  async rewrites() {
    const backend = process.env.BACKEND_URL;
    return backend
      ? [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }]
      : [];
  },
};
export default config;
