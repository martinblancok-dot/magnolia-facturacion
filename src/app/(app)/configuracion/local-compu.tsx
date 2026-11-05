"use client";
// El local de la caja se elige una vez por compu. Cambiarlo solo se puede desde acá (dueños).
import { useEffect, useState } from "react";

const LOCALES = [{ id: 1, nombre: "Magnolia Home" }, { id: 2, nombre: "Magnolia Beauty" }];

export function LocalCompu() {
  const [local, setLocal] = useState<number | null>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    // vive en esta compu (localStorage): se lee recién en el navegador
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setLocal(Number(localStorage.getItem("magnolia-local")) || null); } catch {}
    setListo(true);
  }, []);
  const elegir = (id: number) => {
    if (!confirm(`¿Seguro? Desde ahora las ventas de esta compu se van a registrar en ${LOCALES.find((l) => l.id === id)?.nombre}.`)) return;
    try { localStorage.setItem("magnolia-local", String(id)); } catch {}
    setLocal(id);
  };
  if (!listo) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-sm">Ahora: <b>{LOCALES.find((l) => l.id === local)?.nombre ?? "sin elegir"}</b></span>
      {LOCALES.filter((l) => l.id !== local).map((l) => (
        <button key={l.id} className="boton-borde" onClick={() => elegir(l.id)}>Cambiar a {l.nombre}</button>
      ))}
    </div>
  );
}
