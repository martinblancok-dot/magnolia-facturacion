// Caja de prueba (/caja/prueba): usa su propio lugar en la compu (no se mezcla con la caja real)
// y todo lo que sube va marcado como prueba.
export const RUTA_PRUEBA = "/caja/prueba";
export const esPrueba = () => typeof window !== "undefined" && window.location.pathname.startsWith(RUTA_PRUEBA);
/** Nombre de lo que se guarda en la compu: en la caja de prueba lleva "-prueba" al final. */
export const clave = (k: string) => (esPrueba() ? `${k}-prueba` : k);
/** Para agregar a las direcciones de la API que buscan ventas o gift cards. */
export const paramPrueba = () => (esPrueba() ? "&prueba=1" : "");
