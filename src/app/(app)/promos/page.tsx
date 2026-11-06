import Link from "next/link";
import { cambiarPromo } from "../../acciones";
import { BotonAccion } from "../../componentes";
import { describirPromo } from "@/lib/promos";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerEstado } from "@/lib/supabase/planilla";
import { soloDuenio } from "@/lib/supabase/sesion";
import { NuevaPromo } from "./formulario";

const ALCANCE: Record<string, string> = { todo: "todos los productos", categoria: "categorías", proveedor: "proveedores", sku: "productos" };

export default async function Promos() {
  await soloDuenio();
  const db = clienteServidor();
  const [{ data: promos, error }, estado, { data: cats }] = await Promise.all([
    db.from("promos").select("*").order("activa", { ascending: false }).order("creada_en", { ascending: false }),
    leerEstado(db),
    db.from("productos").select("categoria").eq("activo", true).not("categoria", "is", null).limit(5000),
  ]);
  const categorias = [...new Set((cats ?? []).flatMap((c) => { const p = String(c.categoria).split("/"); return [p[0], c.categoria as string]; }))].sort();
  const fecha = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR") : null);

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
      <div>
        <h1 className="text-2xl font-semibold">Promociones</h1>
        <p className="text-sm text-suave">Se aplican solas en la caja cuando se cumplen, y aparecen en el recibo.</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0016_cambios_promos.sql</b> en Supabase.</p>}
      {(promos ?? []).length > 0 && (
        <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
          {(promos ?? []).map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${p.activa ? "" : "opacity-60"}`}>
              <span>
                <b>{p.nombre}</b> {p.activa ? <span className="ml-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">Activa</span> : <span className="ml-1 rounded-full bg-linea px-2 py-0.5 text-xs">Pausada</span>}
                <span className="block text-sm text-suave">
                  {describirPromo(p)} · {ALCANCE[p.alcance]}{p.valores?.length ? `: ${p.valores.join(", ")}` : ""}
                  {p.desde || p.hasta ? ` · ${p.desde ? `desde ${fecha(p.desde)} ` : ""}${p.hasta ? `hasta ${fecha(p.hasta)}` : ""}` : ""}
                </span>
              </span>
              <span className="flex gap-2">
                <BotonAccion accion={cambiarPromo.bind(null, p.id, p.activa ? "pausar" : "activar")} texto={p.activa ? "Pausar" : "Activar"} borde />
                <BotonAccion accion={cambiarPromo.bind(null, p.id, "eliminar")} texto="Eliminar" borde />
              </span>
            </li>
          ))}
        </ul>
      )}
      <NuevaPromo categorias={categorias} proveedores={estado?.hojas ?? []} />
    </div>
  );
}
