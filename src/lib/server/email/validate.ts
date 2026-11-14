// Deliberately conservative: one local part, one domain with a dot. Better-Auth /
// the mail provider is the real authority; this just blocks obviously-bad input
// before we spend a rate-limit token sending a link.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}
