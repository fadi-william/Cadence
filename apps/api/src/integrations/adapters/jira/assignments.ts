/**
 * Splits a Jira issue's history into **assignments**: continuous periods during which one person was the
 * assignee. Pure function; the rules are documented in docs/guide/metrics.md ("Assignments and hold time").
 *
 * - An assignment starts when someone becomes the assignee (or at creation for the first assignee, or
 *   when a Done issue is reopened) and ends when the issue is reassigned, unassigned or moves into a
 *   Done-category status.
 * - It is **completed** (moved forward) if the status changed while that person held it, including the
 *   move to Done. Otherwise it was **handed over** (reassigned without a stage change).
 * - It is **rework** if the same person already held this issue before.
 * - Assignments shorter than {@link MIN_ASSIGNMENT_MINUTES} are ignored, and still-open assignments are
 *   not reported (they have not finished yet). Unassigned time belongs to nobody.
 */

export const MIN_ASSIGNMENT_MINUTES = 5;

export interface ChangelogItem {
  field: string;
  fieldId?: string;
  from: string | null;
  to: string | null;
}

export interface ChangelogHistory {
  created: string;
  items: ChangelogItem[];
}

export interface AssignmentInput {
  created: string;
  /** Current assignee id (accountId on Cloud, username/key on Server), or null. */
  currentAssignee: string | null;
  /** Current status id. */
  currentStatus: string | null;
  histories: ChangelogHistory[];
  /** Status id → status category key ("new" | "indeterminate" | "done"). */
  categories: Map<string, string>;
}

export interface Assignment {
  assignee: string;
  start: Date;
  end: Date;
  hours: number;
  outcome: 'completed' | 'handedOver';
  rework: boolean;
}

const isAssignee = (it: ChangelogItem) => it.field === 'assignee' || it.fieldId === 'assignee';
const isStatus = (it: ChangelogItem) => it.field === 'status' || it.fieldId === 'status';

export function buildAssignments(input: AssignmentInput): Assignment[] {
  const histories = [...input.histories].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
  const isDone = (status: string | null) => !!status && input.categories.get(status) === 'done';

  // Reconstruct the state at creation from the first change of each field.
  const firstAssignee = histories.flatMap((h) => h.items).find(isAssignee);
  const firstStatus = histories.flatMap((h) => h.items).find(isStatus);
  let assignee = firstAssignee ? firstAssignee.from : input.currentAssignee;
  let status = firstStatus ? firstStatus.from : input.currentStatus;

  const out: Assignment[] = [];
  const held = new Set<string>();
  let open: { assignee: string; start: Date; moved: boolean } | null = null;

  const openFor = (at: Date) => {
    open = assignee && !isDone(status) ? { assignee, start: at, moved: false } : null;
  };
  const close = (at: Date) => {
    const o = open;
    open = null;
    if (!o) return;
    const hours = (at.getTime() - o.start.getTime()) / 36e5;
    if (hours * 60 < MIN_ASSIGNMENT_MINUTES) return;
    out.push({
      assignee: o.assignee,
      start: o.start,
      end: at,
      hours,
      outcome: o.moved ? 'completed' : 'handedOver',
      rework: held.has(o.assignee),
    });
    held.add(o.assignee);
  };

  openFor(new Date(input.created));
  for (const h of histories) {
    const at = new Date(h.created);
    // A transition and a reassignment in the same change: the stage move belongs to the outgoing assignee.
    for (const it of h.items.filter(isStatus)) {
      const wasDone = isDone(status);
      status = it.to;
      if (open) (open as { moved: boolean }).moved = true;
      if (!wasDone && isDone(status)) close(at);
      else if (wasDone && !isDone(status)) openFor(at); // reopened
    }
    for (const it of h.items.filter(isAssignee)) {
      if (it.to === assignee) continue;
      close(at);
      assignee = it.to;
      openFor(at);
    }
  }
  return out;
}
