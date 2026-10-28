/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ["unpdf", "heic-convert", "heic-decode", "sharp", "@napi-rs/canvas"],
  },
};

module.exports = nextConfig;
