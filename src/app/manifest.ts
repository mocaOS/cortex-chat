import type { MetadataRoute } from "next";
import { getAppSettings } from "@/lib/settings";

// Served at /manifest.webmanifest. Dynamic because name/description are
// superadmin-editable via /admin/settings — must reflect the DB at request
// time, not build time. The middleware matcher skips dotted paths, so the
// manifest is fetchable without a session (required for installability).
export const dynamic = "force-dynamic";

// --bg dark token oklch(0.1448 0 0) as hex — manifest colors must be
// simple sRGB values (browsers don't reliably parse oklch() in manifests).
const DARK_BG = "#0a0a0a";

export default function manifest(): MetadataRoute.Manifest {
  const { appTitle, appDescription } = getAppSettings();
  return {
    id: "/",
    name: appTitle,
    short_name: appTitle,
    description: appDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: DARK_BG,
    theme_color: DARK_BG,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Same assets double as maskable: full-bleed dark background with the
      // mark inside the 80% safe zone, so adaptive-icon cropping is safe.
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
