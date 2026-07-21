// Converts a CSS color (hex, rgb(), or oklch()) to a #rrggbb hex string that
// mail clients render reliably. The DB accent default is oklch(...), which most
// email clients do NOT support — so we convert it here. Falls back to a safe
// neutral accent for anything unparseable.
const FALLBACK = "#c9a227";

export function cssColorToHex(input: string): string {
  const s = (input || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  const rgb = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) {
    return toHex(Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255);
  }
  const oklch = s.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/
  );
  if (oklch) {
    let L = parseFloat(oklch[1]);
    if (oklch[1].endsWith("%")) L = L / 100;
    const C = parseFloat(oklch[2]);
    const H = parseFloat(oklch[3]);
    const [r, g, b] = oklchToLinearSrgb(L, C, H);
    return toHex(gammaEncode(r), gammaEncode(g), gammaEncode(b));
  }
  return FALLBACK;
}

function oklchToLinearSrgb(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function gammaEncode(x: number): number {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, c));
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}
