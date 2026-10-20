import type { NextConfig } from "next";

// T-ML-037: baseline security headers. The site is HTTPS-only behind Cloudflare.
// No page uses camera / microphone / geolocation (the cash signature pad is a plain
// canvas), so those are switched off.
// CSP is deliberately conservative (no script-src): Next injects inline bootstrap
// scripts, so a script-src policy would need per-request nonces. These directives
// block framing, <base> hijack, plugins and cross-origin form posts without that cost.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  // POS 鏡像用 better-sqlite3（原生模組），不能被 bundle
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
