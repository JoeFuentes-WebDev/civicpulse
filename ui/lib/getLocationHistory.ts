export type LocationHistoryResult = {
  priorReportCount: number;
  lastReportedDate: string | null;
  lastStatus: string | null;
  isRepeatLocation: boolean;
  pattern: string;
};

const CLOSED_STATUSES = ['closed_unresolved', 'closed', 'open'] as const;

function randomInt(maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive + 1));
}

function daysAgoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function patternForCount(count: number): string {
  if (count === 0) {
    return 'No prior reports at this location in the last 60 days.';
  }
  if (count === 1) {
    return 'Reported once in the last 60 days, closed without resolution.';
  }
  return `Reported ${count} times in the last 60 days, closed without resolution each time.`;
}

/** POC stub — random prior report count from 0–3. Replace with Open311/DataSF in V2. */
export function getLocationHistory(
  _lat?: number,
  _lng?: number
): LocationHistoryResult {
  const priorReportCount = randomInt(3);
  const isRepeatLocation = priorReportCount > 0;

  if (!isRepeatLocation) {
    return {
      priorReportCount: 0,
      lastReportedDate: null,
      lastStatus: null,
      isRepeatLocation: false,
      pattern: patternForCount(0),
    };
  }

  return {
    priorReportCount,
    lastReportedDate: daysAgoDate(randomInt(59) + 1),
    lastStatus: CLOSED_STATUSES[randomInt(CLOSED_STATUSES.length - 1)],
    isRepeatLocation: true,
    pattern: patternForCount(priorReportCount),
  };
}
