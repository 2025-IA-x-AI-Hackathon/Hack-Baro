import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Use process.cwd() for CommonJS compatibility during type-checking
const __dirname = process.cwd();

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "src/**/*.{test,spec}.{ts,tsx,js}",
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx,js}",
    ],
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        resources: "usable",
      },
    },
    globals: true,
    setupFiles: ["src/renderer/__tests__/setup.ts"],
    exclude: ["e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.stories.tsx",
        "src/**/__tests__/**",
        "src/.erb/**",
      ],
    },
    environmentMatchGlobs: [
      ["src/main/**", "node"],
      ["src/worker/**", "node"],
    ],
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: process.env.CI ? { junit: "coverage/junit.xml" } : undefined,
  },
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "src"),
      },
      {
        find: /^@baro\/([^/]+)(.*)$/,
        replacement: `${path.resolve(__dirname, "../../packages")}/$1/src$2`,
      },
    ],
  },
});
