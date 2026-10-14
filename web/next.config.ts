import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env in the repo root serves local dev, Docker (via compose env_file) and the Python eval.
const rootEnv = path.resolve(process.cwd(), "..", ".env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const nextConfig: NextConfig = {
  output: "standalone", // small self-contained server for the Docker image
};

export default nextConfig;
