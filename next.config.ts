import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  // POS 鏡像用 better-sqlite3（原生模組），不能被 bundle
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
