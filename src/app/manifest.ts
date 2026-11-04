import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Magnolia · Facturación",
    short_name: "Magnolia",
    description: "Facturación automática de cobros de Mercado Pago",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#6b4a3a",
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
