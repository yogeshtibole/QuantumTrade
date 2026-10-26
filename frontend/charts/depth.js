
 // Market depth (cumulative liquidity) chart.
import { fmt } from '../src/utils.js';

export function depthChart(host, bids, asks, mid) {
  host.classList.add('chart-host');

  let cv = host.querySelector('canvas');

  if (!cv) {
    cv = document.createElement('canvas');
    host.appendChild(cv);
  }

  cv.style.display = 'block';
  cv.style.width = '100%';
  cv.style.height = '100%';

  const W = host.clientWidth;
  const H = host.clientHeight;

  if (!W || !H) return;

  const dpr = window.devicePixelRatio || 1;

  const pixelW = Math.round(W * dpr);
  const pixelH = Math.round(H * dpr);

  if (cv.width !== pixelW || cv.height !== pixelH) {
    cv.width = pixelW;
    cv.height = pixelH;
  }

  const g = cv.getContext('2d');

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  g.font = '11px system-ui';
  g.fillStyle = '#9a95b8';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';

  if (!bids?.length || !asks?.length) {
    g.fillText('Waiting for order book…', 12, 24);
    return;
  }

  // Sort copies so the supplied order-book arrays remain unchanged.
  const bidLevels = [...bids]
    .filter(l => Number.isFinite(Number(l.price)) &&
                 Number.isFinite(Number(l.total)))
    .sort((a, b) => Number(b.price) - Number(a.price));

  const askLevels = [...asks]
    .filter(l => Number.isFinite(Number(l.price)) &&
                 Number.isFinite(Number(l.total)))
    .sort((a, b) => Number(a.price) - Number(b.price));

  if (!bidLevels.length || !askLevels.length) {
    g.fillText('Waiting for order book…', 12, 24);
    return;
  }

  const bestBid = Number(bidLevels[0].price);
  const bestAsk = Number(askLevels[0].price);

  const lo = Math.min(
    Number(bidLevels[bidLevels.length - 1].price),
    bestBid,
    Number(mid)
  );

  const hi = Math.max(
    Number(askLevels[askLevels.length - 1].price),
    bestAsk,
    Number(mid)
  );

  const maxTotal = Math.max(
    1,
    ...bidLevels.map(l => Number(l.total)),
    ...askLevels.map(l => Number(l.total))
  );

  const mx = maxTotal * 1.05;

  const plotLeft = 8;
  const plotRight = W - 8;
  const plotTop = 12;
  const plotBottom = H - 28;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  // Avoid division by zero when all prices are equal.
  const priceRange = hi - lo || 1;

  const X = price =>
    plotLeft + ((Number(price) - lo) / priceRange) * plotW;

  const Y = value =>
    plotBottom - (Number(value) / mx) * plotH;

  // Draw cumulative bid and ask liquidity areas.
  const area = (levels, color, isBid) => {
    if (!levels.length) return;

    const points = levels.map(level => ({
      price: Number(level.price),
      total: Math.max(0, Number(level.total))
    }));

    const baseline = plotBottom;

    g.beginPath();
    g.moveTo(X(points[0].price), baseline);

    let previousTotal = 0;

    points.forEach(level => {
      g.lineTo(X(level.price), Y(previousTotal));
      g.lineTo(X(level.price), Y(level.total));
      previousTotal = level.total;
    });

    g.lineTo(X(points[points.length - 1].price), baseline);
    g.closePath();

    g.fillStyle = color + '30';
    g.fill();

    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.stroke();

    // Distinguish the bid/ask side with a subtle baseline.
    g.strokeStyle = color;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.moveTo(
      X(points[0].price),
      Y(points[0].total)
    );
    g.lineTo(
      X(points[points.length - 1].price),
      Y(points[points.length - 1].total)
    );
    g.stroke();
    g.globalAlpha = 1;
  };

  area(bidLevels, '#2ee59d', true);
  area(askLevels, '#ff5b6e', false);

  // Mid-price reference line.
  if (Number.isFinite(Number(mid))) {
    const midX = X(Number(mid));

    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 1;
    g.setLineDash([3, 3]);

    g.beginPath();
    g.moveTo(midX, plotTop);
    g.lineTo(midX, plotBottom);
    g.stroke();

    g.setLineDash([]);

    g.fillStyle = '#9a95b8';
    g.textAlign = 'center';
    g.fillText(
      'Mid ' + fmt(Number(mid)),
      Math.max(35, Math.min(W - 35, midX)),
      H - 6
    );
  }

  // Price-axis labels.
  g.fillStyle = '#9a95b8';
  g.textAlign = 'left';
  g.fillText(fmt(lo), 8, H - 6);

  g.textAlign = 'right';
  g.fillText(fmt(hi), W - 8, H - 6);

  g.textAlign = 'left';
  g.lineWidth = 1;
}
