// Shared between the notification API and the client. No server-only imports here.

export interface NotificationItem {
  id: string;
  kind: "agreement" | "notice" | "leave" | "slip" | "action";
  title: string;
  body: string;
  at: string; // ISO time
  unread: boolean;
  tone: "indigo" | "green" | "amber" | "red" | "slate";
  href?: string;
  agreementId?: string;
  /** Something the app opens in place rather than a page to navigate to. */
  action?: "open_checkin";
}

/** Dispatched on window after anything that changes the notification list (for example an agreement answer). */
export const NOTIFICATIONS_CHANGED = "timetrack:notifications-changed";
/** Dispatched on window when the admin taps the check-in notification: the check-in re-checks and opens. */
export const OPEN_CHECKIN_EVENT = "timetrack:open-checkin";
/** Dispatched on window when an employee's punch is blocked, so the agreement pop-up re-checks and opens. */
export const AGREEMENTS_CHANGED = "timetrack:agreements-changed";
