"use client";
import { desbloquearAdmin } from "../../acciones";
import { Formulario } from "../../componentes";

export function Desbloquear({ texto = "Desbloquear edición" }: { texto?: string }) {
  return (
    <Formulario accion={desbloquearAdmin} boton={texto} className="flex flex-wrap items-end gap-3">
      <label className="w-48">
        <span className="etiqueta">Clave de administrador</span>
        <input name="pin" type="password" className="campo" autoComplete="off" required />
      </label>
    </Formulario>
  );
}
