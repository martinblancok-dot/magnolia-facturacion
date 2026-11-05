"use client";
// Pantalla de caja. Funciona sin internet: el catálogo y las ventas se guardan en la compu
// y las ventas se suben solas cuando vuelve la conexión.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agregar, armarVenta, buscar, MEDIOS, precioUnitario, redondear, totales,
  type ItemCarrito, type MedioPago, type ProductoCaja,
} from "@/lib/caja";
import { encolar, guardar, guardarVenta, leer, type TurnoLocal } from "@/lib/caja-local";
import { guardarTurno, subirTodo, turnoGuardado } from "@/lib/caja-sync";

const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(n);

interface Catalogo {
  version: string;
  productos: ProductoCaja[];
  locales: { id: number; nombre: string }[];
  guardado: string;
}

type Estado = "conectado" | "sin-conexion" | "sin-sesion";

function idTerminal(): string {
  try {
    let t = localStorage.getItem("magnolia-terminal");
    if (!t) { t = crypto.randomUUID().slice(0, 8); localStorage.setItem("magnolia-terminal", t); }
    return t;
  } catch { return "sin-id"; }
}

export function Caja() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [cargandoCat, setCargandoCat] = useState(true);
  const [local, setLocal] = useState<number | null>(null);
  const [items, setItems] = useState<ItemCarrito[]>([]);
  const [medio, setMedio] = useState<MedioPago>("efectivo");
  const [busqueda, setBusqueda] = useState("");
  const [pagaCon, setPagaCon] = useState("");
  const [pendientes, setPendientes] = useState(0);
  const [estado, setEstado] = useState<Estado>("conectado");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [varios, setVarios] = useState(false);
  const [turno, setTurno] = useState<TurnoLocal | null>(null);
  const [buscandoTurno, setBuscandoTurno] = useState(true);
  const [fondoSugerido, setFondoSugerido] = useState<number | null>(null);
  const [movForm, setMovForm] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // ---- Catálogo: primero lo guardado, después lo último del servidor
  const actualizarCatalogo = useCallback(async () => {
    try {
      const r = await fetch("/api/catalogo", { cache: "no-store" });
      if (r.status === 401) { setEstado("sin-sesion"); return; }
      if (!r.ok) throw new Error();
      const d = await r.json();
      const c: Catalogo = { version: d.version, productos: d.productos, locales: d.locales, guardado: new Date().toISOString() };
      await guardar("catalogo", c);
      setCatalogo(c);
      setEstado("conectado");
    } catch {
      setEstado("sin-conexion");
    }
  }, []);

  // ---- Subir lo pendiente (aperturas, retiros y ventas)
  const subir = useCallback(async () => {
    const r = await subirTodo();
    setPendientes(r.pendientes);
    setEstado(r.estado);
    if (r.rechazos.length) setAviso({ ok: false, texto: `${r.rechazos.length} venta(s) no se pudieron subir: ${r.rechazos[0]}` });
  }, []);

  useEffect(() => {
    // El local elegido vive en esta compu (localStorage): se lee recién en el navegador.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const l = Number(localStorage.getItem("magnolia-local")); if (l) setLocal(l); } catch {}
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    (async () => {
      try {
        const c = await leer<Catalogo>("catalogo");
        if (c) setCatalogo(c);
      } catch {}
      await actualizarCatalogo();
      setCargandoCat(false);
      await subir();
    })();
    const enLinea = () => { subir(); actualizarCatalogo(); };
    const fuera = () => setEstado("sin-conexion");
    window.addEventListener("online", enLinea);
    window.addEventListener("offline", fuera);
    const cada = setInterval(subir, 20_000);
    const catalogoCada = setInterval(actualizarCatalogo, 10 * 60_000);
    return () => {
      window.removeEventListener("online", enLinea);
      window.removeEventListener("offline", fuera);
      clearInterval(cada);
      clearInterval(catalogoCada);
    };
  }, [actualizarCatalogo, subir]);

  // ---- Turno de caja: el guardado en esta compu, o uno abierto en el servidor para este local
  useEffect(() => {
    if (!local) return;
    let cancelado = false;
    (async () => {
      const t = turnoGuardado(local);
      if (t) { if (!cancelado) { setTurno(t); setBuscandoTurno(false); } return; }
      try {
        const r = await fetch(`/api/caja/sync?local=${local}`, { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          if (!cancelado && d.abierto) { guardarTurno(d.abierto); setTurno(d.abierto); }
          if (!cancelado) setFondoSugerido(d.ultimoDeja === null ? null : Number(d.ultimoDeja));
        }
      } catch {}
      if (!cancelado) setBuscandoTurno(false);
    })();
    return () => { cancelado = true; };
  }, [local]);

  const abrirCaja = async (fondo: number) => {
    if (!local) return;
    const t: TurnoLocal = { id: crypto.randomUUID(), local_id: local, terminal: idTerminal(), abierta_en: new Date().toISOString(), fondo_inicial: fondo };
    await encolar({ id: t.id, clase: "turno", datos: t });
    guardarTurno(t);
    setTurno(t);
    setAviso({ ok: true, texto: `Caja abierta con ${pesos(fondo)} de cambio.` });
    subir();
    setTimeout(() => entrada.current?.focus(), 50);
  };

  const registrarMovimiento = async (tipo: "retiro" | "gasto" | "ingreso", monto: number, motivo: string) => {
    if (!turno || !(monto > 0)) return;
    const id = crypto.randomUUID();
    await encolar({ id, clase: "movimiento", datos: { id, turno_id: turno.id, tipo, monto, motivo, creado_en: new Date().toISOString() } });
    setMovForm(false);
    setAviso({ ok: true, texto: `${tipo === "retiro" ? "Retiro" : tipo === "gasto" ? "Gasto" : "Ingreso"} de ${pesos(monto)} anotado.` });
    subir();
  };

  // ---- Búsqueda
  const { cantidadPedida, textoBuscado } = useMemo(() => {
    const m = busqueda.match(/^\s*(\d{1,3})\s*[*x]\s*(.+)$/i); // "3*codigo" = 3 unidades
    return m ? { cantidadPedida: Number(m[1]), textoBuscado: m[2] } : { cantidadPedida: 1, textoBuscado: busqueda };
  }, [busqueda]);
  const resultado = useMemo(
    () => (catalogo && textoBuscado.trim().length >= 2 ? buscar(catalogo.productos, textoBuscado) : { exacto: null, resultados: [] }),
    [catalogo, textoBuscado],
  );

  const sumar = (p: ProductoCaja) => {
    setItems((it) => agregar(it, p, cantidadPedida));
    setBusqueda("");
    setAviso(null);
    entrada.current?.focus();
  };

  const alEnter = () => {
    if (resultado.exacto) return sumar(resultado.exacto);
    if (resultado.resultados.length === 1) return sumar(resultado.resultados[0]);
    if (textoBuscado.trim() && resultado.resultados.length === 0) setAviso({ ok: false, texto: `No encontré "${textoBuscado.trim()}". Probá con el nombre o cargalo como "Varios".` });
  };

  const t = totales(items, medio);
  const pago = Number(pagaCon.replace(/\./g, "").replace(",", ".")) || 0;
  const vuelto = medio === "efectivo" && pago > 0 ? redondear(pago - t.total) : null;

  const cobrar = async () => {
    if (!local || items.length === 0) return;
    if (medio === "efectivo" && pago > 0 && pago < t.total) { setAviso({ ok: false, texto: "El pago es menor al total." }); return; }
    const v = { ...armarVenta(items, medio, local, idTerminal(), pago > 0 ? pago : null, crypto.randomUUID()), turno_id: turno?.id ?? null };
    try {
      await guardarVenta(v);
    } catch {
      setAviso({ ok: false, texto: "No se pudo guardar la venta en esta compu. Probá de nuevo." });
      return;
    }
    setAviso({ ok: true, texto: `Venta guardada: ${pesos(v.total)} en ${MEDIOS.find((m) => m.id === medio)?.nombre}` + (vuelto && vuelto > 0 ? ` · Vuelto ${pesos(vuelto)}` : "") });
    setItems([]);
    setPagaCon("");
    setMedio("efectivo");
    entrada.current?.focus();
    subir();
  };

  const elegirLocal = (id: number) => {
    setLocal(id);
    try { localStorage.setItem("magnolia-local", String(id)); } catch {}
    setTimeout(() => entrada.current?.focus(), 50);
  };

  const nombreLocal = catalogo?.locales.find((l) => l.id === local)?.nombre ?? (local === 2 ? "Magnolia Beauty" : local === 1 ? "Magnolia Home" : "");

  // ---- Elegir local (una vez por compu)
  if (!local) {
    const locales = catalogo?.locales?.length ? catalogo.locales : [{ id: 1, nombre: "Magnolia Home" }, { id: 2, nombre: "Magnolia Beauty" }];
    return (
      <main className="mx-auto mt-20 max-w-md px-6 text-center">
        <h1 className="text-2xl font-semibold">¿En qué local está esta caja?</h1>
        <p className="mt-2 text-suave">Se elige una sola vez por compu. Las ventas se registran en ese local.</p>
        <div className="mt-6 grid gap-3">
          {locales.map((l) => <button key={l.id} className="boton justify-center !py-4 text-base" onClick={() => elegirLocal(l.id)}>{l.nombre}</button>)}
        </div>
      </main>
    );
  }

  // ---- Abrir caja
  if (!turno) {
    return (
      <main className="mx-auto mt-16 max-w-md px-6">
        <h1 className="text-2xl font-semibold">Abrir caja · {nombreLocal}</h1>
        {buscandoTurno ? <p className="mt-4 text-suave">Buscando caja abierta…</p> : (
          <form className="tarjeta mt-6 space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const n = Number(String(new FormData(e.currentTarget).get("fondo")).replace(/\./g, "").replace(",", "."));
            if (n >= 0) abrirCaja(n);
          }}>
            <label className="block">
              <span className="etiqueta">Efectivo de cambio con el que arranca la caja</span>
              <input name="fondo" className="campo !text-lg" inputMode="decimal" autoFocus required defaultValue={fondoSugerido ?? ""} placeholder="0" />
              {fondoSugerido !== null && <span className="ayuda block">En el último cierre se dejaron {pesos(fondoSugerido)}.</span>}
            </label>
            <button className="boton w-full justify-center !py-3 text-base">Abrir caja</button>
            {estado === "sin-conexion" && <p className="text-sm text-amber-800">Sin internet: la caja se abre igual y se avisa al servidor cuando vuelva la conexión.</p>}
          </form>
        )}
        <p className="mt-4 text-center text-sm"><Link href="/ventas" className="text-suave underline">Ir al menú</Link></p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-linea bg-white px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Link href="/ventas" className="text-sm text-suave underline">Menú</Link>
        <span className="font-semibold text-marca">Caja · {nombreLocal}</span>
        <span className="hidden text-sm text-suave sm:inline">abierta {new Date(turno.abierta_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
        <button className="text-sm text-suave underline" onClick={() => setMovForm((x) => !x)}>Retiro / gasto</button>
        <Link href={`/caja/cierre?turno=${turno.id}`} className="text-sm font-semibold text-marca underline">Cerrar caja</Link>
        <span className="ml-auto flex items-center gap-2 text-sm">
          {estado === "sin-conexion" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Sin internet</span>}
          {estado === "sin-sesion" && <a href="/ingresar" className="rounded-full bg-red-100 px-2 py-0.5 text-red-800 underline">Iniciá sesión para subir ventas</a>}
          {pendientes > 0
            ? <span className="rounded-full bg-marca-claro px-2 py-0.5 text-marca">{pendientes} sin subir</span>
            : estado === "conectado" && <span className="text-green-700">✓ Al día</span>}
        </span>
      </header>

      {movForm && (
        <form className="flex flex-wrap items-end gap-3 border-b border-linea bg-marca-claro px-4 py-3" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          registrarMovimiento(f.get("tipo") as "retiro" | "gasto" | "ingreso", Number(String(f.get("monto")).replace(/\./g, "").replace(",", ".")), String(f.get("motivo") ?? ""));
        }}>
          <label><span className="etiqueta">Tipo</span>
            <select name="tipo" className="campo"><option value="retiro">Retiro de efectivo</option><option value="gasto">Gasto (pago con la caja)</option><option value="ingreso">Ingreso de efectivo</option></select>
          </label>
          <label className="w-36"><span className="etiqueta">Monto</span><input name="monto" className="campo" inputMode="decimal" required /></label>
          <label className="min-w-40 flex-1"><span className="etiqueta">Motivo</span><input name="motivo" className="campo" placeholder="Ej: pago flete, retiro Martín" /></label>
          <button className="boton">Anotar</button>
          <button type="button" className="text-sm text-suave underline" onClick={() => setMovForm(false)}>Cancelar</button>
        </form>
      )}

      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_380px]">
        {/* Izquierda: búsqueda y carrito */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="relative">
            <input
              ref={entrada}
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); alEnter(); }
                if (e.key === "Escape") setBusqueda("");
              }}
              placeholder={cargandoCat && !catalogo ? "Cargando productos…" : "Escaneá o buscá por nombre / SKU (3*código = 3 unidades)"}
              className="campo !py-3 !text-lg"
              autoComplete="off"
              inputMode="search"
            />
            {busqueda.trim().length >= 2 && !resultado.exacto && resultado.resultados.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-96 overflow-auto rounded-xl border border-linea bg-white shadow-lg">
                {resultado.resultados.map((p) => (
                  <li key={p[0]}>
                    <button onClick={() => sumar(p)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-marca-claro">
                      <span className="min-w-0"><span className="block truncate">{p[3]}</span><span className="text-xs text-suave">{p[2]}</span></span>
                      <span className="text-right text-sm whitespace-nowrap"><b>{pesos(p[5])}</b><span className="block text-xs text-suave">lista {pesos(p[4])}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!catalogo && !cargandoCat && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              No hay productos guardados en esta compu. Conectate a internet una vez para bajar el catálogo
              {estado === "sin-sesion" ? " (e iniciá sesión)" : ""}.
            </p>
          )}

          <div className="flex-1 rounded-2xl border border-linea bg-white">
            {items.length === 0 ? (
              <p className="p-10 text-center text-suave">Escaneá un producto para empezar.</p>
            ) : (
              <ul className="divide-y divide-linea">
                {items.map((it, i) => (
                  <li key={`${it.producto_id ?? "v"}-${i}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium sm:truncate">{it.nombre}</span>
                      <span className="text-xs text-suave">{it.sku ?? "Varios"} · {pesos(precioUnitario(it, medio))} c/u</span>
                    </span>
                    <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <button aria-label="Uno menos" className="boton-borde !h-9 !w-9 justify-center !p-0"
                        onClick={() => setItems((x) => x.flatMap((y, j) => (j !== i ? [y] : y.cantidad > 1 ? [{ ...y, cantidad: y.cantidad - 1 }] : [])))}>−</button>
                      <span className="w-8 text-center font-semibold">{it.cantidad}</span>
                      <button aria-label="Uno más" className="boton-borde !h-9 !w-9 justify-center !p-0"
                        onClick={() => setItems((x) => x.map((y, j) => (j === i ? { ...y, cantidad: y.cantidad + 1 } : y)))}>+</button>
                    </span>
                    <span className="ml-auto w-28 text-right font-semibold">{pesos(precioUnitario(it, medio) * it.cantidad)}</span>
                    <button aria-label="Quitar" className="px-2 text-xl text-suave hover:text-red-700" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>×</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="boton-borde" onClick={() => setVarios((v) => !v)}>+ Varios (sin código)</button>
            {items.length > 0 && <button className="text-sm text-suave underline" onClick={() => { setItems([]); entrada.current?.focus(); }}>Vaciar</button>}
          </div>
          {varios && (
            <form className="tarjeta flex flex-wrap items-end gap-3" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const precio = Number(String(f.get("precio")).replace(/\./g, "").replace(",", "."));
              if (!(precio > 0)) return;
              const efectivo = f.get("descuento") === "on" ? Math.round((precio * 0.85) / 50) * 50 : precio;
              setItems((x) => [...x, { producto_id: null, barcode: null, sku: null, nombre: String(f.get("nombre") || "Varios"), cantidad: 1, lista: precio, efectivo }]);
              setVarios(false);
              entrada.current?.focus();
            }}>
              <label className="min-w-40 flex-1"><span className="etiqueta">Descripción</span><input name="nombre" className="campo" placeholder="Varios" /></label>
              <label className="w-36"><span className="etiqueta">Precio lista</span><input name="precio" className="campo" inputMode="decimal" required /></label>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="descuento" defaultChecked /> 15% en efectivo</label>
              <button className="boton">Agregar</button>
            </form>
          )}
        </section>

        {/* Derecha: cobro */}
        <section className="tarjeta flex h-fit flex-col gap-4 lg:sticky lg:top-4">
          <div>
            <p className="text-sm text-suave">{t.unidades} {t.unidades === 1 ? "unidad" : "unidades"}</p>
            <p className="text-4xl font-semibold">{pesos(t.total)}</p>
            {items.length > 0 && (
              <p className="mt-1 text-sm text-suave">
                Efectivo {pesos(t.efectivo)} · Transf./débito/1 pago {pesos(t.diez)} · Lista {pesos(t.lista)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {MEDIOS.map((m) => (
              <button key={m.id} onClick={() => setMedio(m.id)}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${medio === m.id ? "border-marca bg-marca text-white" : "border-linea bg-white"} `}>
                {m.nombre}
              </button>
            ))}
          </div>

          {medio === "efectivo" && (
            <label>
              <span className="etiqueta">Paga con (opcional)</span>
              <input value={pagaCon} onChange={(e) => setPagaCon(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cobrar()}
                className="campo !text-lg" inputMode="decimal" placeholder="0" />
              {vuelto !== null && <span className={`mt-1 block text-lg font-semibold ${vuelto < 0 ? "text-red-700" : "text-green-800"}`}>Vuelto: {pesos(Math.max(0, vuelto))}{vuelto < 0 ? ` (faltan ${pesos(-vuelto)})` : ""}</span>}
            </label>
          )}

          <button className="boton justify-center !py-4 text-lg" disabled={items.length === 0} onClick={cobrar}>
            Cobrar {items.length > 0 ? pesos(t.total) : ""}
          </button>

          {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{aviso.texto}</p>}

          <p className="text-xs text-suave">
            {catalogo ? `${catalogo.productos.length} productos en esta compu` : "Sin catálogo"}
            {catalogo?.guardado ? ` · actualizado ${new Date(catalogo.guardado).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}
            {" · "}
            <button className="underline" onClick={() => { localStorage.removeItem("magnolia-local"); setLocal(null); }}>cambiar local</button>
          </p>
        </section>
      </main>
    </div>
  );
}
