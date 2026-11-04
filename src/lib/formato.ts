export const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n);

/** AAAA-MM-DD → DD/MM/AAAA */
export const fechaCorta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));

export const numeroFactura = (pv: number, n: number) => `${String(pv).padStart(5, "0")}-${String(n).padStart(8, "0")}`;

export const ORIGENES: Record<string, string> = { posnet: "Posnet", qr: "QR", transferencia: "Transferencia", otro: "Otro" };
