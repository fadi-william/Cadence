import { ChangelogHistory, buildAssignments } from './assignments';

// 1 To Do (new) · 3 In Progress · 4 Code Review · 6 QA (indeterminate) · 5 Done (done)
const categories = new Map([
  ['1', 'new'],
  ['3', 'indeterminate'],
  ['4', 'indeterminate'],
  ['6', 'indeterminate'],
  ['5', 'done'],
]);
const at = (day: number, hour: number, minute = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+0000`;
const status = (from: string, to: string) => ({ field: 'status', from, to });
const assignee = (from: string | null, to: string | null) => ({ field: 'assignee', from, to });

const summary = (histories: ChangelogHistory[], current: { assignee: string | null; status: string }) =>
  buildAssignments({
    created: at(2, 8),
    currentAssignee: current.assignee,
    currentStatus: current.status,
    histories,
    categories,
  }).map((a) => ({ who: a.assignee, hours: a.hours, outcome: a.outcome, rework: a.rework }));

describe('buildAssignments', () => {
  it('splits a ticket that moves between people at each stage, counting a return as rework', () => {
    const histories: ChangelogHistory[] = [
      { created: at(2, 9), items: [status('1', '3'), assignee(null, 'alice')] }, // Mon: dev starts
      { created: at(3, 15), items: [status('3', '4'), assignee('alice', 'bob')] }, // Tue: to review
      { created: at(4, 10), items: [status('4', '3'), assignee('bob', 'alice')] }, // Wed: sent back
      { created: at(4, 16), items: [status('3', '6'), assignee('alice', 'carol')] }, // Wed: to QA
      { created: at(5, 12), items: [status('6', '5')] }, // Thu: done
    ];
    expect(summary(histories, { assignee: 'carol', status: '5' })).toEqual([
      { who: 'alice', hours: 30, outcome: 'completed', rework: false },
      { who: 'bob', hours: 19, outcome: 'completed', rework: false },
      { who: 'alice', hours: 6, outcome: 'completed', rework: true },
      { who: 'carol', hours: 20, outcome: 'completed', rework: false },
    ]);
  });

  it('marks a reassignment without a stage change as a hand-over', () => {
    const histories: ChangelogHistory[] = [
      { created: at(2, 9), items: [status('1', '3'), assignee(null, 'alice')] },
      { created: at(3, 9), items: [assignee('alice', 'dan')] }, // Alice off sick
      { created: at(4, 9), items: [status('3', '5')] },
    ];
    expect(summary(histories, { assignee: 'dan', status: '5' })).toEqual([
      { who: 'alice', hours: 24, outcome: 'handedOver', rework: false },
      { who: 'dan', hours: 24, outcome: 'completed', rework: false },
    ]);
  });

  it('charges unassigned time to nobody', () => {
    const histories: ChangelogHistory[] = [
      { created: at(2, 9), items: [status('1', '3'), assignee(null, 'alice')] },
      { created: at(2, 17), items: [status('3', '6'), assignee('alice', null)] }, // waits in the QA queue
      { created: at(4, 9), items: [assignee(null, 'carol')] },
      { created: at(4, 12), items: [status('6', '5')] },
    ];
    expect(summary(histories, { assignee: 'carol', status: '5' })).toEqual([
      { who: 'alice', hours: 8, outcome: 'completed', rework: false },
      { who: 'carol', hours: 3, outcome: 'completed', rework: false },
    ]);
  });

  it('starts with the creation-time assignee and does not report the still-open assignment', () => {
    const histories: ChangelogHistory[] = [{ created: at(2, 20), items: [status('1', '3'), assignee('alice', 'bob')] }];
    expect(summary(histories, { assignee: 'bob', status: '3' })).toEqual([
      { who: 'alice', hours: 12, outcome: 'completed', rework: false },
    ]);
  });

  it('ignores assignments shorter than five minutes', () => {
    const histories: ChangelogHistory[] = [
      { created: at(2, 9), items: [assignee(null, 'alice')] },
      { created: at(2, 9, 2), items: [assignee('alice', 'bob')] }, // mis-click
      { created: at(2, 12), items: [status('1', '5')] },
    ];
    expect(summary(histories, { assignee: 'bob', status: '5' })).toEqual([
      { who: 'bob', hours: 2 + 58 / 60, outcome: 'completed', rework: false },
    ]);
  });

  it('opens a new assignment when a Done ticket is reopened', () => {
    const histories: ChangelogHistory[] = [
      { created: at(2, 9), items: [status('1', '3'), assignee(null, 'alice')] },
      { created: at(2, 13), items: [status('3', '5')] },
      { created: at(3, 9), items: [assignee('alice', 'bob')] }, // reassigned while Done: no assignment
      { created: at(3, 10), items: [status('5', '3')] }, // reopened
      { created: at(3, 14), items: [status('3', '5')] },
    ];
    expect(summary(histories, { assignee: 'bob', status: '5' })).toEqual([
      { who: 'alice', hours: 4, outcome: 'completed', rework: false },
      { who: 'bob', hours: 4, outcome: 'completed', rework: false },
    ]);
  });
});
