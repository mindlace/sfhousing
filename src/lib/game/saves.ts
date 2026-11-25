export const SAVES_KEY = 'sfhousing:saves:v1';
export const saveKey = (id: string): string => `sfhousing:save:${id}`;
export const MAX_SAVES = 12;
export const SAVE_NAME_MAX = 60;

export const SHORT_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];
