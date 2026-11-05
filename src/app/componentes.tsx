"use client";
// Piezas de pantalla que reaccionan a los clics.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useTransition, useState } from "react";
import type { Mensaje } from "./acciones";

export function Aviso({ m }: { m: Mensaje | null }) {
  if (!m) return null;
  return (
    <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${m.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
      {m.texto}
    </p>
  );
}

/** Un formulario que llama a una acción del servidor y muestra el resultado. */
export function Formulario({
  accion,
  children,
  boton,
  className,
}: {
  accion: (prev: Mensaje | null, f: FormData) => Promise<Mensaje>;
  children: React.ReactNode;
  boton: string;
  className?: string;
}) {
  const [msg, enviar, cargando] = useActionState(accion, null);
  return (
    <form action={enviar} className={className}>
      {children}
      <button className="boton mt-4" disabled={cargando}>
        {cargando ? "Un momento…" : boton}
      </button>
      <Aviso m={msg} />
    </form>
  );
}

/** Un botón suelto que llama a una acción y muestra el resultado. */
export function BotonAccion({ accion, texto, borde }: { accion: () => Promise<Mensaje>; texto: string; borde?: boolean }) {
  const [msg, setMsg] = useState<Mensaje | null>(null);
  const [cargando, empezar] = useTransition();
  return (
    <div>
      <button
        className={borde ? "boton-borde" : "boton"}
        disabled={cargando}
        onClick={() => empezar(async () => setMsg(await accion()))}
      >
        {cargando ? "Un momento…" : texto}
      </button>
      <Aviso m={msg} />
    </div>
  );
}

const ICONOS: Record<string, React.ReactNode> = {
  "/caja": <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 20h10M12 16v4M7 9h4" /></>,
  "/ventas": <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  "/productos": <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7" /></>,
  "/cobros": <path d="M3 7h18M3 12h18M3 17h12" />,
  "/stock": <><path d="M4 7h3M4 12h3M4 17h3" /><path d="M10 5v14M13 5v14M17 5v14M20 5v14" /></>,
  "/mas": <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
};

export function Menu({ nombre, duenio, salir }: { nombre: string; duenio: boolean; salir: () => Promise<void> }) {
  const ruta = usePathname();
  const todos = [
    { href: "/caja", texto: "Caja" },
    { href: "/ventas", texto: "Ventas" },
    { href: "/productos", texto: "Productos" },
    { href: "/stock", texto: "Stock" },
    { href: "/cobros", texto: "Cobros" },
    { href: "/facturas", texto: "Facturas" },
    { href: "/monotributo", texto: "Monotributo" },
    { href: "/configuracion", texto: "Configuración" },
  ];
  // Cobros, facturas, monotributo y configuración: solo Martín y Sofi
  const items = duenio ? todos : todos.filter((i) => ["/caja", "/ventas", "/productos", "/stock"].includes(i.href));
  const abajo = duenio ? ["/caja", "/ventas", "/stock", "/cobros", "/mas"] : ["/caja", "/ventas", "/productos", "/stock", "/mas"];
  const nombres: Record<string, string> = { "/mas": "Más" };
  const activo = (href: string) =>
    href === "/ventas" ? ruta.startsWith("/ventas") || ruta.startsWith("/cierres") || ruta.startsWith("/giftcards") :
    href === "/mas" ? ["/mas", ...(duenio ? ["/productos"] : []), "/facturas", "/monotributo", "/configuracion", "/usuarios"].some((r) => ruta.startsWith(r)) : ruta.startsWith(href);
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-linea bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3 md:px-6">
          <span className="font-semibold text-marca">Magnolia</span>
          {items.map((i) => (
            <Link key={i.href} href={i.href}
              className={`hidden text-sm md:inline ${activo(i.href) ? "font-semibold text-tinta" : "text-suave hover:text-tinta"}`}>
              {i.texto}
            </Link>
          ))}
          <span className="ml-auto truncate text-sm text-suave">{nombre}</span>
          <form action={salir}>
            <button className="py-2 text-sm text-suave underline hover:text-tinta">Salir</button>
          </form>
        </nav>
      </header>
      {/* Barra de abajo en celular */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-linea bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {abajo.map((href) => (
          <Link key={href} href={href}
            className={`flex flex-col items-center gap-1 py-2 text-[11px] ${activo(href) ? "font-semibold text-marca" : "text-suave"}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={activo(href) ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
              {ICONOS[href]}
            </svg>
            {nombres[href] ?? items.find((i) => i.href === href)?.texto}
          </Link>
        ))}
      </nav>
    </>
  );
}
