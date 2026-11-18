/**
 * @param {Record<string, {pct?: unknown}> | undefined} summary
 * @param {Record<string, number>} thresholds
 */
export function coverageFailures(summary, thresholds) {
  return Object.entries(thresholds).flatMap(([metric, minimum]) => {
    const actual = summary?.[metric]?.pct;
    return typeof actual === 'number' && Number.isFinite(actual) && actual >= minimum
      ? []
      : [`${metric}: ${actual ?? 'missing'}% (minimum ${minimum}%)`];
  });
}
