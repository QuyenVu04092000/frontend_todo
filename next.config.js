const withPWA = require( "next-pwa" )( {
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
} );

const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  output: "export", // cần cho GitHub Pages
  reactStrictMode: true,
  swcMinify: true,
  images: {
    unoptimized: true,
  },
  basePath: isProd ? "/frontend_todo" : "",
  assetPrefix: isProd ? "/frontend_todo/" : "",
};

module.exports = withPWA( nextConfig );
