export const contentStatuses = [
  'IMPORTED', 'REVIEW_NEEDED', 'VERIFIED', 'PUBLISHED', 'DISABLED',
] as const;
export type ContentStatus = typeof contentStatuses[number];

export const difficulties = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = typeof difficulties[number];

export const trackRoles = ['SOURCE', 'SAMPLED'] as const;
export type TrackRole = typeof trackRoles[number];
