import Link from "next/link";

const LINKS = [
  { href: "/cobros", t: "Cobros de Mercado Pago", d: "Posnet, QR y transferencias para facturar" },
  { href: "/facturas", t: "Facturas", d: "Facturas emitidas y sus PDF" },
  { href: "/productos", t: "Productos", d: "Catálogo, precios e importar Precios Deco" },
  { href: "/monotributo", t: "Monotributo", d: "Facturado por período de recategorización" },
  { href: "/configuracion", t: "Configuración", d: "Tus datos de ARCA y Mercado Pago" },
];

export default function Mas() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Más</h1>
      <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block px-4 py-4">
              <span className="block font-semibold">{l.t}</span>
              <span className="text-sm text-suave">{l.d}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
