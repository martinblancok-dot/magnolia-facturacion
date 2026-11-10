import Link from "next/link";
import { usuarioConRol } from "@/lib/supabase/sesion";

const PARA_TODOS = ["/giftcards", "/stock", "/productos", "/etiquetas"];
const LINKS = [
  { href: "/cierres", t: "Cierres de caja", d: "Arqueos, reportes y pagos revisados con Mercado Pago" },
  { href: "/giftcards", t: "Gift cards", d: "Saldos y búsqueda por código" },
  { href: "/reportes", t: "Reportes", d: "Ventas, ganancia, más vendidos y horarios" },
  { href: "/cuentas", t: "Cuentas corrientes", d: "Lo que debe cada clienta y sus pagos" },
  { href: "/stock/reposicion", t: "Reposición y faltantes", d: "Qué pedir a cada proveedor y qué pasar entre locales" },
  { href: "/etiquetas", t: "Etiquetas", d: "Imprimir etiquetas con código y precio" },
  { href: "/autorizaciones", t: "Descuentos para autorizar", d: "Pedidos de los colaboradores desde la caja" },
  { href: "/stock", t: "Stock", d: "Cargar mercadería y controlar con el lector" },
  { href: "/cobros", t: "Cobros de Mercado Pago", d: "Posnet, QR y transferencias para facturar" },
  { href: "/facturas", t: "Facturas", d: "Facturas emitidas y sus PDF" },
  { href: "/productos", t: "Productos", d: "Catálogo, precios e importar Precios Deco" },
  { href: "/monotributo", t: "Monotributo", d: "Facturado por período de recategorización" },
  { href: "/configuracion", t: "Configuración", d: "Tus datos de ARCA y Mercado Pago" },
  { href: "/usuarios", t: "Usuarios", d: "Colaboradores que pueden usar la caja" },
];

export default async function Mas() {
  const { rol } = await usuarioConRol();
  const links = rol === "duenio" ? LINKS : LINKS.filter((l) => PARA_TODOS.includes(l.href));
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Más</h1>
      <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
        {links.map((l) => (
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
