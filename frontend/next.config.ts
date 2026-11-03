import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  experimental: { useTypeScriptCli: false, workerThreads: true },
};

export default nextConfig;
