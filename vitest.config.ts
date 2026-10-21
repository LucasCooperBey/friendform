import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@": path.resolve(rootDir, "client/src"),
  "@shared": path.resolve(rootDir, "shared"),
};

const fileParallelism = !process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: { alias },
  test: {
    testTimeout: 20000,
    fileParallelism,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: [
            "tests/shared/**/*.test.ts",
            "tests/server/**/*.test.ts",
            "tests/helpers/**/*.test.ts",
          ],
          testTimeout: 20000,
          fileParallelism,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "client",
          environment: "happy-dom",
          include: ["tests/client/**/*.test.tsx"],
          setupFiles: ["tests/client/setup.ts"],
          testTimeout: 20000,
        },
      },
    ],
  },
});
