
const COLORS = [
  '#d46bd6',
  '#4a4cf0',
  '#2ee59d',
  '#f5c542',
  '#4aa8ff',
  '#ff9f43',
  '#b79be0',
  '#ff5b6e',
  '#6be0d4'
];

export function donut(items, size = 180, centerText = '') {
  // Validate chart size and input.
  size = Number.isFinite(Number(size)) && Number(size) > 40
    ? Number(size)
    : 180;

  const data = (Array.isArray(items) ? items : [])
    .map(item => ({
      label: String(item?.label ?? 'Unknown'),
      value: Number(item?.value)
    }))
    .filter(item => Number.isFinite(item.value) && item.value > 0);

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const c = size / 2;
  const R = size / 2 - 8;
  const r = R * 0.62;

  // Escape text before inserting it into HTML or SVG.
  const escapeHTML = value =>
    String(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);

  if (total <= 0) {
    return `
      <div class="flex items-center gap-4 flex-wrap">
        <svg
          width="${size}"
          height="${size}"
          viewBox="0 0 ${size} ${size}"
          role="img"
          aria-label="No allocation data"
        >
          <circle
            cx="${c}"
            cy="${c}"
            r="${R}"
            fill="none"
            stroke="rgba(255,255,255,.12)"
            stroke-width="${R - r}"
          />
          <text
            x="${c}"
            y="${c + 4}"
            text-anchor="middle"
            fill="#9a95b8"
            font-size="12"
          >No data</text>
        </svg>
        <div class="mu text-xs">No allocation data available.</div>
      </div>
    `;
  }

  let angle = -Math.PI / 2;

  const arcs = data.map((item, i) => {
    const slice = (item.value / total) * Math.PI * 2;
    const gap = Math.min(0.008, slice / 10);
    const start = angle;
    const end = angle + Math.max(0, slice - gap);
    angle += slice;

    const largeArc = end - start > Math.PI ? 1 : 0;

    const point = (radius, a) => [
      c + radius * Math.cos(a),
      c + radius * Math.sin(a)
    ];

    const [x0, y0] = point(R, start);
    const [x1, y1] = point(R, end);
    const [x2, y2] = point(r, end);
    const [x3, y3] = point(r, start);

    const color = COLORS[i % COLORS.length];
    const percentage = (item.value / total * 100).toFixed(1);

    const path = [
      `M ${x0} ${y0}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1}`,
      `L ${x2} ${y2}`,
      `A ${r} ${r} 0 ${largeArc} 0 ${x3} ${y3}`,
      'Z'
    ].join(' ');

    return `
      <path
        d="${path}"
        fill="${color}"
        stroke="rgba(10,10,30,.75)"
        stroke-width="1"
      >
        <title>${escapeHTML(item.label)}: ${percentage}%</title>
      </path>
    `;
  }).join('');

  const legend = data.map((item, i) => {
    const percentage = (item.value / total * 100).toFixed(1);
    const label = escapeHTML(item.label);
    const color = COLORS[i % COLORS.length];

    return `
      <div class="flex items-center gap-2 text-xs min-w-0">
        <i
          aria-hidden="true"
          style="
            display:inline-block;
            flex-shrink:0;
            width:10px;
            height:10px;
            border-radius:3px;
            background:${color};
          "
        ></i>
        <span class="mu min-w-0 truncate" title="${label}">
          ${label}
        </span>
        <b class="ml-auto num">${percentage}%</b>
      </div>
    `;
  }).join('');

  return `
    <div class="flex items-center gap-4 flex-wrap">
      <svg
        width="${size}"
        height="${size}"
        viewBox="0 0 ${size} ${size}"
        role="img"
        aria-label="Allocation breakdown"
        style="flex-shrink:0;max-width:100%;height:auto"
      >
        ${arcs}
        <text
          x="${c}"
          y="${c + 4}"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="#fff"
          font-size="12"
        >${escapeHTML(centerText)}</text>
      </svg>

      <div class="flex-1 min-w-[140px] grid gap-1.5">
        ${legend}
      </div>
    </div>
  `;
}
