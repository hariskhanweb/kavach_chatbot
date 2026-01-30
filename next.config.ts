import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'export', // Static export for S3 deployment
  trailingSlash: true, // Add trailing slashes to URLs
  images: {
    unoptimized: true, // Required for static export
  },
};

export default nextConfig;
