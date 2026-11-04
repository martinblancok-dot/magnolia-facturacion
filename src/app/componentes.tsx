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

export function Menu({ nombre, salir }: { nombre: string; salir: () => Promise<void> }) {
  const ruta = usePathname();
  const items = [
    { href: "/", texto: "Cobros" },
    { href: "/facturas", texto: "Facturas" },
    { href: "/monotributo", texto: "Monotributo" },
    { href: "/configuracion", texto: "Configuración" },
  ];
  return (
    <header className="border-b border-linea bg-white">
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <span className="font-semibold text-marca">Magnolia · Facturación</span>
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={`text-sm ${ruta === i.href ? "font-semibold text-tinta" : "text-suave hover:text-tinta"}`}
          >
            {i.texto}
          </Link>
        ))}
        <span className="ml-auto text-sm text-suave">{nombre}</span>
        <form action={salir}>
          <button className="text-sm text-suave underline hover:text-tinta">Salir</button>
        </form>
      </nav>
    </header>
  );
}
