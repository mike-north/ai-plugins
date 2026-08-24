/**
 * Minimal unified-style line diff (old -> new), no external dependency.
 * Standard LCS-based diff; scripts are expected to be small (single-purpose
 * tools per the authoring checklist), so the O(n*m) table is fine. Used for
 * the promotion review surface (docs/toolsmith/staged-live-split.md
 * §Promotion, step 2): a revision is reviewed as a diff against live, so what
 * is reviewed is exactly what is placed.
 */
export function unifiedLineDiff(oldText: string, newText: string): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i]!;
    const next = lcs[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]!}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      lines.push(`- ${a[i]!}`);
      i++;
    } else {
      lines.push(`+ ${b[j]!}`);
      j++;
    }
  }
  while (i < n) {
    lines.push(`- ${a[i]!}`);
    i++;
  }
  while (j < m) {
    lines.push(`+ ${b[j]!}`);
    j++;
  }
  return lines.join("\n");
}
