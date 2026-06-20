/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', 'tesseract.js'],
  },
};

module.exports = nextConfig;
