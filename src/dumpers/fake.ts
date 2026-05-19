import type { BackupTarget } from "../config/types.js";
import type { DumpArtifact, Dumper } from "../core/ports.js";

export const fakeDumper: Dumper<BackupTarget> = {
  dump(target: BackupTarget): DumpArtifact {
    if (target.dumper.type !== "fake") {
      throw new Error(
        `Unsupported dumper for local pipeline: ${target.dumper.type}`
      );
    }

    return {
      bytes: Buffer.from(target.dumper.bytes, "utf8"),
      extension: "dump",
    };
  },
};
