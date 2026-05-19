import type { EncryptionAdapter } from "../core/ports.js";

export const noneEncryptionAdapter: EncryptionAdapter = {
  type: "none",
  encrypt(bytes): Buffer {
    return bytes;
  },
  decrypt(bytes): Buffer {
    return bytes;
  },
};
