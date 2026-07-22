import "server-only";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const BRANDING_DIR = resolve(
  process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH, "..")
    : resolve(process.cwd(), "data"),
  "branding"
);

mkdirSync(BRANDING_DIR, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

const MIME_BY_EXT: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1 MiB

export function isAcceptedLogoMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

export function logoExtForMime(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

// Remove every file starting with `logo.` — we only keep one active logo.
function removeExistingLogos() {
  for (const file of readdirSync(BRANDING_DIR)) {
    if (file.startsWith("logo.")) {
      try {
        unlinkSync(resolve(BRANDING_DIR, file));
      } catch {
        /* ignore */
      }
    }
  }
}

export function saveLogo(buffer: Buffer, ext: string): string {
  removeExistingLogos();
  const filename = `logo.${ext}`;
  writeFileSync(resolve(BRANDING_DIR, filename), buffer);
  return filename;
}

export function deleteLogo(): void {
  removeExistingLogos();
}

export function readLogo(
  path: string
): { buffer: Buffer; mime: string } | null {
  const full = resolve(BRANDING_DIR, path);
  if (!full.startsWith(BRANDING_DIR) || !existsSync(full)) return null;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  return { buffer: readFileSync(full), mime };
}

// Mail clients can't render SVG and classic Outlook chokes on WebP, so emails
// embed a PNG derivative instead. The `logo.` prefix keeps it inside the
// removeExistingLogos() sweep — re-uploading or deleting the logo is what
// invalidates the cached conversion.
const EMAIL_LOGO_FILE = "logo.email.png";

export async function readEmailLogo(
  logoFile: string
): Promise<{ filename: string; buffer: Buffer; mime: string } | null> {
  const original = readLogo(logoFile);
  if (!original) return null;
  if (original.mime === "image/png" || original.mime === "image/jpeg") {
    return { filename: logoFile, ...original };
  }

  const cached = readLogo(EMAIL_LOGO_FILE);
  if (cached) return { filename: EMAIL_LOGO_FILE, ...cached };

  try {
    const sharp = (await import("sharp")).default;
    // density only affects vector input: SVGs rasterize ~4x their intrinsic
    // 72dpi size, then downscale to the 2x-retina header height (32px CSS in
    // the email layout) — rasters pass through capped, never enlarged.
    const buffer = await sharp(original.buffer, { density: 300 })
      .resize({ width: 640, height: 64, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    writeFileSync(resolve(BRANDING_DIR, EMAIL_LOGO_FILE), buffer);
    return { filename: EMAIL_LOGO_FILE, buffer, mime: "image/png" };
  } catch (err) {
    console.warn(
      `[branding] email logo conversion failed for ${logoFile}; emails fall back to the text wordmark:`,
      err
    );
    return null;
  }
}
