/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable server actions
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
