// Se muestra al instante mientras carga la pantalla, para que el menú responda enseguida.
export default function Cargando() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Cargando">
      <div className="h-8 w-48 rounded-lg bg-linea/70" />
      <div className="h-4 w-72 rounded bg-linea/50" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 rounded-2xl bg-white" />
        <div className="h-28 rounded-2xl bg-white" />
        <div className="h-28 rounded-2xl bg-white" />
      </div>
      <div className="h-64 rounded-2xl bg-white" />
    </div>
  );
}
