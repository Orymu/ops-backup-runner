const redacted = "[REDACTED]";

const sensitiveKeyPattern =
  /(password|secret|token|privatekey|accesskey|credential)/iu;

export const redactConfigPreview = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactConfigPreview(item));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sensitiveKeyPattern.test(key)
        ? redacted
        : redactConfigPreview(nestedValue);
    }
    return output;
  }

  return value;
};
