"use client";
// Lector de códigos de barras con la cámara (para el teléfono o la tablet, donde no hay lector USB).
// Usa el lector propio del navegador si lo tiene (Chrome en Android) y si no, ZXing (iPhone, etc.).
import { useEffect, useRef, useState } from "react";

type Resultado = { ok: boolean; texto: string } | void;
type Props = {
  /** Se llama con cada código leído; puede devolver un mensaje para mostrar (ej. el producto agregado). */
  onCodigo: (codigo: string) => Resultado | Promise<Resultado>;
  onCerrar: () => void;
  /** true = sigue leyendo (caja, stock); false = se cierra con el primer código (ticket de cambio). */
  continuo?: boolean;
  titulo?: string;
};

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code"];

function pitido(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const a = new Ctx(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = ok ? 1500 : 300; g.gain.value = 0.08;
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? 0.09 : 0.25));
    setTimeout(() => a.close(), 400);
  } catch {}
  try { navigator.vibrate?.(ok ? 60 : [80, 60, 80]); } catch {}
}

export function EscanerCamara({ onCodigo, onCerrar, continuo = true, titulo = "Escanear con la cámara" }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<{ ok: boolean; texto: string } | null>(null);
  const [linterna, setLinterna] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const cb = useRef(onCodigo);
  const cerrar = useRef(onCerrar);
  useEffect(() => { cb.current = onCodigo; cerrar.current = onCerrar; });

  useEffect(() => {
    let parar = () => {};
    let vivo = true;
    let anterior = { codigo: "", en: 0 };
    const leido = async (codigo: string) => {
      const c = codigo.trim();
      const ahora = Date.now();
      if (!c) return;
      // Mientras el mismo código siga frente a la cámara no se vuelve a sumar: hay que sacarlo
      // (o apuntar a otro) al menos 1,5 segundos para que cuente otra unidad.
      if (c === anterior.codigo && ahora - anterior.en < 1500) { anterior.en = ahora; return; }
      anterior = { codigo: c, en: ahora };
      const r = (await cb.current(c)) ?? { ok: true, texto: c };
      pitido(r.ok);
      setUltimo(r);
      if (!continuo && r.ok) { parar(); cerrar.current(); }
    };

    (async () => {
      await Promise.resolve();
      if (!vivo) return; // se desmontó enseguida (no abrir la cámara dos veces)
      if (!navigator.mediaDevices?.getUserMedia) { setError("Este navegador no puede usar la cámara. Abrí el sistema en Chrome o Safari (con https)."); return; }
      try {
        const nativo = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> }; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
        const soportados = nativo ? await nativo.getSupportedFormats().catch(() => [] as string[]) : [];
        if (nativo && soportados.includes("ean_13") && soportados.includes("code_128")) {
          // Lector del navegador: rápido y liviano
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return; }
          const v = video.current!;
          v.srcObject = stream; await v.play();
          const track = stream.getVideoTracks()[0];
          if ((track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setLinterna({ on: false, track });
          const det = new nativo({ formats: FORMATOS.filter((f) => soportados.includes(f)) });
          let corriendo = true;
          const ciclo = async () => {
            if (!corriendo) return;
            try { const r = await det.detect(v); if (r[0]?.rawValue) await leido(r[0].rawValue); } catch {}
            if (corriendo) setTimeout(ciclo, 120);
          };
          ciclo();
          parar = () => { corriendo = false; stream.getTracks().forEach((t) => t.stop()); };
        } else {
          // ZXing (iPhone/iPad y navegadores sin lector propio)
          const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE]);
          const lector = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
          const controles = await lector.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
            video.current!, (res) => { if (res) leido(res.getText()); },
          );
          if (!vivo) { controles.stop(); return; }
          parar = () => controles.stop();
          const track = (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
          if (track && (track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setLinterna({ on: false, track });
        }
      } catch (e) {
        const n = (e as Error).name;
        setError(n === "NotAllowedError" ? "No hay permiso para usar la cámara. Tocá el candado de la barra de direcciones → Permisos → Cámara → Permitir, y volvé a abrir el lector."
          : n === "NotFoundError" ? "Este equipo no tiene cámara." : `No se pudo abrir la cámara (${(e as Error).message}).`);
      }
    })();
    return () => { vivo = false; parar(); };
  }, [continuo]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-semibold">{titulo}</p>
        <div className="flex items-center gap-2">
          {linterna && (
            <button className="rounded-full border border-white/40 px-3 py-1.5 text-sm" onClick={async () => {
              try { await linterna.track.applyConstraints({ advanced: [{ torch: !linterna.on } as MediaTrackConstraintSet] }); setLinterna({ ...linterna, on: !linterna.on }); } catch {}
            }}>{linterna.on ? "Apagar luz" : "Luz"}</button>
          )}
          <button className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black" onClick={onCerrar}>{continuo ? "Listo" : "Cancelar"}</button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} className="h-full w-full object-cover" playsInline muted />
        {/* guía para apuntar */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-36 w-[80%] max-w-md rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
            <div className="mx-auto mt-[4.25rem] h-0.5 w-[90%] animate-pulse bg-red-500" />
          </div>
        </div>
      </div>
      <div className="min-h-20 px-4 py-3 text-center">
        {error ? <p className="text-amber-300">{error}</p>
          : ultimo ? <p className={`text-lg font-semibold ${ultimo.ok ? "text-green-300" : "text-red-300"}`}>{ultimo.ok ? "✓ " : "✗ "}{ultimo.texto}</p>
          : <p className="text-white/70">Apuntá al código de barras, horizontal y a unos 10–15 cm. Para sumar otra unidad del mismo, sacalo de la cámara y volvé a apuntar.</p>}
      </div>
    </div>
  );
}

/** Botón con ícono de cámara para abrir el lector. */
export function BotonCamara({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Escanear con la cámara" title="Escanear con la cámara"
      className={`flex shrink-0 items-center justify-center rounded-xl border-2 border-linea bg-white px-3 text-marca hover:border-marca ${className}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
        <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
      </svg>
    </button>
  );
}
