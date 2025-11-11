const withPWA = require( "next-pwa" )( {
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
} );

const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  output: "export", // 👈 quan trọng cho GitHub Pages
  reactStrictMode: true,
  swcMinify: true,
  images: {
    unoptimized: true, // 👈 tránh lỗi build khi export
    domains: [ "localhost" ],
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "*",
        pathname: "/uploads/**",
      },
    ],
  },
  basePath: isProd ? "/frontend_todo" : "", // 👈 repo name
  assetPrefix: isProd ? "/frontend_todo/" : "",
};

module.exports = withPWA( nextConfig );
