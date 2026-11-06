"use client";
import { useState, useTransition } from "react";
import { guardarAvisoCierre, guardarClaveResend, probarMailCierre } from "@/app/acciones";
import type { ConfigAviso } from "@/lib/supabase/aviso-cierre";

type Msj = { ok: boolean; texto: string } | null;

export function FormAviso({ inicial }: { inicial: ConfigAviso & { hayClaveMail: boolean } }) {
  const [wa, setWa] = useState(inicial.whatsapp.length ? inicial.whatsapp : [{ nombre: "Martín", numero: "" }, { nombre: "Sofi", numero: "" }]);
  const [mails, setMails] = useState(inicial.mails.join(", "));
  const [auto, setAuto] = useState(inicial.mailAuto);
  const [remitente, setRemitente] = useState(inicial.remitente);
  const [clave, setClave] = useState("");
  const [msj, setMsj] = useState<Msj>(null);
  const [msjMail, setMsjMail] = useState<Msj>(null);
  const [pendiente, empezar] = useTransition();

  const guardar = () => empezar(async () => {
    setMsj(await guardarAvisoCierre({ whatsapp: wa, mails: mails.split(/[,;\s]+/).filter(Boolean), mailAuto: auto, remitente }));
  });

  return (
    <>
      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">WhatsApp</h2>
        {wa.map((w, i) => (
          <div key={i} className="flex gap-2">
            <input className="campo !w-36" placeholder="Nombre" value={w.nombre} onChange={(e) => setWa(wa.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
            <input className="campo" placeholder="Celular (ej. 2625 15 123456)" inputMode="tel" value={w.numero} onChange={(e) => setWa(wa.map((x, j) => (j === i ? { ...x, numero: e.target.value } : x)))} />
            <button className="px-2 text-xl text-suave" aria-label="Quitar" onClick={() => setWa(wa.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {wa.length < 6 && <button className="text-sm text-marca underline" onClick={() => setWa([...wa, { nombre: "", numero: "" }])}>+ Agregar número</button>}
        <p className="ayuda">WhatsApp no permite mandar mensajes solo: el botón abre el chat con el texto listo y la persona que cierra toca Enviar.</p>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">Mail automático (opcional)</h2>
        <label className="block"><span className="etiqueta">Mandar a</span>
          <input className="campo" placeholder="martin@…, sofi@…" value={mails} onChange={(e) => setMails(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Mandar el resumen por mail cada vez que se cierra una caja</label>
        <button className="boton" disabled={pendiente} onClick={guardar}>{pendiente ? "Guardando…" : "Guardar"}</button>
        {msj && <p className={`text-sm ${msj.ok ? "text-green-800" : "text-red-800"}`}>{msj.texto}</p>}

        <div className="space-y-2 border-t border-linea pt-3">
          <p className="text-sm">Los mails salen con <b>Resend</b> (gratis hasta 3.000 por mes). {inicial.hayClaveMail ? <span className="text-green-800">✓ Ya hay una clave guardada.</span> : "Falta la clave."}</p>
          <ol className="ayuda list-decimal pl-5">
            <li>Creá una cuenta en resend.com con tu mail.</li>
            <li>En <i>API Keys</i> creá una clave (permiso &quot;Sending access&quot;) y pegala acá.</li>
            <li>Sin dominio propio, Resend solo deja mandar al mail con el que te registraste. Para mandar a los dos, en <i>Domains</i> agregá casamagnolia.com.ar, cargá los registros DNS que te muestra y poné abajo el remitente (ej. <code>Magnolia &lt;cierres@casamagnolia.com.ar&gt;</code>).</li>
          </ol>
          <div className="flex gap-2">
            <input className="campo" type="password" autoComplete="off" placeholder={inicial.hayClaveMail ? "•••••• (pegá otra para cambiarla)" : "re_…"} value={clave} onChange={(e) => setClave(e.target.value)} />
            <button className="boton-borde shrink-0 whitespace-nowrap" disabled={pendiente || !clave.trim()} onClick={() => empezar(async () => { setMsjMail(await guardarClaveResend(clave)); setClave(""); })}>Guardar clave</button>
          </div>
          <label className="block"><span className="etiqueta">Remitente (opcional, con dominio verificado)</span>
            <input className="campo" placeholder="Magnolia <cierres@casamagnolia.com.ar>" value={remitente} onChange={(e) => setRemitente(e.target.value)} /></label>
          <button className="boton-borde" disabled={pendiente} onClick={() => empezar(async () => { await guardarAvisoCierre({ whatsapp: wa, mails: mails.split(/[,;\s]+/).filter(Boolean), mailAuto: auto, remitente }); setMsjMail(await probarMailCierre()); })}>Mandar mail de prueba</button>
          {msjMail && <p className={`text-sm ${msjMail.ok ? "text-green-800" : "text-red-800"}`}>{msjMail.texto}</p>}
        </div>
      </section>
    </>
  );
}
