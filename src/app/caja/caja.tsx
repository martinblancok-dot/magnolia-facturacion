"use client";
// Pantalla de caja. Funciona sin internet: el catálogo y las ventas se guardan en la compu
// y las ventas se suben solas cuando vuelve la conexión.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PedidosWeb } from "./pedidos-web";
import { clave, esPrueba, paramPrueba } from "@/lib/modo-prueba";
import type { PedidoCaja } from "@/lib/tiendanube-pedidos";
import {
  agregar, armarVenta, armarVentaCambio, armarVentaCambioCuenta, armarVentaGiftcard, cobroCambio, creditoCambio, type CambioEnCurso, type Extras, armarVentaNuevaGiftcard, buscar, cobroConGiftcard, codigoGiftcard, MEDIOS_CAJA, nombreMedio,
  precioUnitario, redondear, totales, type GiftCard, type ItemCarrito, type MedioPago, type ProductoCaja, type VentaParaSubir,
  armarVentaDividida, cobroDividido, porCodigo,
} from "@/lib/caja";
import { encolar, guardar, guardarVenta, leer, outbox, ventasPendientes, type Apertura, type TurnoLocal } from "@/lib/caja-local";
import { DENOMINACIONES, totalBilletes } from "@/lib/cierre";
import { guardarTurno, subirTodo, turnoDeEstaCompu } from "@/lib/caja-sync";
import { codigoVenta, type VentaImpresa } from "@/lib/impresion";
import { BotonTicketsCambio, useImpresion } from "../impreso";
import { BotonCamara, EscanerCamara } from "../escaner";
import type { DescuentoManual, Promo } from "@/lib/promos";

const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(n);

/** Una venta en curso. Puede haber varias abiertas a la vez (se atiende a más de una persona). */
interface Carrito {
  id: string;
  nombre?: string; // opcional: el nombre del cliente, para reconocerla rápido
  items: ItemCarrito[];
  medio: MedioPago;
  pagaCon: string;
  modoGc: boolean; // vendiendo una gift card
  montoGc: string;
  paraGc?: string; // a quién se le regala la gift card
  gc: GiftCard | null; // gift card con la que se paga
  codigoGc: string;
  medioResto: MedioPago;
  cambio?: CambioEnCurso | null; // cambio o devolución de una venta anterior
  descuento?: DescuentoManual | null;
  dividir?: { monto: string; resto: MedioPago } | null; // pago en dos medios
  cc?: ClienteCaja | null; // venta a cuenta corriente: la clienta
}
type ClienteCaja = { id: string; nombre: string; telefono?: string | null; limite: number; debe: number };
const carritoNuevo = (): Carrito => ({ id: crypto.randomUUID(), items: [], medio: "efectivo", pagaCon: "", modoGc: false, montoGc: "", gc: null, codigoGc: "", medioResto: "efectivo" });
const vacio = (c: Carrito) => c.items.length === 0 && !c.modoGc && !c.gc && !c.cambio;

interface Catalogo {
  version: string;
  promos?: Promo[];
  productos: ProductoCaja[];
  locales: { id: number; nombre: string }[];
  guardado: string;
}

type Estado = "conectado" | "sin-conexion" | "sin-sesion";

function idTerminal(): string {
  try {
    let t = localStorage.getItem(clave("magnolia-terminal"));
    if (!t) { t = (esPrueba() ? "P-" : "") + crypto.randomUUID().slice(0, 8); localStorage.setItem(clave("magnolia-terminal"), t); }
    return t;
  } catch { return "sin-id"; }
}

export function Caja() {
  const [enPrueba, setEnPrueba] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setEnPrueba(esPrueba()); }, []);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [cargandoCat, setCargandoCat] = useState(true);
  const [local, setLocal] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [pendientes, setPendientes] = useState(0);
  const [estado, setEstado] = useState<Estado>("conectado");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pedidosWeb, setPedidosWeb] = useState<PedidoCaja[]>([]);
  const latirRef = useRef<() => void>(() => {});
  const [varios, setVarios] = useState(false);
  const [turno, setTurno] = useState<TurnoLocal | null>(null);
  const [miNombre, setMiNombre] = useState<string | null>(null);
  const [buscandoTurno, setBuscandoTurno] = useState(true);
  // Al abrir: de qué local, y si ya hay una caja abierta ahí (otra compu) para sumarse
  const [localApertura, setLocalApertura] = useState<number | null>(null);
  // Conteo de billetes al abrir la caja
  const [billetesAp, setBilletesAp] = useState<Record<string, string>>({});
  const [monedasAp, setMonedasAp] = useState("");
  const [notaAp, setNotaAp] = useState("");
  const [cajasAbiertas, setCajasAbiertas] = useState<Record<number, { abierto: TurnoLocal | null; ultimoDeja: number | null } | null>>({});
  const [movForm, setMovForm] = useState(false);
  const [ultima, setUltima] = useState<VentaImpresa | null>(null);
  // Gift cards: vender una (modo "giftcard") o cobrar con una (medio "giftcard")
  const [buscandoGc, setBuscandoGc] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [renombrando, setRenombrando] = useState<string | null>(null);
  // Cambio: buscar la venta original y elegir qué devuelve
  type VentaCambio = { id: string; creada_en: string; medio_pago: string; medio_precio: MedioPago; vence: string; enPlazo: boolean;
    items: { n: number; producto_id: string | null; barcode: string | null; sku: string | null; nombre: string; cantidad: number; precio_unitario: number; devuelto: number; puede: number }[];
    cliente_cc?: { id: string; nombre: string } | null };
  const [cb, setCb] = useState<null | { codigo: string; cargando: boolean; error?: string; venta?: VentaCambio; cant: Record<number, number> }>(null);
  // Descuento manual
  const [descForm, setDescForm] = useState<null | { tipo: "pct" | "monto"; valor: string; motivo: string; pedido?: string; estado?: string }>(null);
  const [soyDuenio, setSoyDuenio] = useState(false);
  // Cuentas corrientes (solo dueños): clientas para elegir y el cobro de una cuenta
  const [clientesCC, setClientesCC] = useState<ClienteCaja[] | null>(null);
  const [buscaCC, setBuscaCC] = useState("");
  const [pagoCC, setPagoCC] = useState<null | { cliente: ClienteCaja | null; monto: string; medio: string; constancia: boolean; enviando?: boolean }>(null);

  // ---- Ventas abiertas (pestañas). Se guardan en la compu por si se recarga la página.
  const [carritos, setCarritos] = useState<Carrito[]>(() => [carritoNuevo()]);
  const [activoId, setActivoId] = useState<string>(() => "");
  const c = carritos.find((x) => x.id === activoId) ?? carritos[0];
  const cambiar = (patch: Partial<Carrito> | ((x: Carrito) => Partial<Carrito>)) => {
    const id = c.id; // la venta que estaba abierta cuando se pidió el cambio
    setCarritos((cs) => cs.map((x) => (x.id === id ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)));
  };
  const setter = <K extends keyof Carrito>(k: K) => (v: Carrito[K] | ((prev: Carrito[K]) => Carrito[K])) =>
    cambiar((x) => ({ [k]: typeof v === "function" ? (v as (p: Carrito[K]) => Carrito[K])(x[k]) : v }) as Partial<Carrito>);
  const { items, medio, pagaCon, modoGc, montoGc, gc, codigoGc, medioResto } = c;
  const cambio = c.cambio ?? null;
  const setCambio = setter("cambio"), setDescuento = setter("descuento");
  const setItems = setter("items"), setMedio = setter("medio"), setPagaCon = setter("pagaCon"), setModoGc = setter("modoGc");
  const setParaGc = setter("paraGc");
  const setMontoGc = setter("montoGc"), setGc = setter("gc"), setCodigoGc = setter("codigoGc"), setMedioResto = setter("medioResto");

  useEffect(() => {
    if (!local) return;
    // Las ventas abiertas viven en esta compu (localStorage): se leen recién en el navegador.
    try {
      const guardados = JSON.parse(localStorage.getItem(clave(`magnolia-carritos-${local}`)) ?? "null") as Carrito[] | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (guardados?.length) { setCarritos(guardados.map((x) => ({ ...carritoNuevo(), ...x, gc: null }))); setActivoId(guardados[0].id); }
    } catch {}
  }, [local]);
  useEffect(() => {
    if (!local) return;
    try { localStorage.setItem(clave(`magnolia-carritos-${local}`), JSON.stringify(carritos.map((x) => ({ ...x, gc: null })))); } catch {}
  }, [carritos, local]);

  const enfocar = () => setTimeout(() => entrada.current?.focus(), 30);
  const nuevaVenta = () => {
    const n = carritoNuevo();
    setCarritos((cs) => [...cs, n]); setActivoId(n.id);
    setAviso(null); setConfirmarAnular(false); enfocar();
  };
  const irA = (id: string) => { setActivoId(id); setAviso(null); setConfirmarAnular(false); enfocar(); };
  /** Saca la venta de las abiertas (si es la única, queda una vacía). */
  const cerrarCarrito = (id: string) => {
    setCarritos((cs) => {
      const quedan = cs.filter((x) => x.id !== id);
      const lista = quedan.length ? quedan : [carritoNuevo()];
      setActivoId(lista[Math.max(0, cs.findIndex((x) => x.id === id) - 1)]?.id ?? lista[0].id);
      return lista;
    });
    setConfirmarAnular(false);
  };
  const anularEnCurso = () => {
    cerrarCarrito(c.id);
    setAviso({ ok: true, texto: "Venta anulada: no se registró nada." });
    enfocar();
  };
  const { imprimir, zona, papel, setPapel } = useImpresion();
  // después de imprimir, el lector de códigos tiene que seguir escribiendo en el buscador
  const volverAlLector = () => setTimeout(() => document.querySelector<HTMLInputElement>("input[inputmode=search]")?.focus(), 300);
  const entrada = useRef<HTMLInputElement>(null);

  // ---- Catálogo: primero lo guardado, después lo último del servidor
  const actualizarCatalogo = useCallback(async () => {
    try {
      const actual = await leer<Catalogo>("catalogo");
      const r = await fetch(`/api/catalogo${actual?.version ? `?version=${encodeURIComponent(actual.version)}` : ""}`, { cache: "no-store" });
      if (r.status === 401) { setEstado("sin-sesion"); return; }
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (d.sinCambios && actual) {
        // Nada cambió: no hace falta bajar los 6.000 productos otra vez
        const c = { ...actual, guardado: new Date().toISOString() };
        await guardar("catalogo", c);
        setCatalogo(c);
        setEstado("conectado");
        return;
      }
      const c: Catalogo = { version: d.version, productos: d.productos, promos: d.promos ?? [], locales: d.locales, guardado: new Date().toISOString() };
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
    try { const l = Number(localStorage.getItem(clave("magnolia-local"))); if (l) setLocal(l); } catch {}
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

  // ---- Quién usa la caja (los dueños aplican descuentos sin pedir autorización)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setSoyDuenio(localStorage.getItem("magnolia-rol") === "duenio"); } catch {}
    fetch("/api/yo", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setSoyDuenio(d.rol === "duenio");
      setMiNombre(d.nombre ?? null);
      try { localStorage.setItem("magnolia-rol", d.rol); } catch {}
    }).catch(() => {});
  }, []);

  // ---- Turno de caja: el que quedó abierto en esta compu; si no hay, se elige local al abrir
  useEffect(() => {
    const t = turnoDeEstaCompu();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t) { setLocal(t.local_id); setTurno(t); }
    setBuscandoTurno(false);
  }, []);

  // Estado de las cajas de los dos locales (para la pantalla de apertura)
  const verCajas = useCallback(async () => {
    const r: Record<number, { abierto: TurnoLocal | null; ultimoDeja: number | null } | null> = {};
    await Promise.all([1, 2].map(async (l) => {
      try {
        const x = await fetch(`/api/caja/sync?local=${l}${paramPrueba()}`, { cache: "no-store" });
        if (x.ok) { const d = await x.json(); r[l] = { abierto: d.abierto ?? null, ultimoDeja: d.ultimoDeja === null ? null : Number(d.ultimoDeja) }; }
        else r[l] = null;
      } catch { r[l] = null; }
    }));
    setCajasAbiertas(r);
  }, []);
  useEffect(() => {
    if (turno || buscandoTurno) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    verCajas();
  }, [turno, buscandoTurno, verCajas]);

  // ---- Cada 30 segundos: avisar que esta compu está en la caja y ver si la cerraron desde otra
  const pendientesRef = useRef(0);
  useEffect(() => { pendientesRef.current = pendientes; }, [pendientes]);
  useEffect(() => {
    if (!turno) return;
    const latir = async () => {
      try {
        const r = await fetch("/api/caja/latido", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terminal: idTerminal(), local_id: turno.local_id, turno_id: turno.id, pendientes: pendientesRef.current, prueba: esPrueba() }),
        });
        if (!r.ok) return;
        const d = await r.json();
        if (Array.isArray(d.pedidosWeb)) setPedidosWeb(d.pedidosWeb);
        if (d.turno === "cerrado") {
          guardarTurno(null);
          setTurno(null);
          setAviso({ ok: false, texto: "Esta caja se cerró desde otra compu. Para seguir vendiendo, abrí una caja nueva." });
        } else if (d.turno === "desconocido" && Date.now() - Date.parse(turno.abierta_en) > 3 * 60_000) {
          // La caja no existe en el servidor y esta compu no tiene nada sin subir: se borró (datos de prueba)
          const [cola, ventas] = await Promise.all([outbox(), ventasPendientes()]);
          if (cola.length === 0 && ventas.length === 0) {
            guardarTurno(null);
            setTurno(null);
            setAviso({ ok: false, texto: "Esta caja ya no existe (se borraron los datos de prueba). Abrí una caja nueva." });
          }
        }
      } catch {}
    };
    latirRef.current = latir;
    latir();
    const cada = setInterval(latir, 30_000);
    return () => clearInterval(cada);
  }, [turno]);

  const sumarseACaja = (t: TurnoLocal) => {
    setLocal(t.local_id);
    try { localStorage.setItem(clave("magnolia-local"), String(t.local_id)); } catch {}
    guardarTurno(t);
    setTurno(t);
    setAviso({ ok: true, texto: "Te sumaste a la caja abierta: las ventas de esta compu van al mismo cierre." });
    setTimeout(() => entrada.current?.focus(), 50);
  };

  const abrirCaja = async (local: number, fondo: number, apertura: Apertura | null = null) => {
    setLocal(local);
    try { localStorage.setItem(clave("magnolia-local"), String(local)); } catch {}
    const t: TurnoLocal = { id: crypto.randomUUID(), local_id: local, terminal: idTerminal(), abierta_en: new Date().toISOString(), fondo_inicial: fondo, apertura, ...(esPrueba() ? { prueba: true } : {}) };
    await encolar({ id: t.id, clase: "turno", datos: t });
    guardarTurno(t);
    setTurno(t);
    setAviso({ ok: true, texto: `Caja abierta con ${pesos(fondo)} de cambio.${apertura?.diferencia ? ` Quedó anotado que ${apertura.diferencia < 0 ? "faltaban" : "sobraban"} ${pesos(Math.abs(apertura.diferencia))}.` : ""}` });
    setBilletesAp({}); setMonedasAp(""); setNotaAp("");
    subir();
    setTimeout(() => entrada.current?.focus(), 50);
  };

  const registrarMovimiento = async (tipo: "retiro" | "gasto" | "ingreso", monto: number, motivo: string, constancia: boolean) => {
    if (!turno || !(monto > 0)) return;
    const id = crypto.randomUUID();
    const creado_en = new Date().toISOString();
    await encolar({ id, clase: "movimiento", datos: { id, turno_id: turno.id, tipo, monto, motivo, creado_en } });
    try { localStorage.setItem("magnolia-constancia", constancia ? "1" : "0"); } catch {}
    if (constancia) imprimir({ id, local_id: turno.local_id, creada_en: creado_en, medio: "efectivo", total: monto, items: [], movimiento: { tipo, motivo, registro: miNombre } }, "constancia");
    setMovForm(false);
    setAviso({ ok: true, texto: `${tipo === "retiro" ? "Retiro" : tipo === "gasto" ? "Gasto" : "Ingreso"} de ${pesos(monto)} anotado.` });
    subir();
  };

  // ---- Gift card: buscarla en el servidor (hace falta internet para ver el saldo)
  const [gcNombres, setGcNombres] = useState<{ codigo: string; destinatario: string; saldo: number; creada_en: string }[] | null>(null);
  // Si lo escrito no es un código, busca por el nombre de quien la recibió
  const buscarGc = async (texto: string) => {
    setGcNombres(null);
    const limpio = texto.toUpperCase().replace(/^GC/, "").replace(/[^0-9A-F]/g, "");
    if (limpio.length === 8 && !/[G-Z]/i.test(texto.replace(/^gc/i, "").replace(/[\s-]/g, ""))) return cargarGc(texto);
    setBuscandoGc(true); setAviso(null);
    try {
      const r = await fetch(`/api/giftcards?nombre=${encodeURIComponent(texto)}${paramPrueba()}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) setAviso({ ok: false, texto: d.error ?? "No se pudo buscar." });
      else if (!d.resultados.length) setAviso({ ok: false, texto: `No hay gift cards con saldo a nombre de "${texto}".` });
      else setGcNombres(d.resultados);
    } catch { setAviso({ ok: false, texto: "Sin internet no se pueden buscar gift cards." }); }
    setBuscandoGc(false);
  };
  const cargarGc = async (codigo: string) => {
    setGcNombres(null);
    setMedio("giftcard"); setModoGc(false); setCodigoGc(codigo.toUpperCase()); setGc(null); setBuscandoGc(true); setAviso(null);
    try {
      const r = await fetch(`/api/giftcards?codigo=${encodeURIComponent(codigo)}${paramPrueba()}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) setAviso({ ok: false, texto: d.error ?? "No se pudo buscar la gift card." });
      else setGc({ id: d.id, codigo: d.codigo, saldo: d.saldo, medio_origen: d.medio_origen });
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se puede ver el saldo de la gift card. Cobrá con otro medio o esperá a que vuelva la conexión." });
    }
    setBuscandoGc(false);
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

  // Producto marcado en la lista (con ↑ ↓); el SKU exacto viene marcado
  const [marcado, setMarcado] = useState(-1);
  const verLista = busqueda.trim().length >= 2 && resultado.resultados.length > 0 && !(resultado.exacto && resultado.resultados.length === 1);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMarcado(resultado.exacto ? 0 : -1);
  }, [resultado]);

  const sumar = (p: ProductoCaja) => {
    setItems((it) => agregar(it, p, cantidadPedida));
    setModoGc(false);
    setBusqueda("");
    setAviso(null);
    entrada.current?.focus();
  };

  // Código leído con la cámara del teléfono/tablet: igual que escanearlo con el lector
  const [camara, setCamara] = useState<null | "productos" | "cambio">(null);
  const leidoConCamara = (cod: string) => {
    const leido = cod.trim().toUpperCase();
    if (/^GC[0-9A-F]{8}$/.test(leido)) { cargarGc(leido.slice(2)); return { ok: true, texto: `Gift card ${leido}` }; }
    if (!catalogo) return { ok: false, texto: "Todavía se están cargando los productos." };
    const p = porCodigo(catalogo.productos, cod) ?? buscar(catalogo.productos, cod).exacto;
    if (!p) return { ok: false, texto: `No encontré el código ${cod}` };
    sumar(p);
    return { ok: true, texto: p[3] };
  };

  const alEnter = () => {
    const leido = busqueda.trim().toUpperCase();
    if (/^GC[0-9A-F]{8}$/.test(leido)) { setBusqueda(""); cargarGc(leido.slice(2)); return; } // escanearon una gift card
    if (verLista && marcado >= 0 && resultado.resultados[marcado]) return sumar(resultado.resultados[marcado]);
    if (resultado.exacto) return sumar(resultado.exacto);
    if (resultado.resultados.length === 1) return sumar(resultado.resultados[0]);
    if (textoBuscado.trim() && resultado.resultados.length === 0) setAviso({ ok: false, texto: `No encontré "${textoBuscado.trim()}". Probá con el nombre o cargalo como "Varios".` });
  };

  // Promos vigentes (vienen con el catálogo) y descuento manual de esta venta
  const ext: Extras = { promos: catalogo?.promos ?? [], descuento: c.descuento ?? null };
  const conGc = medio === "giftcard" && !cambio;
  const cgc = conGc && gc ? cobroConGiftcard(items, gc, medioResto, ext) : null;
  const cambioCC = cambio?.cliente_cc ?? null; // cambio de una venta a cuenta corriente
  const rc = cambio && !cambioCC ? cobroCambio(items, cambio, medioResto, ext) : null;
  const enCuenta = medio === "cuenta" && !cambio && !modoGc;
  const medioPrecio: MedioPago = cambio ? cambio.medio_precio : conGc ? gc?.medio_origen ?? "cuotas" : medio;
  const t = totales(items, medioPrecio, ext);
  const montoNuevaGc = Number(montoGc.replace(/\./g, "").replace(",", ".")) || 0;
  // Pago en dos medios: una parte con el medio elegido y el resto con otro, cada parte a su precio
  const dividir = !modoGc && !cambio && !conGc && !enCuenta && items.length > 0 ? c.dividir ?? null : null;
  // Cuenta corriente: lo que se suma (o se descuenta, en un cambio) y los topes de la clienta
  const netoCC = cambioCC ? redondear(t.total - creditoCambio(cambio!)) : enCuenta ? t.total : 0;
  const ccCliente = enCuenta ? c.cc ?? null : null;
  const ccDespues = ccCliente ? redondear(ccCliente.debe + t.total) : 0;
  const ccSupera = !!ccCliente && ccDespues > ccCliente.limite;
  const ccBloquea = !!ccCliente && ccDespues > 2 * ccCliente.limite;
  const montoDiv = dividir ? Number(dividir.monto.replace(/\./g, "").replace(",", ".")) || 0 : 0;
  const div = dividir ? cobroDividido(items, medio, montoDiv, dividir.resto, ext) : null;
  const setDividir = setter("dividir");
  // lo que se cobra en la caja ahora (con la gift card, solo la diferencia)
  const aCobrar = modoGc ? montoNuevaGc : cambioCC ? Math.abs(netoCC) : rc ? rc.falta : conGc ? cgc?.falta ?? 0 : div ? div.total : t.total;
  // lo que se paga en efectivo (para el vuelto)
  const enEfectivo = div ? (medio === "efectivo" ? div.usa : dividir!.resto === "efectivo" ? div.falta : 0) : aCobrar;
  const medioEfectivo = enCuenta || cambioCC ? false : dividir ? medio === "efectivo" || dividir.resto === "efectivo" : modoGc ? medio === "efectivo" : rc ? rc.falta > 0 && medioResto === "efectivo" : conGc ? (cgc?.falta ?? 0) > 0 && medioResto === "efectivo" : medio === "efectivo";
  const pago = Number(pagaCon.replace(/\./g, "").replace(",", ".")) || 0;
  const vuelto = medioEfectivo && pago > 0 && (!dividir || div) ? redondear(pago - enEfectivo) : null;

  const terminarVenta = (v: VentaParaSubir, impresa: Partial<VentaImpresa>) => {
    setAviso(null);
    setUltima({
      id: v.id, local_id: v.local_id, creada_en: v.creada_en, medio: nombreMedio(v.medio_pago),
      total: v.total, paga_con: v.paga_con, items: v.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precio_unitario: i.precio_unitario, total: i.total })),
      ...impresa,
    });
    cerrarCarrito(c.id);
    enfocar();
    subir();
  };

  const venderGiftcard = async () => {
    if (!local || !(montoNuevaGc > 0)) return;
    if (medio === "efectivo" && pago > 0 && pago < montoNuevaGc) { setAviso({ ok: false, texto: "El pago es menor al valor de la gift card." }); return; }
    const idTarjeta = crypto.randomUUID();
    const v = { ...armarVentaNuevaGiftcard(montoNuevaGc, medio, local, idTerminal(), pago > 0 ? pago : null, c.id, idTarjeta, new Date(), c.paraGc), turno_id: turno?.id ?? null };
    try { await guardarVenta(v); } catch { setAviso({ ok: false, texto: "No se pudo guardar la venta en esta compu. Probá de nuevo." }); return; }
    terminarVenta(v, { giftcard_nueva: { codigo: codigoGiftcard(idTarjeta), monto: v.total, destinatario: v.giftcard_nueva?.destinatario ?? null } });
  };

  // Con gift card la venta se sube en el momento: el saldo se descuenta en el servidor
  const cobrarConGiftcard = async () => {
    if (!local || !gc || !cgc || items.length === 0) return;
    if (medioEfectivo && pago > 0 && pago < cgc.falta) { setAviso({ ok: false, texto: "El pago es menor a lo que falta." }); return; }
    const v = { ...armarVentaGiftcard(items, gc, medioResto, local, idTerminal(), pago > 0 ? pago : null, c.id, new Date(), ext), turno_id: turno?.id ?? null };
    setCobrando(true);
    try {
      const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ventas: [{ ...v, prueba: esPrueba() }] }) });
      if (r.status === 401) { setEstado("sin-sesion"); setAviso({ ok: false, texto: "Iniciá sesión de nuevo para cobrar con gift card." }); return; }
      const d = (await r.json()) as { recibidas: string[]; rechazadas: { motivo: string }[] };
      if (!d.recibidas?.includes(v.id)) { setAviso({ ok: false, texto: `No se pudo cobrar: ${d.rechazadas?.[0]?.motivo ?? "error del servidor"}` }); return; }
      terminarVenta(v, { giftcard: { codigo: gc.codigo, usado: cgc.usa, saldo: cgc.saldoQueda } });
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se puede cobrar con gift card. Probá de nuevo cuando vuelva la conexión." });
    } finally {
      setCobrando(false);
    }
  };

  const buscarVentaCambio = async (codigo: string) => {
    setCb({ codigo, cargando: true, cant: {} });
    try {
      const r = await fetch(`/api/ventas/cambio?codigo=${encodeURIComponent(codigo)}${paramPrueba()}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) { setCb({ codigo, cargando: false, error: d.error ?? "No se pudo buscar la venta.", cant: {} }); return; }
      setCb({ codigo, cargando: false, venta: d, cant: {} });
    } catch {
      setCb({ codigo, cargando: false, error: "Sin internet no se puede buscar la venta.", cant: {} });
    }
  };  // Desde Ventas → "Hacer cambio": la caja abre con esa venta cargada (/caja?cambio=CODIGO)
  const cambioPedido = useRef(false);
  useEffect(() => {
    if (!turno || cambioPedido.current) return;
    const codigo = new URLSearchParams(location.search).get("cambio");
    if (!codigo) return;
    cambioPedido.current = true;
    history.replaceState(null, "", "/caja");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    buscarVentaCambio(codigo);
  }, [turno]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmarDevolucion = () => {
    if (!cb?.venta) return;
    const v = cb.venta;
    const devoluciones = v.items.filter((i) => (cb.cant[i.n] ?? 0) > 0).map((i) => ({
      producto_id: i.producto_id, barcode: i.barcode, sku: i.sku, nombre: i.nombre, cantidad: cb.cant[i.n], precio: i.precio_unitario,
    }));
    if (!devoluciones.length) return;
    if (v.cliente_cc && !soyDuenio) { setAviso({ ok: false, texto: `Esa venta fue a la cuenta corriente de ${v.cliente_cc.nombre}: el cambio lo hacen Martín o Sofi.` }); return; }
    setCambio({ venta_id: v.id, codigo: codigoVenta(v.id), medio_precio: v.medio_precio, devoluciones, cliente_cc: v.cliente_cc ?? null, enPlazo: v.enPlazo });
    setGc(null); setModoGc(false); setMedioResto("efectivo");
    if (medio === "giftcard") setMedio("efectivo");
    setCb(null); setAviso(null); enfocar();
  };

  // Descuento: un dueño lo aplica; un colaborador lo pide y espera la autorización
  const valorDesc = (f: NonNullable<typeof descForm>) => Number(f.valor.replace(/\./g, "").replace(",", ".")) || 0;
  const aplicarDescuento = async () => {
    if (!descForm) return;
    const valor = valorDesc(descForm);
    if (!(valor > 0) || (descForm.tipo === "pct" && valor > 100)) { setAviso({ ok: false, texto: "Revisá el descuento." }); return; }
    const d: DescuentoManual = { tipo: descForm.tipo, valor, motivo: descForm.motivo.trim() || undefined };
    if (soyDuenio) { setDescuento(d); setDescForm(null); enfocar(); return; }
    try {
      const r = await fetch("/api/autorizaciones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_id: local, datos: { ...d, subtotal: t.sinDescuento, productos: items.map((i) => `${i.cantidad} × ${i.nombre}`).slice(0, 20) } }),
      });
      const x = await r.json();
      if (!r.ok) { setAviso({ ok: false, texto: x.error ?? "No se pudo pedir la autorización." }); return; }
      setDescForm({ ...descForm, pedido: x.id, estado: "pendiente" });
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se puede pedir autorización." });
    }
  };
  // Mientras espera la respuesta, consulta cada 3 segundos
  const carritoDelPedido = useRef<string | null>(null);
  useEffect(() => {
    if (!descForm?.pedido || descForm.estado !== "pendiente") return;
    carritoDelPedido.current = c.id;
    const pedido = descForm.pedido;
    const cada = setInterval(async () => {
      try {
        const r = await fetch(`/api/autorizaciones?id=${pedido}`, { cache: "no-store" });
        if (!r.ok) return;
        const x = await r.json();
        if (x.estado === "aprobada") {
          const d: DescuentoManual = { tipo: x.datos.tipo, valor: Number(x.datos.valor), motivo: x.datos.motivo, autorizacion_id: pedido };
          setCarritos((cs) => cs.map((y) => (y.id === carritoDelPedido.current ? { ...y, descuento: d } : y)));
          setDescForm(null);
          setAviso({ ok: true, texto: "✓ Descuento autorizado." });
        } else if (x.estado === "rechazada") {
          setDescForm((f) => (f ? { ...f, estado: "rechazada" } : f));
        }
      } catch {}
    }, 3000);
    return () => clearInterval(cada);
  }, [descForm?.pedido, descForm?.estado, c.id]);

  // Cambio: se sube en el momento (el servidor controla que no se devuelva dos veces)
  const cobrarCambio = async () => {
    if (!local || !cambio || !rc) return;
    if (medioEfectivo && pago > 0 && pago < rc.falta) { setAviso({ ok: false, texto: "El pago es menor a la diferencia." }); return; }
    const idGc = crypto.randomUUID();
    const v = { ...armarVentaCambio(items, cambio, medioResto, local, idTerminal(), pago > 0 ? pago : null, c.id, idGc, new Date(), ext), turno_id: turno?.id ?? null };
    setCobrando(true);
    try {
      const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ventas: [{ ...v, prueba: esPrueba() }] }) });
      if (r.status === 401) { setEstado("sin-sesion"); setAviso({ ok: false, texto: "Iniciá sesión de nuevo para hacer el cambio." }); return; }
      const d = (await r.json()) as { recibidas: string[]; rechazadas: { motivo: string }[] };
      if (!d.recibidas?.includes(v.id)) { setAviso({ ok: false, texto: `No se pudo registrar el cambio: ${d.rechazadas?.[0]?.motivo ?? "error del servidor"}` }); return; }
      terminarVenta(v, {
        cambio: { codigo: cambio.codigo, credito: rc.credito },
        giftcard_nueva: v.giftcard_nueva ? { codigo: codigoGiftcard(idGc), monto: v.giftcard_nueva.monto } : null,
      });
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se pueden hacer cambios. Probá de nuevo cuando vuelva la conexión." });
    } finally {
      setCobrando(false);
    }
  };

  // ---- Cuentas corrientes (solo Martín y Sofi). Hace falta internet: el saldo se controla en el servidor.
  const cargarClientesCC = async () => {
    try {
      const r = await fetch("/api/cc/clientes", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudieron traer las cuentas corrientes." }); return null; }
      setClientesCC(d.clientes);
      return d.clientes as ClienteCaja[];
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se pueden ver las cuentas corrientes." });
      return null;
    }
  };
  /** Sube una venta a cuenta corriente y devuelve el saldo nuevo de la clienta (o null si no se pudo). */
  const subirVentaCuenta = async (v: VentaParaSubir): Promise<{ ok: true; saldo: number | null } | { ok: false }> => {
    setCobrando(true);
    try {
      const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ventas: [{ ...v, prueba: esPrueba() }] }) });
      if (r.status === 401) { setEstado("sin-sesion"); setAviso({ ok: false, texto: "Iniciá sesión de nuevo." }); return { ok: false }; }
      const d = (await r.json()) as { recibidas: string[]; rechazadas: { motivo: string }[] };
      if (!d.recibidas?.includes(v.id)) { setAviso({ ok: false, texto: `No se pudo anotar en la cuenta: ${d.rechazadas?.[0]?.motivo ?? "error del servidor"}` }); return { ok: false }; }
      const lista = await cargarClientesCC();
      return { ok: true, saldo: lista?.find((x) => x.id === v.cliente_cc_id)?.debe ?? null };
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se puede vender a cuenta corriente. Probá de nuevo cuando vuelva la conexión." });
      return { ok: false };
    } finally {
      setCobrando(false);
    }
  };
  const cobrarCuenta = async () => {
    if (!local || !ccCliente || items.length === 0 || ccBloquea) return;
    const v = { ...armarVenta(items, "cuenta", local, idTerminal(), null, c.id, new Date(), ext), cliente_cc_id: ccCliente.id, turno_id: turno?.id ?? null };
    const r = await subirVentaCuenta(v);
    if (r.ok) terminarVenta(v, { cuenta: { nombre: ccCliente.nombre, saldo: r.saldo } });
  };
  const cobrarCambioCuenta = async () => {
    if (!local || !cambio || !cambioCC) return;
    if (netoCC < 0 && cambio.enPlazo === false) { setAviso({ ok: false, texto: "Pasaron más de 15 días: lo devuelto ya no se descuenta de la cuenta. Solo puede cambiarlo por algo de igual o mayor valor." }); return; }
    const v = { ...armarVentaCambioCuenta(items, cambio, cambioCC.id, local, idTerminal(), c.id, new Date(), ext), turno_id: turno?.id ?? null };
    const r = await subirVentaCuenta(v);
    if (r.ok) terminarVenta(v, { cambio: { codigo: cambio.codigo, credito: creditoCambio(cambio) }, cuenta: { nombre: cambioCC.nombre, saldo: r.saldo } });
  };
  const registrarPagoCC = async () => {
    if (!pagoCC?.cliente || !turno) return;
    const monto = Number(pagoCC.monto.replace(/\./g, "").replace(",", ".")) || 0;
    if (!(monto > 0)) { setAviso({ ok: false, texto: "Poné cuánto paga." }); return; }
    setPagoCC({ ...pagoCC, enviando: true });
    try {
      await subir(); // que el servidor ya tenga esta caja, así el efectivo entra en el arqueo
      const r = await fetch("/api/cc/pagos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: pagoCC.cliente.id, monto, medio: pagoCC.medio, turno_id: turno.id }) });
      const d = await r.json();
      if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudo registrar el pago." }); setPagoCC({ ...pagoCC, enviando: false }); return; }
      if (pagoCC.constancia) imprimir({ id: d.id, local_id: turno.local_id, creada_en: new Date().toISOString(), medio: nombreMedio(pagoCC.medio as MedioPago), total: monto, items: [],
        pagoCC: { nombre: d.cliente, medio: nombreMedio(pagoCC.medio as MedioPago), saldo: d.saldo, registro: miNombre } }, "constancia");
      const noEntro = pagoCC.medio === "efectivo" && !d.entroACaja;
      setAviso({ ok: !noEntro, texto: `Pago de ${d.cliente} por ${pesos(monto)} anotado. ${d.saldo > 0 ? `Le queda debiendo ${pesos(d.saldo)}.` : d.saldo < 0 ? `Le queda ${pesos(-d.saldo)} a favor.` : "La cuenta quedó en cero."}${noEntro ? " ⚠ El efectivo no se sumó a esta caja: anotalo como ingreso." : ""}` });
      setPagoCC(null);
      cargarClientesCC();
    } catch {
      setAviso({ ok: false, texto: "Sin internet no se pueden cobrar cuentas corrientes." });
      setPagoCC({ ...pagoCC, enviando: false });
    }
  };

  // Un solo cobro a la vez: un doble clic o un Enter repetido no puede registrar la venta dos veces
  const cobrandoRef = useRef(false);
  const cobrar = async () => {
    if (cobrandoRef.current) return;
    cobrandoRef.current = true;
    try { await cobrarUnaVez(); } finally { cobrandoRef.current = false; }
  };
  const cobrarUnaVez = async () => {
    if (modoGc) return venderGiftcard();
    if (cambio) return cambioCC ? cobrarCambioCuenta() : cobrarCambio();
    if (conGc) return cobrarConGiftcard();
    if (enCuenta) return cobrarCuenta();
    if (!local || items.length === 0) return;
    if (dividir) {
      if (!div) { setAviso({ ok: false, texto: `Poné cuánto paga en ${nombreMedio(medio).toLowerCase()} (menos que el total) y con qué paga el resto.` }); return; }
      if (pago > 0 && pago < enEfectivo) { setAviso({ ok: false, texto: "Lo que entrega en efectivo es menos que la parte en efectivo." }); return; }
      const vd = armarVentaDividida(items, medio, montoDiv, dividir.resto, local, idTerminal(), pago > 0 ? pago : null, c.id, new Date(), ext);
      if (!vd) return;
      const v = { ...vd, turno_id: turno?.id ?? null };
      try { await guardarVenta(v); } catch { setAviso({ ok: false, texto: "No se pudo guardar la venta en esta compu. Probá de nuevo." }); return; }
      terminarVenta(v, { medio: v.pagos!.map((p) => nombreMedio(p.medio)).join(" + "), pagos: v.pagos!.map((p) => ({ medio: nombreMedio(p.medio), monto: p.monto, efectivo: p.medio === "efectivo" })) });
      return;
    }
    if (medio === "efectivo" && pago > 0 && pago < t.total) { setAviso({ ok: false, texto: "El pago es menor al total." }); return; }
    const v = { ...armarVenta(items, medio, local, idTerminal(), pago > 0 ? pago : null, c.id, new Date(), ext), turno_id: turno?.id ?? null };
    try {
      await guardarVenta(v);
    } catch {
      setAviso({ ok: false, texto: "No se pudo guardar la venta en esta compu. Probá de nuevo." });
      return;
    }
    terminarVenta(v, {});
  };

  const nombreLocal = catalogo?.locales.find((l) => l.id === local)?.nombre ?? (local === 2 ? "Magnolia Beauty" : local === 1 ? "Magnolia Home" : "");

  // ---- Abrir caja (o sumarse a la que ya está abierta en ese local)
  if (!turno || !local) {
    const locales = catalogo?.locales?.length ? catalogo.locales : [{ id: 1, nombre: "Magnolia Home" }, { id: 2, nombre: "Magnolia Beauty" }];
    const elegido = localApertura;
    const info = elegido ? cajasAbiertas[elegido] : undefined;
    const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const contadoAp = totalBilletes(Object.fromEntries(Object.entries(billetesAp).map(([k, v]) => [k, Number(v) || 0])), Number(monedasAp.replace(",", ".")) || 0);
    const hayConteoAp = Object.values(billetesAp).some((v) => v !== "") || monedasAp !== "";
    const esperadoAp = info?.ultimoDeja ?? null;
    const difAp = esperadoAp !== null ? Math.round((contadoAp - esperadoAp) * 100) / 100 : null;
    return (
      <main className="mx-auto mt-12 max-w-lg px-6 pb-10">
        <h1 className="text-2xl font-semibold">{enPrueba ? "Abrir caja de prueba" : "Abrir caja"}</h1>
        {enPrueba && <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900">Lo que hagas acá no descuenta stock ni aparece en ventas, reportes ni cierres. Elegí el local para usar sus precios y productos. Al terminar, cerrala y borrá los datos desde Configuración → Caja de prueba.</p>}
        {aviso && !aviso.ok && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{aviso.texto}</p>}
        {buscandoTurno ? <p className="mt-4 text-suave">Un momento…</p> : (
          <>
            <p className="mt-4 mb-2 text-sm font-semibold">¿De qué local?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {locales.map((l) => {
                const c = cajasAbiertas[l.id];
                const activo = elegido === l.id;
                return (
                  <button key={l.id} onClick={() => setLocalApertura(l.id)}
                    className={`rounded-2xl border-2 p-4 text-left transition ${activo ? "border-marca bg-marca-claro" : "border-linea bg-white hover:border-marca/50"}`}>
                    <span className="block text-lg font-semibold">{l.nombre}</span>
                    <span className={`text-sm ${c?.abierto ? "text-green-800" : "text-suave"}`}>
                      {c === undefined ? "Buscando…" : c === null ? "Sin conexión" : c.abierto ? `● Caja abierta desde las ${hora(c.abierto.abierta_en)}` : "Caja cerrada"}
                    </span>
                  </button>
                );
              })}
            </div>

            {elegido && info?.abierto ? (
              <div className="tarjeta mt-5 space-y-3">
                <p className="text-sm">Ya hay una caja abierta en <b>{locales.find((l) => l.id === elegido)?.nombre}</b> desde las {hora(info.abierto.abierta_en)}. Esta compu se suma a esa caja: las ventas de todas las compus van al mismo cierre y arqueo.</p>
                <button className="boton w-full justify-center !py-3 text-base" onClick={() => sumarseACaja(info.abierto!)}>Sumarme a la caja abierta</button>
              </div>
            ) : elegido ? (
              <form className="tarjeta mt-5 space-y-4" onSubmit={(e) => {
                e.preventDefault();
                abrirCaja(elegido, contadoAp, {
                  billetes: Object.fromEntries(Object.entries(billetesAp).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => Number(v) > 0)),
                  monedas: Number(monedasAp.replace(",", ".")) || 0, esperado: esperadoAp, diferencia: difAp, nota: notaAp.trim() || null,
                });
              }}>
                <div>
                  <p className="etiqueta">Contá el efectivo de cambio con el que arranca la caja (cantidad de billetes)</p>
                  <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {DENOMINACIONES.map((d) => (
                      <label key={d}><span className="text-xs text-suave">${d.toLocaleString("es-AR")}</span>
                        <input className="campo !py-1.5" inputMode="numeric" value={billetesAp[d] ?? ""} placeholder="0" autoFocus={d === DENOMINACIONES[0]}
                          onChange={(e) => setBilletesAp((b) => ({ ...b, [d]: e.target.value.replace(/\D/g, "") }))} />
                      </label>
                    ))}
                    <label><span className="text-xs text-suave">Monedas ($)</span>
                      <input className="campo !py-1.5" inputMode="decimal" value={monedasAp} placeholder="0" onChange={(e) => setMonedasAp(e.target.value)} /></label>
                  </div>
                </div>
                <div className="space-y-1 rounded-xl bg-fondo p-3">
                  <p className="flex justify-between text-lg"><span>Hay en la caja</span><b className="tabular-nums">{pesos(contadoAp)}</b></p>
                  {esperadoAp !== null ? (
                    <>
                      <p className="flex justify-between text-sm text-suave"><span>Se dejó en el último cierre</span><span className="tabular-nums">{pesos(esperadoAp)}</span></p>
                      {hayConteoAp && (
                        <p className={`flex justify-between font-semibold ${difAp === 0 ? "text-green-800" : "text-red-700"}`}>
                          <span>{difAp === 0 ? "✓ Coincide" : difAp! < 0 ? "⚠ Falta" : "⚠ Sobra"}</span><span className="tabular-nums">{difAp ? pesos(Math.abs(difAp)) : ""}</span>
                        </p>
                      )}
                    </>
                  ) : <p className="text-xs text-suave">{info === null ? "Sin internet no se puede comparar con el último cierre." : "No hay un cierre anterior para comparar."}</p>}
                </div>
                {hayConteoAp && difAp !== null && difAp !== 0 && (
                  <label className="block rounded-xl border border-red-200 bg-red-50 p-3">
                    <span className="text-sm font-semibold text-red-800">No coincide con lo que se dejó en el último cierre. Volvé a contar; si está bien, anotá qué pasó:</span>
                    <input className="campo mt-2" value={notaAp} onChange={(e) => setNotaAp(e.target.value)} placeholder="Ej: Sofi se llevó $10.000 para cambio" />
                    <span className="ayuda block">Les llega en el resumen del cierre.</span>
                  </label>
                )}
                <button className="boton w-full justify-center !py-3 text-base" disabled={!hayConteoAp}>
                  {!hayConteoAp ? "Contá los billetes para abrir" : difAp ? `Abrir con diferencia de ${pesos(Math.abs(difAp))}` : `Abrir caja en ${locales.find((l) => l.id === elegido)?.nombre}`}
                </button>
                {hayConteoAp === false && <button type="button" className="w-full text-center text-xs text-suave underline" onClick={() => setMonedasAp("0")}>La caja arranca vacía ($0)</button>}
                {info === null && <p className="text-sm text-amber-800">Sin internet no se puede ver si otra compu ya abrió la caja de este local. Si es así, mejor esperá a tener conexión y sumate a esa.</p>}
              </form>
            ) : null}
          </>
        )}
        <p className="mt-6 text-center text-sm"><Link href="/ventas" className="text-suave underline">Ir al menú</Link></p>
      </main>
    );
  }

  const sugerenciasEfectivo = (() => {
    if (!(enEfectivo > 0)) return [];
    const arriba = (m: number) => Math.ceil(enEfectivo / m) * m;
    return [...new Set([enEfectivo, arriba(1000), arriba(5000), arriba(10000), arriba(20000)])].filter((x) => x >= enEfectivo).slice(0, 4);
  })();
  const hayCarrito = items.length > 0 || modoGc || !!cambio;
  const listoParaCobrar = !cobrando && (modoGc ? montoNuevaGc > 0
    : cambio ? cambio.devoluciones.length > 0 && (!cambioCC || (soyDuenio && (netoCC >= 0 || cambio.enPlazo !== false)))
    : enCuenta ? items.length > 0 && !!ccCliente && !ccBloquea
    : items.length > 0 && (!conGc || !!gc) && (!dividir || !!div));
  const unidades = (x: Carrito) => x.items.reduce((s2, y) => s2 + y.cantidad, 0);
  const totalDe = (x: Carrito) => x.modoGc ? (Number(x.montoGc.replace(/\./g, "").replace(",", ".")) || 0)
    : totales(x.items, x.medio === "giftcard" ? x.gc?.medio_origen ?? "cuotas" : x.medio).total;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-fondo">
      {zona}
      {/* ---------- Barra superior ---------- */}
      <header className="flex items-center gap-2 border-b border-linea bg-white px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:px-5">
        <Link href="/ventas" aria-label="Menú" className="flex h-10 w-10 items-center justify-center rounded-lg text-suave hover:bg-marca-claro">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </Link>
        <div className="mr-auto leading-tight">
          <p className="font-semibold text-marca">{enPrueba && <span className="mr-2 rounded bg-orange-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Caja de prueba</span>}{nombreLocal}</p>
          <p className="hidden text-xs text-suave sm:block">Caja abierta desde las {new Date(turno.abierta_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            {" · "}{catalogo ? `${catalogo.productos.length.toLocaleString("es-AR")} productos${catalogo.guardado ? ` (act. ${new Date(catalogo.guardado).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })})` : ""}` : "sin catálogo"}</p>
        </div>
        <span className="hidden items-center gap-2 text-xs sm:flex">
          {estado === "sin-conexion" && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900">● Sin internet</span>}
          {estado === "sin-sesion" && <a href="/ingresar" className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800 underline">Iniciá sesión para subir ventas</a>}
          {pendientes > 0
            ? <span className="rounded-full bg-marca-claro px-2.5 py-1 font-semibold text-marca">{pendientes} sin subir</span>
            : estado === "conectado" && <span className="rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-800">✓ Al día</span>}
        </span>
        {soyDuenio && <button className="boton-borde !border-linea !px-3 !text-tinta" onClick={() => { setPagoCC((x) => (x ? null : { cliente: null, monto: "", medio: "efectivo", constancia: true })); setBuscaCC(""); if (!clientesCC) cargarClientesCC(); }}>
          <span className="sm:hidden">Cuentas</span><span className="hidden sm:inline">Cobrar cuenta</span></button>}
        <button className="boton-borde !border-linea !px-3 !text-tinta" onClick={() => setMovForm((x) => !x)}><span className="sm:hidden">Retiro</span><span className="hidden sm:inline">Retiro / gasto</span></button>
        <Link href={`/caja/cierre?turno=${turno.id}`} className="boton-borde !px-3"><span className="sm:hidden">Cerrar</span><span className="hidden sm:inline">Cerrar caja</span></Link>
      </header>
      {(estado !== "conectado" || pendientes > 0) && (
        <p className="border-b border-linea bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 sm:hidden">
          {estado === "sin-conexion" ? "Sin internet · " : estado === "sin-sesion" ? "Iniciá sesión · " : ""}{pendientes > 0 ? `${pendientes} sin subir` : ""}
        </p>
      )}

      <PedidosWeb pedidos={pedidosWeb} local={turno.local_id} onCambio={() => latirRef.current()} />

      {movForm && (
        <form className="flex flex-wrap items-end gap-3 border-b border-linea bg-marca-claro px-4 py-3" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          registrarMovimiento(f.get("tipo") as "retiro" | "gasto" | "ingreso", Number(String(f.get("monto")).replace(/\./g, "").replace(",", ".")), String(f.get("motivo") ?? ""), f.get("constancia") === "on");
        }}>
          <label><span className="etiqueta">Tipo</span>
            <select name="tipo" className="campo"><option value="retiro">Retiro de efectivo</option><option value="gasto">Gasto (pago con la caja)</option><option value="ingreso">Ingreso de efectivo</option></select>
          </label>
          <label className="w-36"><span className="etiqueta">Monto</span><input name="monto" className="campo" inputMode="decimal" required autoFocus /></label>
          <label className="min-w-40 flex-1"><span className="etiqueta">Motivo</span><input name="motivo" className="campo" placeholder="Ej: pago flete, retiro Martín" /></label>
          <label className="flex items-center gap-1.5 self-center text-sm"><input type="checkbox" name="constancia" defaultChecked={(() => { try { return localStorage.getItem("magnolia-constancia") !== "0"; } catch { return true; } })()} /> Imprimir constancia para firmar</label>
          <button className="boton">Anotar</button>
          <button type="button" className="text-sm text-suave underline" onClick={() => setMovForm(false)}>Cancelar</button>
        </form>
      )}

      {pagoCC && (
        <div className="space-y-2 border-b border-linea bg-marca-claro px-4 py-3">
          <p className="text-sm font-semibold">📒 Cobrar una cuenta corriente</p>
          {!pagoCC.cliente ? (
            <ElegirClienta clientes={clientesCC} busca={buscaCC} setBusca={setBuscaCC} onElegir={(cl) => setPagoCC({ ...pagoCC, cliente: cl, monto: cl.debe > 0 ? String(cl.debe) : "" })} />
          ) : (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); registrarPagoCC(); }}>
              <p className="basis-full text-sm"><b>{pagoCC.cliente.nombre}</b> · debe <b>{pesos(pagoCC.cliente.debe)}</b>{" "}
                <button type="button" className="text-xs text-suave underline" onClick={() => setPagoCC({ ...pagoCC, cliente: null })}>cambiar</button></p>
              <label className="w-36"><span className="etiqueta">Paga</span>
                <input className="campo" inputMode="decimal" required autoFocus value={pagoCC.monto} onChange={(e) => setPagoCC({ ...pagoCC, monto: e.target.value })} /></label>
              <label><span className="etiqueta">Con</span>
                <select className="campo" value={pagoCC.medio} onChange={(e) => setPagoCC({ ...pagoCC, medio: e.target.value })}>
                  {(["efectivo", "transferencia", "debito", "credito", "cuotas", "qr"] as const).map((m) => <option key={m} value={m}>{nombreMedio(m)}</option>)}
                </select></label>
              <label className="flex items-center gap-1.5 self-center text-sm"><input type="checkbox" checked={pagoCC.constancia} onChange={(e) => setPagoCC({ ...pagoCC, constancia: e.target.checked })} /> Imprimir constancia</label>
              <button className="boton" disabled={pagoCC.enviando}>{pagoCC.enviando ? "Anotando…" : "Anotar pago"}</button>
              <button type="button" className="text-sm text-suave underline" onClick={() => setPagoCC(null)}>Cancelar</button>
              {pagoCC.medio === "efectivo" && <p className="basis-full text-xs text-suave">El efectivo entra en esta caja y aparece en el cierre como ingreso.</p>}
            </form>
          )}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3 md:p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
        {/* ---------- Izquierda: ventas abiertas, buscador y carrito ---------- */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3 lg:min-h-0 lg:shrink">
          <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
            {carritos.map((x, i) => {
              const activa = x.id === c.id;
              const titulo = x.nombre?.trim() || `Venta ${i + 1}`;
              if (renombrando === x.id) {
                return (
                  <form key={x.id} className="flex shrink-0 items-center gap-1 rounded-xl border-2 border-marca bg-white px-2 py-1"
                    onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get("n") ?? "").trim().slice(0, 24); setCarritos((cs) => cs.map((y) => (y.id === x.id ? { ...y, nombre: n } : y))); setRenombrando(null); enfocar(); }}>
                    <input name="n" defaultValue={x.nombre ?? ""} placeholder="Nombre del cliente" autoFocus className="w-36 bg-transparent px-1 py-1 text-sm outline-none"
                      onKeyDown={(e) => { if (e.key === "Escape") { setRenombrando(null); enfocar(); } }} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
                    <button className="rounded-lg bg-marca px-2 py-1 text-xs font-semibold text-white">OK</button>
                  </form>
                );
              }
              return (
                <div key={x.id} className={`flex shrink-0 items-stretch overflow-hidden rounded-xl border transition ${activa ? "border-marca bg-marca text-white shadow-sm" : "border-linea bg-white hover:border-marca/50"}`}>
                  <button onClick={() => irA(x.id)} onDoubleClick={() => setRenombrando(x.id)} className="py-2 pl-3 pr-2 text-left">
                    <span className="block max-w-40 truncate text-sm font-semibold">{titulo}</span>
                    <span className={`block text-xs ${activa ? "text-white/75" : "text-suave"}`}>
                      {x.modoGc ? "🎁 Gift card" : vacio(x) ? "Vacía" : `${unidades(x)} u. · ${pesos(totalDe(x))}`}
                    </span>
                  </button>
                  <button aria-label="Ponerle nombre" title="Ponerle nombre (por ejemplo, el del cliente)" onClick={() => setRenombrando(x.id)}
                    className={`px-2 ${activa ? "text-white/70 hover:text-white" : "text-suave hover:text-marca"}`}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                </div>
              );
            })}
            <button className="shrink-0 rounded-xl border border-dashed border-marca/60 px-4 text-sm font-semibold text-marca hover:bg-marca-claro" onClick={nuevaVenta}>+ Otra venta</button>
          </div>

          <div className="flex shrink-0 gap-2">
          <div className="relative min-w-0 flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-suave" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              ref={entrada}
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); alEnter(); }
                if (e.key === "Escape") setBusqueda("");
                if (verLista && e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => Math.min(m + 1, resultado.resultados.length - 1)); }
                if (verLista && e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
              }}
              placeholder={cargandoCat && !catalogo ? "Cargando productos…" : "Escaneá o buscá un producto"}
              className="w-full rounded-2xl border-2 border-linea bg-white py-3.5 pr-4 pl-12 text-lg shadow-sm outline-none transition focus:border-marca"
              autoComplete="off"
              inputMode="search"
            />
            {verLista && (
              <ul className="absolute inset-x-0 top-full z-20 mt-2 max-h-[60vh] overflow-auto rounded-2xl border border-linea bg-white py-1 shadow-xl">
                {resultado.resultados.map((p, i) => (
                  <li key={p[0]}>
                    <button ref={i === marcado ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined} onClick={() => sumar(p)} onMouseEnter={() => setMarcado(i)} className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${i === marcado ? "bg-marca-claro" : ""}`}>
                      <span className="min-w-0"><span className="block truncate font-medium">{p[3]}</span><span className="text-xs text-suave">{p[2]}</span></span>
                      <span className="text-right text-sm whitespace-nowrap"><b>{pesos(p[5])}</b><span className="block text-xs text-suave">lista {pesos(p[4])}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <BotonCamara onClick={() => setCamara("productos")} />
          </div>
          {camara === "productos" && <EscanerCamara titulo="Escanear productos" onCodigo={leidoConCamara} onCerrar={() => setCamara(null)} />}
          {camara === "cambio" && <EscanerCamara titulo="Escanear el ticket de la venta" continuo={false} onCodigo={(k) => { buscarVentaCambio(k); return { ok: true, texto: k }; }} onCerrar={() => setCamara(null)} />}
          {!catalogo && !cargandoCat && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              No hay productos guardados en esta compu. Conectate a internet una vez para bajar el catálogo
              {estado === "sin-sesion" ? " (e iniciá sesión)" : ""}.
            </p>
          )}

          <div className="flex min-h-56 flex-col overflow-hidden rounded-2xl border border-linea bg-white lg:min-h-0 lg:flex-1">
            {cb ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-linea px-4 py-3">
                  <p className="font-semibold">↺ Cambio o devolución</p>
                  <button className="text-sm text-suave underline" onClick={() => { setCb(null); enfocar(); }}>Cancelar</button>
                </div>
                <form className="flex gap-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); const k = String(new FormData(e.currentTarget).get("codigo") ?? "").trim(); if (k) buscarVentaCambio(k); }}>
                  <input name="codigo" defaultValue={cb.codigo} autoFocus autoComplete="off" className="campo uppercase" placeholder="Escaneá el ticket o escribí el código de la venta" />
                  <BotonCamara onClick={() => setCamara("cambio")} />
                  <button className="boton" disabled={cb.cargando}>{cb.cargando ? "…" : "Buscar"}</button>
                </form>
                {cb.error && <p className="mx-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{cb.error}</p>}
                {cb.venta && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <p className={`mx-4 rounded-lg px-3 py-2 text-sm ${cb.venta.enPlazo ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
                      Venta {codigoVenta(cb.venta.id)} del {new Date(cb.venta.creada_en).toLocaleDateString("es-AR")} · pagada con {nombreMedio(cb.venta.medio_pago).toLowerCase()} ·{" "}
                      {cb.venta.enPlazo ? `dentro del plazo (vence ${new Date(cb.venta.vence).toLocaleDateString("es-AR")})` : `⚠ plazo de cambio vencido el ${new Date(cb.venta.vence).toLocaleDateString("es-AR")}`}
                    </p>
                    <p className="px-4 pt-3 text-xs font-semibold tracking-wide text-suave uppercase">¿Qué devuelve?</p>
                    <ul className="flex-1 divide-y divide-linea overflow-auto">
                      {cb.venta.items.map((i) => {
                        const n = cb.cant[i.n] ?? 0;
                        const poner = (x: number) => setCb((y) => (y ? { ...y, cant: { ...y.cant, [i.n]: Math.max(0, Math.min(x, i.puede)) } } : y));
                        return (
                          <li key={i.n} className={`flex items-center gap-3 px-4 py-2.5 ${i.puede === 0 ? "opacity-50" : ""}`}>
                            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.nombre}</span>
                              <span className="text-xs text-suave">{i.sku ?? "Varios"} · {pesos(i.precio_unitario)} c/u · compró {i.cantidad}{i.devuelto ? ` · ya devolvió ${i.devuelto}` : ""}</span></span>
                            <span className="flex items-center gap-1">
                              <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-linea" onClick={() => poner(n - 1)} disabled={i.puede === 0}>−</button>
                              <span className="w-7 text-center font-semibold tabular-nums">{n}</span>
                              <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-linea" onClick={() => poner(n + 1)} disabled={i.puede === 0}>+</button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex items-center justify-between gap-3 border-t border-linea px-4 py-3">
                      <span className="text-sm">Crédito: <b>{pesos(cb.venta.items.reduce((s2, i) => s2 + (cb.cant[i.n] ?? 0) * i.precio_unitario, 0))}</b></span>
                      <button className="boton" onClick={confirmarDevolucion} disabled={!Object.values(cb.cant).some((x) => x > 0)}>Confirmar devolución</button>
                    </div>
                  </div>
                )}
              </div>
            ) : modoGc ? (
              <div className="m-auto max-w-sm p-8 text-center">
                <p className="text-5xl">🎁</p>
                <p className="mt-3 text-lg font-semibold">Venta de gift card</p>
                <p className="mt-1 text-sm text-suave">Poné el valor a la derecha, elegí cómo paga y cobrá. Después imprimís la tarjeta con su código.</p>
                <button className="mt-4 text-sm text-suave underline" onClick={() => { setModoGc(false); setMontoGc(""); enfocar(); }}>Volver a vender productos</button>
              </div>
            ) : items.length === 0 && !cambio ? (
              <div className="m-auto max-w-sm p-8 text-center text-suave">
                <svg viewBox="0 0 24 24" className="mx-auto h-12 w-12 text-linea" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" /></svg>
                <p className="mt-3 font-medium text-tinta">Escaneá un producto para empezar</p>
                <p className="mt-1 text-sm">También podés buscar por nombre o SKU. Para varias unidades: <b>3*código</b>.</p>
              </div>
            ) : (
              <>
                {cambio && (
                  <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                    <span>↺ Cambio de la venta <b>{cambio.codigo}</b> · {cambio.cliente_cc ? <>cuenta corriente de <b>{cambio.cliente_cc.nombre}</b> · lo nuevo va a precio de lista</> : <>lo nuevo va a precio {nombreMedio(cambio.medio_precio).toLowerCase()}</>}</span>
                    <button className="ml-auto underline" onClick={() => setCambio(null)}>Quitar cambio</button>
                  </div>
                )}
                <div className="hidden grid-cols-[minmax(0,1fr)_120px_110px_36px] gap-3 border-b border-linea px-4 py-2 text-xs font-semibold tracking-wide text-suave uppercase sm:grid">
                  <span>Producto</span><span className="text-center">Cantidad</span><span className="text-right">Subtotal</span><span />
                </div>
                <ul className="flex-1 divide-y divide-linea overflow-auto">
                  {cambio?.devoluciones.map((d, i) => (
                    <li key={`dev-${i}`} className="flex items-center gap-3 bg-red-50/40 px-4 py-2.5 text-red-900">
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">↺ Devuelve: {d.nombre}</span>
                        <span className="text-xs">{d.cantidad} × {pesos(d.precio)}</span></span>
                      <span className="font-semibold tabular-nums">−{pesos(d.precio * d.cantidad)}</span>
                    </li>
                  ))}
                  {cambio && items.length === 0 && <li className="px-4 py-4 text-sm text-suave">{cambio.cliente_cc ? "Escaneá lo que se lleva en cambio. Si no se lleva nada, lo devuelto se descuenta de su cuenta." : "Escaneá lo que se lleva en cambio. Si no se lleva nada, cobrá así y el saldo a favor queda en una gift card."}</li>}
                  {items.map((it, i) => (
                    <li key={`${it.producto_id ?? "v"}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_120px_110px_36px]">
                      <span className="min-w-0 basis-full sm:basis-auto">
                        <span className="block font-medium sm:truncate">{it.nombre}</span>
                        <span className="text-xs text-suave">{it.sku ?? "Varios"} · {pesos(precioUnitario(it, medioPrecio))} c/u</span>
                      </span>
                      <span className="flex items-center gap-1 sm:justify-center">
                        <button aria-label="Uno menos" className="flex h-9 w-9 items-center justify-center rounded-lg border border-linea text-lg hover:border-marca"
                          onClick={() => setItems((x) => x.flatMap((y, j) => (j !== i ? [y] : y.cantidad > 1 ? [{ ...y, cantidad: y.cantidad - 1 }] : [])))}>−</button>
                        <span className="w-9 text-center text-lg font-semibold tabular-nums">{it.cantidad}</span>
                        <button aria-label="Uno más" className="flex h-9 w-9 items-center justify-center rounded-lg border border-linea text-lg hover:border-marca"
                          onClick={() => setItems((x) => x.map((y, j) => (j === i ? { ...y, cantidad: y.cantidad + 1 } : y)))}>+</button>
                      </span>
                      <span className="ml-auto text-right font-semibold tabular-nums sm:ml-0">{pesos(precioUnitario(it, medioPrecio) * it.cantidad)}</span>
                      <button aria-label="Quitar" className="rounded-lg px-2 py-1 text-xl text-suave hover:bg-red-50 hover:text-red-700"
                        onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>×</button>
                    </li>
                  ))}
                  {t.lineas.map((l) => (
                    <li key={l.nombre} className="flex items-center gap-3 px-4 py-2.5 text-green-800">
                      <span className="min-w-0 flex-1 truncate font-medium">{l.manual ? "✂ " : "★ "}{l.nombre}</span>
                      <span className="font-semibold tabular-nums">−{pesos(l.monto)}</span>
                      {l.manual ? <button aria-label="Quitar descuento" className="rounded-lg px-2 py-1 text-xl text-suave hover:bg-red-50 hover:text-red-700" onClick={() => setDescuento(null)}>×</button> : <span className="w-9" />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button className="boton-borde !border-linea !text-tinta" onClick={() => setVarios((v) => !v)}>+ Varios (sin código)</button>
            {!modoGc && !cambio && <button className="boton-borde !border-linea !text-tinta" onClick={() => { setModoGc(true); setItems([]); setGc(null); if (medio === "giftcard") setMedio("efectivo"); setAviso(null); }}>🎁 Vender gift card</button>}
            {!modoGc && !cambio && !conGc && <button className="boton-borde !border-linea !text-tinta" onClick={() => { setCb({ codigo: "", cargando: false, cant: {} }); setAviso(null); }}>↺ Cambio</button>}
            {!modoGc && items.length > 0 && !c.descuento && <button className="boton-borde !border-linea !text-tinta" onClick={() => setDescForm({ tipo: "pct", valor: "", motivo: "" })}>✂ Descuento</button>}
            {!vacio(c) && (confirmarAnular ? (
              <span className="ml-auto flex items-center gap-2 rounded-xl bg-red-50 px-3 py-1.5 text-sm text-red-800">
                ¿Anular esta venta?
                <button className="rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-white" onClick={anularEnCurso}>Sí, anular</button>
                <button className="px-1 underline" onClick={() => setConfirmarAnular(false)}>No</button>
              </span>
            ) : (
              <button className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={() => setConfirmarAnular(true)}>✕ Anular venta</button>
            ))}
          </div>
          {descForm && (
            <div className="tarjeta flex flex-wrap items-end gap-3 !p-4">
              {descForm.pedido ? (
                <p className="flex-1 text-sm">
                  {descForm.estado === "rechazada"
                    ? <span className="text-red-700">✗ Martín o Sofi rechazaron el descuento.</span>
                    : <>⏳ Esperando que Martín o Sofi autoricen el descuento de <b>{descForm.tipo === "pct" ? `${descForm.valor}%` : pesos(valorDesc(descForm))}</b> desde su usuario…</>}
                </p>
              ) : (
                <>
                  <label><span className="etiqueta">Descuento</span>
                    <span className="flex">
                      <select value={descForm.tipo} onChange={(e) => setDescForm({ ...descForm, tipo: e.target.value as "pct" | "monto" })} className="rounded-l-lg border border-linea bg-white px-2">
                        <option value="pct">%</option><option value="monto">$</option>
                      </select>
                      <input value={descForm.valor} onChange={(e) => setDescForm({ ...descForm, valor: e.target.value })} className="w-24 rounded-r-lg border border-l-0 border-linea px-2 py-2" inputMode="decimal" autoFocus />
                    </span>
                  </label>
                  <label className="min-w-40 flex-1"><span className="etiqueta">Motivo</span>
                    <input value={descForm.motivo} onChange={(e) => setDescForm({ ...descForm, motivo: e.target.value })} className="campo" placeholder="Ej: producto con detalle, cliente frecuente" /></label>
                  <button className="boton" onClick={aplicarDescuento}>{soyDuenio ? "Aplicar" : "Pedir autorización"}</button>
                </>
              )}
              <button type="button" className="pb-2 text-sm text-suave underline" onClick={() => setDescForm(null)}>{descForm.pedido ? "Cerrar" : "Cancelar"}</button>
            </div>
          )}
          {varios && (
            <form className="tarjeta flex flex-wrap items-end gap-3 !p-4" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const precio = Number(String(f.get("precio")).replace(/\./g, "").replace(",", "."));
              if (!(precio > 0)) return;
              const efectivo = f.get("descuento") === "on" ? Math.round((precio * 0.85) / 50) * 50 : precio;
              setItems((x) => [...x, { producto_id: null, barcode: null, sku: null, nombre: String(f.get("nombre") || "Varios"), cantidad: 1, lista: precio, efectivo }]);
              setVarios(false);
              setModoGc(false);
              entrada.current?.focus();
            }}>
              <label className="min-w-40 flex-1"><span className="etiqueta">Descripción</span><input name="nombre" className="campo" placeholder="Varios" autoFocus /></label>
              <label className="w-36"><span className="etiqueta">Precio lista</span><input name="precio" className="campo" inputMode="decimal" required /></label>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="descuento" defaultChecked /> 15% en efectivo</label>
              <button className="boton">Agregar</button>
              <button type="button" className="pb-2 text-sm text-suave underline" onClick={() => setVarios(false)}>Cancelar</button>
            </form>
          )}
        </section>

        {/* ---------- Derecha: cobro ---------- */}
        <section className="flex shrink-0 flex-col rounded-2xl border border-linea bg-white lg:min-h-0 lg:shrink lg:overflow-hidden">
          <div className="flex-1 space-y-3 p-3 md:p-4 lg:overflow-auto">
            {/* Venta recién cobrada mientras ya se atiende a otro cliente: se puede imprimir igual */}
            {ultima && hayCarrito && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm">
                <span className="font-semibold text-green-900">✓ {ultima.cambio ? `Cambio ${ultima.cambio.codigo}` : ultima.giftcard_nueva ? `Gift card ${ultima.giftcard_nueva.codigo}` : `Venta ${codigoVenta(ultima.id)}`}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {ultima.giftcard_nueva
                    ? <button className="rounded-lg border border-green-300 bg-white px-2 py-1 text-xs font-semibold" onClick={() => { imprimir(ultima, "giftcard"); volverAlLector(); }}>Imprimir gift card</button>
                    : <>
                        <button className="rounded-lg border border-green-300 bg-white px-2 py-1 text-xs font-semibold" onClick={() => { imprimir(ultima, "recibo"); volverAlLector(); }}>Recibo X</button>
                        <BotonTicketsCambio chico onImprimir={(n) => { imprimir(ultima, "cambio", n); volverAlLector(); }} />
                      </>}
                  <button aria-label="Cerrar" className="px-1 text-lg leading-none text-green-900/60 hover:text-green-900" onClick={() => setUltima(null)}>×</button>
                </span>
              </div>
            )}

            {/* Total */}
            {modoGc ? (
              <label className="block">
                <span className="text-sm font-semibold text-marca">🎁 Valor de la gift card</span>
                <input value={montoGc} onChange={(e) => setMontoGc(e.target.value)} className="mt-1 w-full rounded-xl border-2 border-linea px-3 py-2 text-4xl font-semibold tabular-nums outline-none focus:border-marca"
                  inputMode="decimal" placeholder="$ 0" autoFocus />
                <span className="ayuda block">Se cobra completo. Al usarla, los productos van al precio del medio con que se pagó.</span>
                <input value={c.paraGc ?? ""} onChange={(e) => setParaGc(e.target.value)} className="campo mt-2" placeholder="Para quién es (opcional): nombre y apellido" autoComplete="off" />
              </label>
            ) : (
              <div>
                <p className="text-xs text-suave">{t.unidades ? `${t.unidades} ${t.unidades === 1 ? "unidad" : "unidades"}` : "Total"}{conGc && gc ? ` · precio ${nombreMedio(gc.medio_origen).toLowerCase()} (como se pagó la gift card)` : ""}</p>
                <p className="text-4xl leading-tight font-semibold tracking-tight tabular-nums">{pesos(div ? div.total : t.total)}</p>
              </div>
            )}

            {cambio && cambioCC && (
              <div className="space-y-1.5 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <p className="flex justify-between"><span>Lo devuelto</span><b className="tabular-nums">−{pesos(creditoCambio(cambio))}</b></p>
                <p className="flex justify-between"><span>Lo nuevo (precio de lista)</span><b className="tabular-nums">{pesos(t.total)}</b></p>
                <p className="flex justify-between border-t border-amber-200 pt-1 text-base"><span>{netoCC > 0 ? "Se suma a la cuenta de" : netoCC < 0 ? "Se descuenta de la cuenta de" : "Cambio justo · cuenta de"} {cambioCC.nombre}</span><b className="tabular-nums">{netoCC ? pesos(Math.abs(netoCC)) : ""}</b></p>
                {!soyDuenio && <p className="font-semibold text-red-800">Los cambios de cuenta corriente los hacen Martín o Sofi.</p>}
                {netoCC < 0 && cambio.enPlazo === false && <p className="font-semibold text-red-800">Pasaron más de 15 días: lo devuelto ya no se descuenta de la cuenta. Solo puede cambiarlo por algo de igual o mayor valor.</p>}
              </div>
            )}

            {cambio && rc && (
              <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <p className="flex justify-between"><span>Crédito por lo devuelto</span><b className="tabular-nums">{pesos(rc.credito)}</b></p>
                <p className="flex justify-between"><span>Lo nuevo (precio {nombreMedio(cambio.medio_precio).toLowerCase()})</span><b className="tabular-nums">{pesos(rc.precioGc)}</b></p>
                {rc.falta > 0 ? (
                  <>
                    <p className="pt-1 font-semibold">Falta pagar. ¿Con qué paga la diferencia?</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {MEDIOS_CAJA.map((m) => (
                        <button key={m.id} onClick={() => setMedioResto(m.id)}
                          className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${medioResto === m.id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{m.id === "cuotas" ? "Crédito cuotas" : m.nombre}</button>
                      ))}
                    </div>
                    <p className="flex justify-between text-base"><span>Diferencia en {nombreMedio(medioResto).toLowerCase()}</span><b className="tabular-nums">{pesos(rc.falta)}</b></p>
                  </>
                ) : rc.aFavor > 0 ? (
                  <p className="flex justify-between text-base text-green-800"><span>Saldo a favor → gift card</span><b className="tabular-nums">{pesos(rc.aFavor)}</b></p>
                ) : (
                  <p className="font-semibold text-green-800">Cambio justo: no paga nada.</p>
                )}
              </div>
            )}

            {/* Medios de pago: cada botón muestra cuánto queda con ese medio */}
            {!cambio && <div>
              <div className="grid grid-cols-3 gap-1.5">
                {MEDIOS_CAJA.map((m) => {
                  const elegido = medio === m.id;
                  return (
                    <button key={m.id} onClick={() => { setMedio(m.id); setGc(null); if (c.dividir?.resto === m.id) setDividir({ ...c.dividir, resto: m.id === "efectivo" ? "transferencia" : "efectivo" }); }}
                      className={`rounded-xl border-2 px-2.5 py-1.5 text-left leading-tight transition ${elegido ? "border-marca bg-marca text-white" : "border-linea bg-white hover:border-marca/50"}`}>
                      <span className="block truncate text-xs font-semibold">{m.id === "cuotas" ? "Crédito cuotas" : m.nombre}</span>
                      {!modoGc && items.length > 0 && (
                        <span className={`mt-0.5 block text-sm font-semibold tabular-nums ${elegido ? "text-white/90" : "text-tinta/70"}`}>{pesos(totales(items, m.id, ext).total).replace(",00", "")}</span>
                      )}
                    </button>
                  );
                })}
                {soyDuenio && !modoGc && (
                  <button onClick={() => { setMedio("cuenta"); setGc(null); setDividir(null); setAviso(null); if (!clientesCC) cargarClientesCC(); }}
                    className={`rounded-xl border-2 px-2.5 py-1.5 text-left leading-tight transition ${enCuenta ? "border-marca bg-marca text-white" : "border-linea bg-white hover:border-marca/50"}`}>
                    <span className="block truncate text-xs font-semibold">📒 Cuenta cte.</span>
                    {items.length > 0 ? <span className={`mt-0.5 block text-sm font-semibold tabular-nums ${enCuenta ? "text-white/90" : "text-tinta/70"}`}>{pesos(totales(items, "cuenta", ext).total).replace(",00", "")}</span>
                      : <span className={`mt-0.5 block text-xs ${enCuenta ? "text-white/85" : "text-suave"}`}>Precio de lista</span>}
                  </button>
                )}
                {!modoGc && (
                  <button onClick={() => { setMedio("giftcard"); setAviso(null); }}
                    className={`rounded-xl border-2 px-2.5 py-1.5 text-left leading-tight transition ${conGc ? "border-marca bg-marca text-white" : "border-linea bg-white hover:border-marca/50"}`}>
                    <span className="block text-xs font-semibold">🎁 Gift card</span>
                    <span className={`mt-0.5 block text-xs ${conGc ? "text-white/85" : "text-suave"}`}>Escaneala</span>
                  </button>
                )}
              </div>
              {!modoGc && !conGc && !enCuenta && items.length > 0 && !dividir && (
                <button className="mt-1.5 text-sm text-marca underline" onClick={() => { setDividir({ monto: "", resto: medio === "efectivo" ? "transferencia" : "efectivo" }); setAviso(null); }}>
                  + Pagar con dos medios
                </button>
              )}
            </div>}

            {dividir && (
              <div className="space-y-2 rounded-xl bg-marca-claro p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Pago en dos medios</p>
                  <button className="text-xs text-suave underline" onClick={() => setDividir(null)}>Pagar con uno solo</button>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className="shrink-0">En {nombreMedio(medio).toLowerCase()}</span>
                  <input autoFocus value={dividir.monto} onChange={(e) => setDividir({ ...dividir, monto: e.target.value })} inputMode="decimal" placeholder="$ cuánto"
                    className="min-w-0 flex-1 rounded-lg border border-linea bg-white px-2 py-1.5 text-right text-base tabular-nums outline-none focus:border-marca" />
                </label>
                <div>
                  <p className="text-xs font-semibold text-suave">El resto con</p>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {MEDIOS_CAJA.filter((m) => m.id !== medio).map((m) => (
                      <button key={m.id} onClick={() => setDividir({ ...dividir, resto: m.id })}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${dividir.resto === m.id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{m.id === "cuotas" ? "Crédito cuotas" : m.nombre}</button>
                    ))}
                  </div>
                </div>
                {div ? (
                  <div className="space-y-0.5 text-sm">
                    <p className="flex justify-between"><span>{nombreMedio(medio)}</span><b className="tabular-nums">{pesos(div.usa)}</b></p>
                    <p className="flex justify-between"><span>Resto en {nombreMedio(dividir.resto).toLowerCase()}</span><b className="tabular-nums">{pesos(div.falta)}</b></p>
                    <p className="flex justify-between border-t border-linea pt-0.5 text-base"><span>Total</span><b className="tabular-nums">{pesos(div.total)}</b></p>
                  </div>
                ) : montoDiv > 0 ? (
                  <p className="text-sm text-amber-900">Tiene que ser menos que el total en {nombreMedio(medio).toLowerCase()} ({pesos(t.total)}).</p>
                ) : null}
              </div>
            )}

            {enCuenta && (
              <div className="space-y-2 rounded-xl bg-marca-claro p-3 text-sm">
                {!ccCliente ? (
                  <ElegirClienta clientes={clientesCC} busca={buscaCC} setBusca={setBuscaCC} onElegir={(cl) => { cambiar({ cc: cl, nombre: c.nombre || cl.nombre }); setBuscaCC(""); }} />
                ) : (
                  <>
                    <p className="flex items-center justify-between"><span>A la cuenta de <b>{ccCliente.nombre}</b></span>
                      <button className="text-xs text-suave underline" onClick={() => cambiar({ cc: null })}>cambiar</button></p>
                    <p className="flex justify-between"><span>Debe ahora</span><span className="tabular-nums">{pesos(ccCliente.debe)}</span></p>
                    {items.length > 0 && <p className="flex justify-between font-semibold"><span>Va a deber</span><span className="tabular-nums">{pesos(ccDespues)}</span></p>}
                    {ccBloquea ? <p className="rounded-lg bg-red-100 px-2 py-1.5 font-semibold text-red-800">⛔ Pasaría el máximo de {pesos(2 * ccCliente.limite)} (el doble del límite). Primero tiene que pagar algo.</p>
                      : ccSupera ? <p className="rounded-lg bg-amber-100 px-2 py-1.5 font-semibold text-amber-900">⚠ Pasa el límite de {pesos(ccCliente.limite)}. Se puede anotar igual (bloquea en {pesos(2 * ccCliente.limite)}).</p> : null}
                  </>
                )}
              </div>
            )}

            {conGc && (
              <div className="space-y-3 rounded-xl bg-marca-claro p-3">
                {!gc ? (<>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (codigoGc.trim()) buscarGc(codigoGc.trim()); }}>
                    <input value={codigoGc} onChange={(e) => setCodigoGc(e.target.value)} className="campo" placeholder="Código o nombre de quien la recibió" autoFocus autoComplete="off" />
                    <button className="boton" disabled={buscandoGc}>{buscandoGc ? "…" : "Buscar"}</button>
                  </form>
                  {gcNombres && (
                    <ul className="divide-y divide-linea rounded-lg border border-linea bg-white text-sm">
                      {gcNombres.map((g) => (
                        <li key={g.codigo}><button className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-marca-claro" onClick={() => cargarGc(g.codigo)}>
                          <span><b>{g.destinatario}</b> <span className="font-mono text-xs text-suave">{g.codigo} · {new Date(g.creada_en).toLocaleDateString("es-AR")}</span></span>
                          <span className="font-semibold">{pesos(g.saldo)}</span></button></li>
                      ))}
                    </ul>
                  )}
                </>) : (
                  <>
                    <p className="flex justify-between text-sm"><span>Gift card <b className="font-mono">{gc.codigo}</b></span><span>Saldo <b>{pesos(gc.saldo)}</b></span></p>
                    {cgc && items.length > 0 && (
                      <>
                        <p className="flex justify-between text-sm"><span>Se descuenta de la tarjeta</span><b>{pesos(cgc.usa)}</b></p>
                        {cgc.falta > 0 ? (
                          <>
                            <p className="text-sm font-semibold text-amber-900">No alcanza. ¿Con qué paga el resto?</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              {MEDIOS_CAJA.map((m) => (
                                <button key={m.id} onClick={() => setMedioResto(m.id)}
                                  className={`rounded-lg border px-2 py-2 text-xs font-semibold ${medioResto === m.id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{m.nombre}</button>
                              ))}
                            </div>
                            <p className="flex justify-between text-base"><span>Resto en {nombreMedio(medioResto).toLowerCase()}</span><b className="tabular-nums">{pesos(cgc.falta)}</b></p>
                          </>
                        ) : (
                          <p className="flex justify-between text-sm text-green-800"><span>Le queda en la tarjeta</span><b>{pesos(cgc.saldoQueda)}</b></p>
                        )}
                      </>
                    )}
                    <button className="text-xs text-suave underline" onClick={() => { setGc(null); setCodigoGc(""); }}>Usar otra gift card</button>
                  </>
                )}
              </div>
            )}

            {medioEfectivo && hayCarrito && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-suave">Paga con</span>
                  {sugerenciasEfectivo.map((x, i) => (
                    <button key={x} onClick={() => setPagaCon(String(x))}
                      className={`rounded-lg border px-2 py-1 text-sm tabular-nums ${pago === x ? "border-marca bg-marca-claro font-semibold text-marca" : "border-linea"}`}>
                      {i === 0 ? "Justo" : pesos(x).replace(",00", "")}
                    </button>
                  ))}
                  <input value={pagaCon} onChange={(e) => setPagaCon(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cobrar()}
                    className="min-w-24 flex-1 rounded-lg border border-linea px-2 py-1 text-sm outline-none focus:border-marca" inputMode="decimal" placeholder="Otro monto" />
                </div>
                {vuelto !== null && (
                  <p className={`flex items-baseline justify-between rounded-xl px-3 py-1.5 ${vuelto < 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}>
                    <span className="text-sm font-semibold">{vuelto < 0 ? "Faltan" : "Vuelto"}</span>
                    <span className="text-xl font-semibold tabular-nums">{pesos(Math.abs(vuelto))}</span>
                  </p>
                )}
              </div>
            )}

            {aviso && <p className={`rounded-xl px-3 py-2 text-sm ${aviso.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{aviso.texto}</p>}

            {ultima && !hayCarrito && (
              <div className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="flex items-center gap-2 font-semibold text-green-900">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-700 text-sm text-white">✓</span>
                  {ultima.cambio ? `Cambio de la venta ${ultima.cambio.codigo} registrado` : ultima.giftcard_nueva ? `Gift card ${ultima.giftcard_nueva.codigo} vendida` : `Venta ${codigoVenta(ultima.id)} cobrada`}
                  <button aria-label="Cerrar" className="ml-auto text-xl leading-none text-green-900/60 hover:text-green-900" onClick={() => setUltima(null)}>×</button>
                </p>
                <p className="text-sm text-green-900">
                  {ultima.cambio && !ultima.cuenta
                    ? <>{ultima.total > 0 ? <>Pagó la diferencia: {pesos(ultima.total)} en {ultima.medio}.</> : ultima.giftcard_nueva ? <>Saldo a favor en la gift card <b>{ultima.giftcard_nueva.codigo}</b>: <b>{pesos(ultima.giftcard_nueva.monto)}</b>. Imprimila y entregásela.</> : "Cambio justo, sin diferencia."}</>
                    : ultima.cuenta
                    ? <>{ultima.total < 0 ? <>Se descontó {pesos(-ultima.total)} de la cuenta de</> : <>{pesos(ultima.total)} a la cuenta de</>} <b>{ultima.cuenta.nombre}</b>.{ultima.cuenta.saldo !== null ? <> Debe en total {pesos(ultima.cuenta.saldo)}.</> : null} Imprimí el recibo para que lo firme.</>
                    : ultima.giftcard
                    ? <>{pesos(ultima.giftcard.usado)} con gift card{ultima.total > 0 ? <> + {pesos(ultima.total)} en {ultima.medio}</> : null}. Saldo que le queda: <b>{pesos(ultima.giftcard.saldo ?? 0)}</b></>
                    : ultima.pagos?.length
                    ? <>{ultima.pagos.map((p) => `${pesos(p.monto)} en ${p.medio.toLowerCase()}`).join(" + ")}</>
                    : <>{pesos(ultima.total)} en {ultima.medio}</>}
                </p>
                {(() => {
                  const ef = ultima.pagos?.length ? ultima.pagos.find((p) => p.efectivo)?.monto ?? 0 : ultima.total;
                  return ultima.paga_con && ultima.paga_con > ef ? (
                    <p className="flex items-baseline justify-between rounded-lg bg-white px-3 py-2"><span className="text-sm font-semibold">Vuelto</span><span className="text-2xl font-semibold tabular-nums">{pesos(ultima.paga_con - ef)}</span></p>
                  ) : null;
                })()}
                {ultima.giftcard_nueva && (
                  <button className="boton w-full justify-center" onClick={() => { imprimir(ultima, "giftcard"); volverAlLector(); }}>🎁 Imprimir gift card</button>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className="boton-borde flex-1 justify-center" onClick={() => { imprimir(ultima, "recibo"); volverAlLector(); }}>Recibo X</button>
                  {!ultima.giftcard_nueva && <BotonTicketsCambio onImprimir={(n) => { imprimir(ultima, "cambio", n); volverAlLector(); }} />}
                </div>
                <label className="flex items-center justify-between gap-2 text-xs text-suave">Papel de la impresora
                  <select value={papel} onChange={(e) => setPapel(e.target.value as "80" | "58" | "a4")} className="rounded border border-linea bg-white px-1 py-0.5">
                    <option value="58">Ticket 58 mm</option><option value="80">Ticket 80 mm</option><option value="a4">Hoja A4</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Botón de cobrar, siempre a la vista */}
          <div className="sticky bottom-0 rounded-b-2xl border-t border-linea bg-white p-3 md:p-4">
            <button className="flex w-full items-center justify-between rounded-2xl bg-marca px-5 py-3 text-white shadow-sm transition hover:opacity-95 disabled:opacity-40" onClick={cobrar} disabled={!listoParaCobrar}>
              <span className="text-lg font-semibold">
                {cobrando ? "Cobrando…" : modoGc ? "Cobrar gift card" : cambioCC ? "Confirmar cambio en la cuenta" : enCuenta ? "Anotar en la cuenta" : rc ? (rc.falta > 0 ? "Cobrar diferencia" : rc.aFavor > 0 ? "Confirmar y dar gift card" : "Confirmar cambio") : conGc ? (cgc && cgc.falta > 0 ? "Cobrar con gift card + resto" : "Pagar con gift card") : dividir ? "Cobrar en dos medios" : "Cobrar"}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{!hayCarrito ? "" : rc ? pesos(rc.falta > 0 ? rc.falta : rc.aFavor) : modoGc || !conGc ? pesos(aCobrar) : cgc ? pesos(cgc.falta > 0 ? cgc.falta : cgc.usa) : ""}</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Buscador de clientas de cuenta corriente (lo usan la venta a cuenta y el cobro de una cuenta). */
function ElegirClienta({ clientes, busca, setBusca, onElegir }: {
  clientes: ClienteCaja[] | null; busca: string; setBusca: (x: string) => void; onElegir: (c: ClienteCaja) => void;
}) {
  if (!clientes) return <p className="text-sm text-suave">Buscando las cuentas corrientes…</p>;
  const sinTildes = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = sinTildes(busca.trim());
  const lista = clientes.filter((c) => !q || sinTildes(`${c.nombre} ${c.telefono ?? ""}`).includes(q)).slice(0, 8);
  return (
    <div className="space-y-1.5">
      <input value={busca} onChange={(e) => setBusca(e.target.value)} className="campo" placeholder="¿A qué clienta? Escribí el nombre" autoFocus autoComplete="off" />
      {lista.length ? (
        <ul className="divide-y divide-linea rounded-lg border border-linea bg-white text-sm">
          {lista.map((c) => (
            <li key={c.id}><button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-marca-claro" onClick={() => onElegir(c)}>
              <b>{c.nombre}</b>
              <span className={`tabular-nums ${c.debe > c.limite ? "font-semibold text-red-700" : "text-suave"}`}>{c.debe > 0 ? `debe ${pesos(c.debe)}` : "al día"}</span>
            </button></li>
          ))}
        </ul>
      ) : <p className="text-xs text-suave">{clientes.length ? "No hay ninguna con ese nombre." : "Todavía no hay cuentas."}</p>}
      <a href="/cuentas" target="_blank" className="text-xs text-marca underline">+ Crear una cuenta nueva</a>
    </div>
  );
}
