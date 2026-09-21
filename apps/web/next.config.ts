import type { NextConfig } from "next";

const config: NextConfig = {
  // The site is a static artifact: a landing page, a calculator that does its
  // arithmetic in the browser, and receipts that are files. Nothing here
  // needs a server, and a static export can sit anywhere without one.
  output: "export",
  reactStrictMode: true,
};

export default config;
