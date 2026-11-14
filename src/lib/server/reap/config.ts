/** How long a pseudonymous account's sessions must have been expired before it is reapable. */
export const REAP_GRACE_MS = 48 * 60 * 60 * 1000;

/** The most accounts one reaper pass takes. */
export const REAP_BATCH = 300;
