import type { MemberErrorCode } from '$lib/members/copy';

/**
 * The reasons the invite and membership services throw, by message. A route or action answers
 * the code, never the message: anything not listed here (a database error included) is
 * `failed`, which the page shows as one generic line.
 */
const CODE_BY_MESSAGE: Readonly<Record<string, MemberErrorCode>> = {
  'invite target required': 'target_required',
  'already a member': 'already_member',
  'already invited': 'already_invited',
  'too many pending invites for this sim': 'too_many_pending',
  'no user with that handle': 'no_such_handle',
  'email invites require a verified account': 'email_needs_confirmed',
  'invite not found': 'invite_invalid',
  'invite not pending': 'invite_invalid',
  'invite expired': 'invite_invalid',
  'invite not addressed to you': 'not_addressed',
  'resend too soon': 'resend_too_soon',
  'cannot remove another manager; they must leave the sim themselves': 'manager_protected',
  'not a member': 'not_member',
  'title did not match': 'title_mismatch'
};

/** The code for a thrown service error; `failed` for anything unrecognised. */
export function memberErrorCode(e: unknown): MemberErrorCode {
  if (!(e instanceof Error)) return 'failed';
  return Object.hasOwn(CODE_BY_MESSAGE, e.message) ? CODE_BY_MESSAGE[e.message] : 'failed';
}
