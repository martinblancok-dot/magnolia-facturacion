"use client";
// Para Martín y Sofi: avisa en vivo si hay descuentos o anulaciones esperando su autorización.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function AvisosDuenio({ inicial }: { inicial: { descuentos: number; anulaciones: number; codigos?: number } }) {
  const [n, setN] = useState(inicial);
  const ruta = usePathname();
  useEffect(() => {
    const ver = async () => {
      try {
        const r = await fetch("/api/autorizaciones", { cache: "no-store" });
        if (r.ok) setN(await r.json());
      } catch {}
    };
    const cada = setInterval(ver, 15_000);
    return () => clearInterval(cada);
  }, []);
  if (!n.descuentos && !n.anulaciones && !n.codigos) return null;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {n.descuentos > 0 && ruta !== "/autorizaciones" && (
        <Link href="/autorizaciones" className="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ✂ {n.descuentos === 1 ? "Hay 1 descuento" : `Hay ${n.descuentos} descuentos`} esperando tu autorización en la caja. <u>Revisar →</u>
        </Link>
      )}
      {n.anulaciones > 0 && ruta !== "/ventas" && (
        <Link href="/ventas" className="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠ {n.anulaciones === 1 ? "Hay 1 anulación de venta" : `Hay ${n.anulaciones} anulaciones de venta`} esperando tu autorización. <u>Revisar →</u>
        </Link>
      )}
      {!!n.codigos && ruta !== "/configuracion/planilla" && (
        <Link href="/configuracion/planilla" className="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠ {n.codigos === 1 ? "Hay 1 código de barras original repetido" : `Hay ${n.codigos} códigos de barras originales repetidos`} en Precios Deco: no se cargaron. <u>Ver cuáles →</u>
        </Link>
      )}
    </div>
  );
}

/** Refresca la pantalla cada tanto (para ver pedidos nuevos sin recargar). */
export function Refrescar({ segundos = 10 }: { segundos?: number }) {
  useEffect(() => {
    const cada = setInterval(() => window.location.reload(), segundos * 1000);
    return () => clearInterval(cada);
  }, [segundos]);
  return null;
}
