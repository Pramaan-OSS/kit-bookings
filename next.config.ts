import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  allowedDevOrigins: process.env.PRAMAAN_DRAFT_HOST ? [process.env.PRAMAAN_DRAFT_HOST] : undefined,
};

export default nextConfig;
