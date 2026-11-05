import { ingresar } from "../acciones";
import { Formulario } from "../componentes";

export default function Ingresar() {
  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-semibold">Magnolia</h1>
      <p className="mt-1 text-suave">Ingresá con tu mail y contraseña.</p>
      <Formulario accion={ingresar} boton="Ingresar" className="tarjeta mt-6">
        <label className="etiqueta" htmlFor="email">Usuario o mail</label>
        <input id="email" name="email" type="text" required className="campo" autoComplete="username" autoCapitalize="none" autoCorrect="off" />
        <label className="etiqueta mt-4" htmlFor="clave">Contraseña</label>
        <input id="clave" name="clave" type="password" required className="campo" autoComplete="current-password" />
      </Formulario>
    </main>
  );
}
