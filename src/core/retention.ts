import type { BackupManifest } from "./manifest.js";

export interface RetentionPolicy {
  keepDaily?: number | undefined;
  keepWeekly?: number | undefined;
  keepMonthly?: number | undefined;
  maxAgeDays?: number | undefined;
  keepManual?: string[] | undefined;
}

export interface RetentionPlanItem {
  backupId: string;
  targetId: string;
  createdAt: string;
  artifactKey: string;
  manifestKey: string;
  reason: string;
}

export interface RetentionPlan {
  keep: RetentionPlanItem[];
  delete: RetentionPlanItem[];
  unknownObjectKeys: string[];
}

const toPlanItem = (
  manifest: BackupManifest,
  reason: string
): RetentionPlanItem => ({
  backupId: manifest.backupId,
  targetId: manifest.targetId,
  createdAt: manifest.createdAt,
  artifactKey: manifest.storage.artifactKey,
  manifestKey: manifest.storage.manifestKey,
  reason,
});

const sortNewestFirst = (manifests: BackupManifest[]): BackupManifest[] =>
  [...manifests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const dayKey = (createdAt: string): string => createdAt.slice(0, 10);

const monthKey = (createdAt: string): string => createdAt.slice(0, 7);

const weekKey = (createdAt: string): string => {
  const date = new Date(createdAt);
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    (Math.floor((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7
  );
  return `${String(utcDate.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
};

const selectNewestPerGroup = (
  manifests: BackupManifest[],
  groupKey: (createdAt: string) => string,
  limit: number | undefined
): Set<string> => {
  if (limit === undefined || limit <= 0) return new Set();

  const selected = new Set<string>();
  const seenGroups = new Set<string>();
  for (const manifest of sortNewestFirst(manifests)) {
    const key = groupKey(manifest.createdAt);
    if (seenGroups.has(key)) continue;
    if (seenGroups.size >= limit) break;
    seenGroups.add(key);
    selected.add(manifest.backupId);
  }
  return selected;
};

const getManifestObjectKeys = (manifest: BackupManifest): string[] => [
  manifest.storage.artifactKey,
  manifest.storage.manifestKey,
];

const isOlderThanMaxAge = (
  manifest: BackupManifest,
  maxAgeDays: number | undefined,
  now: Date
): boolean => {
  if (maxAgeDays === undefined) return false;
  const cutoff = now.getTime() - maxAgeDays * 86400000;
  return new Date(manifest.createdAt).getTime() < cutoff;
};

export const createRetentionPlan = (params: {
  manifests: BackupManifest[];
  objectKeys: string[];
  policy: RetentionPolicy;
  now?: Date;
}): RetentionPlan => {
  const now = params.now ?? new Date();
  const keepIds = new Set<string>(params.policy.keepManual ?? []);
  const reasons = new Map<string, string>();

  for (const id of keepIds) {
    reasons.set(id, "manual");
  }

  const addKeepSet = (ids: Set<string>, reason: string): void => {
    for (const id of ids) {
      keepIds.add(id);
      const existingReason = reasons.get(id);
      reasons.set(
        id,
        existingReason === undefined ? reason : `${existingReason},${reason}`
      );
    }
  };

  addKeepSet(
    selectNewestPerGroup(params.manifests, dayKey, params.policy.keepDaily),
    "daily"
  );
  addKeepSet(
    selectNewestPerGroup(params.manifests, weekKey, params.policy.keepWeekly),
    "weekly"
  );
  addKeepSet(
    selectNewestPerGroup(params.manifests, monthKey, params.policy.keepMonthly),
    "monthly"
  );

  const knownKeys = new Set(params.manifests.flatMap(getManifestObjectKeys));
  const unknownObjectKeys = params.objectKeys.filter(
    (key) => !knownKeys.has(key)
  );

  const keep: RetentionPlanItem[] = [];
  const deletable: RetentionPlanItem[] = [];
  for (const manifest of sortNewestFirst(params.manifests)) {
    if (keepIds.has(manifest.backupId)) {
      keep.push(toPlanItem(manifest, reasons.get(manifest.backupId) ?? "kept"));
      continue;
    }

    if (!isOlderThanMaxAge(manifest, params.policy.maxAgeDays, now)) {
      keep.push(toPlanItem(manifest, "within-max-age"));
      continue;
    }

    deletable.push(toPlanItem(manifest, "expired"));
  }

  return {
    keep,
    delete: deletable,
    unknownObjectKeys,
  };
};
