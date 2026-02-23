// Tunables for hex packing
const HEX_RADIUS_FACTOR = 0.095;
const HEX_GAP_FACTOR    = 0.70;   // horizontal gap fraction
const HEX_INNER_PAD_FR  = 0.75;

private calculateJitter(
  x: d3.ScaleBand<string>,
  y: d3.ScaleBand<string>,
  _width: number,
  _height: number
): Risk[] {
  const groups = d3.group(this.risks, d => `${d.consequenceIdx}-${d.likelihoodIdx}`);

  const cellW = Math.max(1, x.bandwidth());
  const cellH = Math.max(1, y.bandwidth());

  const radius = Math.max(4, Math.min(cellW, cellH) * HEX_RADIUS_FACTOR);
  const gapX   = Math.max(2, radius * HEX_GAP_FACTOR);
  const pitchX = (radius * 2) + gapX;
  // Hex vertical pitch ~ sqrt(3) * r (with some gap)
  const pitchY = (Math.sqrt(3) * radius) + (gapX * 0.35);

  const padX = Math.max(2, radius * HEX_INNER_PAD_FR);
  const padY = Math.max(2, radius * HEX_INNER_PAD_FR);

  const usableW = Math.max(0, cellW - padX * 2);
  const usableH = Math.max(0, cellH - padY * 2);

  function hexPositions(n: number): [number, number][] {
    const pos: [number, number][] = [];
    if (n <= 1) { pos.push([0,0]); return pos; }

    // Compute how many rows/cols we can fit with hex staggering
    const cols = Math.max(1, Math.floor(usableW / pitchX));
    const rows = Math.max(1, Math.floor(usableH / pitchY));

    if (cols === 1 && rows === 1) {
      for (let i = 0; i < n; i++) pos.push([0,0]);
      return pos;
    }

    // Center bounds
    const gridW = (cols - 1) * pitchX + (cols > 1 ? pitchX * 0.5 : 0); // account for staggered offset
    const gridH = (rows - 1) * pitchY;
    const cx0   = -gridW / 2;
    const cy0   = -gridH / 2;

    let placed = 0;
    for (let r = 0; r < rows && placed < n; r++) {
      const offset = (r % 2 === 1) ? pitchX * 0.5 : 0;
      for (let c = 0; c < cols && placed < n; c++) {
        const cx = cx0 + offset + c * pitchX;
        const cy = cy0 + r * pitchY;
        pos.push([cx, cy]);
        placed++;
      }
    }

    // If we still have more than fit, just reuse from start (deterministic)
    for (; placed < n; placed++) pos.push(pos[placed % pos.length]);

    return pos;
  }

  const placed: Risk[] = [];
  for (const [key, group] of groups.entries()) {
    const [cIdxStr, lIdxStr] = key.split("-");
    const cIdx = Number(cIdxStr);
    const lIdx = Number(lIdxStr);
    const cLabel = this.consequenceLabelFromIndex(cIdx);
    const lLabel = this.likelihoodLabelFromIndex(lIdx);
    if (!cLabel || !lLabel) continue;

    const pos = hexPositions(group.length);
    for (let i = 0; i < group.length; i++) {
      const g = group[i];
      placed.push({
        ...g,
        consequenceLabel: cLabel,
        likelihoodLabel: lLabel,
        jitterX: pos[i][0],
        jitterY: pos[i][1],
        radius
      });
    }
  }
  return placed;
}

// calculate jitter
    /*
    private calculateJitter(
        x: d3.ScaleBand<string>,
        y: d3.ScaleBand<string>,
        width: number,
        height: number
    ): Risk[] {
        const cellGroups = d3.group(
            this.risks,
            d => `${d.consequenceIdx}-${d.likelihoodIdx}`
        );

        const cellWidth = Math.max(1, x.bandwidth());
        const cellHeight = Math.max(1, y.bandwidth());

        // calculate circle radius
        const baseRadius = Math.max(2, Math.min(cellWidth, cellHeight) * 0.09);
        const paddingInCell = Math.max(1, Math.min(cellWidth, cellHeight) * 0.35);
        const maxJitterX = (cellWidth / 2) - baseRadius - paddingInCell;
        const maxJitterY = (cellHeight / 2) - baseRadius - paddingInCell;

        // Helper to distribute n points in rings within available jitter box
        function jitterPositions(n: number): [number, number][] {
            if (n <= 1) return [[0, 0]];
            const positions: [number, number][] = [];
            const rings = Math.ceil(Math.sqrt(n));
            let placed = 0;

            for (let r = 0; r < rings && placed < n; r++) {
                const k = r === 0 ? 1 : Math.ceil(2 * Math.PI * (r + 1));
                for (let i = 0; i < k && placed < n; i++) {
                    const t = (i / k) * 2 * Math.PI;
                    const scale = (r + 1) / rings;
                    const increaseSpreadFactor = 1.15;
                    const jx = Math.max(-maxJitterX, Math.min(maxJitterX, increaseSpreadFactor * scale * maxJitterX * Math.cos(t)));
                    const jy = Math.max(-maxJitterY, Math.min(maxJitterY, increaseSpreadFactor * scale * maxJitterY * Math.sin(t)));
                    positions.push([jx, jy]);
                    placed++;
                }
            }
            return positions;
        }

        const jittered: Risk[] = [];

        for (const [key, group] of cellGroups.entries()) {
            const [cIdxStr, lIdxStr] = key.split("-");
            const cIdx = Number(cIdxStr);
            const lIdx = Number(lIdxStr);
            const cLabel = this.consequenceLabelFromIndex(cIdx);
            const lLabel = this.likelihoodLabelFromIndex(lIdx);
            if (!cLabel || !lLabel) continue;

            const pos = jitterPositions(group.length);
            for (let i = 0; i < group.length; i++) {
                const g = group[i];
                jittered.push({
                    ...g,
                    consequenceLabel: cLabel,
                    likelihoodLabel: lLabel,
                    jitterX: pos[i][0],
                    jitterY: pos[i][1],
                    radius: baseRadius
                });
            }
        }

        return jittered;
    }
        */