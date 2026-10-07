import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Homebase",
    short_name: "Homebase",
    description: "A calm, beautiful dashboard for your Coolify server.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0c0f",
    theme_color: "#292e36",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Deployments", url: "/deployments" },
      { name: "Apps", url: "/apps" },
      { name: "Servers", url: "/servers" },
    ],
  };
}
