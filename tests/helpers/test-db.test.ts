// source: tests/helpers/test-db.ts refuses an unsafe TEST_DATABASE_URL before connecting

import { describe, expect, it } from "vitest";
import { openTestDb } from "./test-db";

async function expectRefusal(url: string, pattern: RegExp): Promise<void> {
  const saved = process.env.TEST_DATABASE_URL;
  process.env.TEST_DATABASE_URL = url;
  try {
    await expect(openTestDb()).rejects.toThrow(pattern);
  } finally {
    if (saved === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = saved;
  }
}

describe("openTestDb guard", () => {
  it("refuses a protocol other than postgres or postgresql", async () => {
    // source: openTestDb refuses a TEST_DATABASE_URL whose protocol is not postgres: or postgresql:
    await expectRefusal("http://127.0.0.1:1/friendform_test", /protocol must be postgres: or postgresql:/);
  });

  it("refuses a query string", async () => {
    // source: openTestDb refuses a TEST_DATABASE_URL that includes a query string
    await expectRefusal(
      "postgresql://127.0.0.1:1/friendform_test?sslmode=disable",
      /must not include a query string/,
    );
  });

  it("refuses a database name that does not end in _test", async () => {
    // source: openTestDb refuses a TEST_DATABASE_URL whose database name does not end in _test
    await expectRefusal("postgresql://127.0.0.1:1/friendform", /database name must end in _test/);
  });
});
