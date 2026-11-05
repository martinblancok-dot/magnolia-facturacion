import { nombreMedio } from "@/lib/caja";
import { pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioConRol } from "@/lib/supabase/sesion";

type Tarjeta = { id: string; codigo: string; monto: number; saldo: number; medio_origen: string; local_id: number; creada_en: string; anulada: boolean };

export default async function GiftCards({ searchParams }: { searchParams: Promise<{ q?: string; todas?: string }> }) {
  await usuarioConRol();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toUpperCase().replace(/^GC/, "").replace(/[^0-9A-F]/g, "");
  const db = clienteServidor();
  let c = db.from("giftcards").select("id, codigo, monto, saldo, medio_origen, local_id, creada_en, anulada").order("creada_en", { ascending: false }).limit(300);
  if (q) c = c.ilike("codigo", `%${q}%`);
  else if (!sp.todas) c = c.gt("saldo", 0).eq("anulada", false);
  const { data, error } = await c;
  const tarjetas = (data ?? []) as Tarjeta[];
  const enCirculacion = tarjetas.filter((t) => !t.anulada).reduce((s, t) => s + Number(t.saldo), 0);
  const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Gift cards</h1>
        <p className="text-sm text-suave">Se venden desde la caja (🎁 Vender gift card) y se usan en los dos locales con el botón 🎁 Gift card al cobrar.</p>
      </div>
      <form className="flex gap-2">
        <input name="q" defaultValue={sp.q ?? ""} className="campo uppercase" placeholder="Escaneá o escribí el código" autoComplete="off" />
        <button className="boton">Buscar</button>
      </form>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0011_giftcards.sql</b> en Supabase.</p>
      ) : (
        <>
          {!q && (
            <p className="text-sm">
              {sp.todas ? "Todas las gift cards." : <>Con saldo para usar: <b>{pesos(enCirculacion)}</b> en {tarjetas.length} tarjetas.</>}{" "}
              <a href={sp.todas ? "/giftcards" : "/giftcards?todas=1"} className="text-marca underline">{sp.todas ? "Ver solo las que tienen saldo" : "Ver todas"}</a>
            </p>
          )}
          <div className="rounded-2xl border border-linea bg-white">
            {tarjetas.length === 0 ? <p className="px-6 py-10 text-center text-suave">{q ? `No hay ninguna gift card con el código ${q}.` : "Todavía no hay gift cards."}</p> : (
              <ul className="divide-y divide-linea">
                {tarjetas.map((t) => (
                  <li key={t.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6 ${t.anulada ? "opacity-50" : ""}`}>
                    <span>
                      <b className="font-mono">{t.codigo}</b>{t.anulada && <span className="ml-2 text-sm font-semibold text-red-700">ANULADA</span>}
                      <span className="block text-sm text-suave">
                        Vendida el {fecha(t.creada_en)} en {t.local_id === 2 ? "Magnolia Beauty" : "Magnolia Home"} · {pesos(Number(t.monto))} en {nombreMedio(t.medio_origen)}
                      </span>
                    </span>
                    <span className="text-right">
                      <b className={Number(t.saldo) > 0 ? "text-green-800" : "text-suave"}>{pesos(Number(t.saldo))}</b>
                      <span className="block text-xs text-suave">saldo</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
