export interface BackupFailureNotification {
  targetId: string;
  stage: string;
  occurredAt: Date;
  error: string;
  server: string;
}

export interface NotificationResult {
  ok: boolean;
  message: string;
}

export interface FailureNotifier {
  notifyFailure(event: BackupFailureNotification): NotificationResult;
}
