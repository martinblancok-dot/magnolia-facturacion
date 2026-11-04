import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnolia · Facturación",
  description: "Facturación automática de cobros de Mercado Pago",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
