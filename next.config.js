/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ["unpdf", "heic-convert", "heic-decode"],
  },
};

module.exports = nextConfig;
