export function pavaDecreasing(points: Array<{ concentration: number; viability: number; weight: number }>): number[] {
  const blocks: Array<{ start: number; end: number; mean: number; weight: number }> = [];

  points.forEach((point, index) => {
    blocks.push({
      start: index,
      end: index,
      mean: point.viability,
      weight: point.weight
    });

    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];
      if (previous.mean >= last.mean) {
        break;
      }
      const weight = previous.weight + last.weight;
      const mean = (previous.mean * previous.weight + last.mean * last.weight) / weight;
      blocks.splice(blocks.length - 2, 2, {
        start: previous.start,
        end: last.end,
        mean,
        weight
      });
    }
  });

  const fitted = new Array(points.length).fill(0);
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index += 1) {
      fitted[index] = block.mean;
    }
  }
  return fitted;
}

export function isotonicMic(
  concentrations: Array<{ concentration: number; medianViability: number; replicateCount: number }>,
  threshold: number
): { value?: number; label: string; status: "in_range" | ">max_tested" | "<=min_tested" | "indeterminate"; fitted: number[] } {
  const sorted = [...concentrations].sort((a, b) => a.concentration - b.concentration);
  if (sorted.length === 0) {
    return { label: "Indeterminate", status: "indeterminate", fitted: [] };
  }

  const fitted = pavaDecreasing(
    sorted.map((item) => ({
      concentration: item.concentration,
      viability: item.medianViability,
      weight: Math.max(item.replicateCount, 1)
    }))
  );
  const first = sorted.findIndex((_item, index) => fitted[index] <= threshold);

  if (first === -1) {
    return { label: `>${formatNumber(sorted[sorted.length - 1].concentration)}`, status: ">max_tested", fitted };
  }
  if (first === 0) {
    return { value: sorted[0].concentration, label: `<=${formatNumber(sorted[0].concentration)}`, status: "<=min_tested", fitted };
  }
  return { value: sorted[first].concentration, label: formatNumber(sorted[first].concentration), status: "in_range", fitted };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}
