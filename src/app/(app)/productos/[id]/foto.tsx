"use client";
// Foto del producto (miniatura): subir, reemplazar o quitar. Solo se muestra a los dueños.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Miniatura } from "../../../miniatura";
import { achicarFoto } from "@/lib/fotos-cliente";

export function FotoProducto({ productoId, ruta, nombre }: { productoId: string; ruta: string | null; nombre: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [actual, setActual] = useState(ruta);
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const subir = async (archivo: File) => {
    setOcupado(true); setEstado(null);
    try {
      const fd = new FormData();
      fd.set("foto", await achicarFoto(archivo), "foto");
      fd.set("producto_id", productoId);
      const r = await fetch("/api/productos/foto", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.estado !== "ok") throw new Error(d.error ?? "No se pudo subir la foto.");
      setActual(d.url);
      setEstado({ ok: true, texto: `Foto guardada (${Math.round(d.bytes / 1024)} KB).` });
      router.refresh();
    } catch (e) { setEstado({ ok: false, texto: (e as Error).message }); }
    setOcupado(false);
    if (input.current) input.current.value = "";
  };

  const quitar = async () => {
    setOcupado(true); setEstado(null);
    const r = await fetch(`/api/productos/foto?producto_id=${productoId}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setActual(null); setEstado({ ok: true, texto: "Foto quitada." }); router.refresh(); }
    else setEstado({ ok: false, texto: d.error ?? "No se pudo quitar." });
    setOcupado(false);
  };

  return (
    <div className="tarjeta flex flex-wrap items-center gap-4">
      <Miniatura ruta={actual} tam={120} alt={nombre} />
      <div className="space-y-2">
        <p className="font-semibold">Foto</p>
        <p className="ayuda">Se achica sola a una miniatura de 300×300. La foto grande va en Tiendanube.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
          <button type="button" className="boton" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? "Guardando…" : actual ? "Cambiar foto" : "Subir foto"}</button>
          {actual && <button type="button" className="text-sm text-red-800 underline" disabled={ocupado} onClick={quitar}>Quitar foto</button>}
        </div>
        {estado && <p className={`text-sm ${estado.ok ? "text-green-800" : "text-red-700"}`}>{estado.ok ? "✓ " : ""}{estado.texto}</p>}
      </div>
    </div>
  );
}
