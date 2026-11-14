// Pure rules for company agreements. An employee's answer is stored per agreement VERSION and per company-local
// day. Editing an agreement bumps its version, so everyone is asked again.
//
//  - Accept (without "Don't show again"): counts for today only. The pop-up shows again the next time the app opens.
//  - Accept with "Don't show again": permanent for this version. The pop-up stops until the admin updates the agreement.
//  - Decline: punching in is blocked for the rest of that day. The pop-up returns on the next open and the
//    employee must accept it again before the following day's punch-in.

export type AckResponse = "accepted" | "declined";

export interface AckRecord {
  version: number;
  response: AckResponse;
  permanent: boolean;
  /** Company-local day the answer counts for, as YYYY-MM-DD. */
  workDate: string;
}

export type AgreementStatus =
  | "permanent" // accepted for good: no pop-up, punching allowed
  | "accepted_today" // accepted today: punching allowed, pop-up shows on the next open
  | "declined_today" // declined today: punching blocked until tomorrow
  | "pending"; // not answered for this version: pop-up shown, punching blocked

/** The employee's status for one agreement version on `todayKey`. */
export function agreementStatusFor(version: number, acks: AckRecord[], todayKey: string): AgreementStatus {
  const mine = acks.filter((a) => a.version === version);
  if (mine.some((a) => a.permanent && a.response === "accepted")) return "permanent";
  const today = mine.find((a) => a.workDate === todayKey);
  if (today?.response === "accepted") return "accepted_today";
  if (today?.response === "declined") return "declined_today";
  return "pending";
}

/** Whether the pop-up should be offered when the app opens. */
export function showsPopup(status: AgreementStatus): boolean {
  return status !== "permanent";
}

/** Whether this status stops the employee punching in. */
export function blocksPunchIn(status: AgreementStatus): boolean {
  return status === "pending" || status === "declined_today";
}

/** The first blocking agreement's title, for the punch-in error message (or null when nothing blocks). */
export function firstPunchBlocker(
  agreements: { title: string; version: number; acks: AckRecord[] }[],
  todayKey: string
): { title: string; status: AgreementStatus } | null {
  for (const a of agreements) {
    const status = agreementStatusFor(a.version, a.acks, todayKey);
    if (blocksPunchIn(status)) return { title: a.title, status };
  }
  return null;
}

export const PUNCH_BLOCKED_PENDING = "Accept the company agreement to punch in. Open the agreement from the pop-up or Notifications.";
export const PUNCH_BLOCKED_DECLINED = "You declined the company agreement today, so you cannot punch in today. You can accept it tomorrow.";

/** Title and body text limits. */
export const AGREEMENT_TITLE_MAX = 200;
export const AGREEMENT_BODY_MAX = 20000;
