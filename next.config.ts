import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude Node.js-only packages from the client bundle.
  // These are server-side API route dependencies that use native/dynamic requires
  // or are TypeScript source files (edge-tts, ws) that Turbopack can't bundle directly.
  serverExternalPackages: [
    'ws',
    'fluent-ffmpeg',
    '@ffmpeg-installer/ffmpeg',
  ],
};

export default nextConfig;
