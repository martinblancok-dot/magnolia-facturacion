import { activarUsuario, cambiarClaveUsuario, crearColaborador } from "../../acciones";
import { BotonAccion, Formulario } from "../../componentes";
import { fechaCorta } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { DOMINIO_EQUIPO, soloDuenio } from "@/lib/supabase/sesion";

export default async function Usuarios() {
  const yo = await soloDuenio();
  const db = clienteServidor();
  const [{ data: perfiles, error }, { data: lista }] = await Promise.all([
    db.from("perfiles").select("usuario_id, nombre, rol, activo, creado_en").order("rol").order("nombre"),
    db.auth.admin.listUsers({ perPage: 200 }),
  ]);
  const mail = (id: string) => lista?.users.find((x) => x.id === id)?.email ?? "";
  const usuario = (id: string) => mail(id).replace(`@${DOMINIO_EQUIPO}`, "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <p className="text-sm text-suave">
          Los colaboradores ven solo <b>Caja, Ventas, Productos y Stock</b>. Cobros, Facturas, Monotributo, Configuración y esta pantalla quedan solo para los dueños.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0009_usuarios.sql</b> en Supabase.</p>
      ) : (
        <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
          {(perfiles ?? []).map((p) => (
            <li key={p.usuario_id} className={`space-y-3 px-4 py-4 md:px-6 ${p.activo ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{p.nombre || usuario(p.usuario_id)}</b>{p.usuario_id === yo.id && <span className="text-suave"> (vos)</span>}
                  <span className="block text-sm text-suave">Usuario: {usuario(p.usuario_id)} · desde {fechaCorta(p.creado_en.slice(0, 10))}</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.rol === "duenio" ? "bg-marca text-white" : p.activo ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                  {p.rol === "duenio" ? "Dueño" : p.activo ? "Colaborador" : "Dado de baja"}
                </span>
              </div>
              {p.rol === "colaborador" && (
                <details>
                  <summary className="cursor-pointer text-sm text-marca underline">Cambiar contraseña o dar de baja</summary>
                  <div className="mt-3 flex flex-wrap items-end gap-4">
                    <Formulario accion={cambiarClaveUsuario.bind(null, p.usuario_id)} boton="Cambiar contraseña" className="flex flex-wrap items-end gap-3 [&>button]:mt-0">
                      <label><span className="etiqueta">Contraseña nueva</span><input name="clave" type="text" className="campo" autoComplete="off" minLength={6} required /></label>
                    </Formulario>
                    <BotonAccion accion={activarUsuario.bind(null, p.usuario_id, !p.activo)} texto={p.activo ? "Dar de baja" : "Activar de nuevo"} borde />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="tarjeta">
        <h2 className="font-semibold">Agregar colaborador</h2>
        <p className="ayuda">No hace falta mail: inventá un usuario corto (por ejemplo <b>juli</b>) y una contraseña, y pasáselos. Después la persona entra en sistema.casamagnolia.com.ar con ese usuario.</p>
        <Formulario accion={crearColaborador} boton="Crear usuario" className="mt-3 grid gap-3 sm:grid-cols-3">
          <label><span className="etiqueta">Nombre</span><input name="nombre" className="campo" required placeholder="Julieta" /></label>
          <label><span className="etiqueta">Usuario</span><input name="usuario" className="campo" required autoCapitalize="none" autoCorrect="off" placeholder="juli" /></label>
          <label><span className="etiqueta">Contraseña</span><input name="clave" type="text" className="campo" required minLength={6} autoComplete="off" /></label>
        </Formulario>
      </section>
    </div>
  );
}
