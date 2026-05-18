import { describe, expect, it } from "vitest";

import { cliName, getStartupMessage } from "../src/cli.js";

describe("cli harness baseline", () => {
  it("exposes the CLI name", () => {
    expect(cliName).toBe("ops-backup-runner");
  });

  it("does not expose backup behavior yet", () => {
    expect(getStartupMessage()).toContain("not implemented yet");
  });
});
