// WSFE: el servicio de factura electrónica de ARCA.
import {
  COND_IVA_CONSUMIDOR_FINAL,
  CONCEPTO_PRODUCTOS,
  DOC_SIN_IDENTIFICAR,
  FACTURA_C,
  URLS,
  type Ambiente,
} from "./config";
import { escaparXml, llamarSoap } from "./soap";

const NS = "http://ar.gov.afip.dif.FEV1/";

export interface Credenciales {
  ambiente: Ambiente;
  cuit: string;
  token: string;
  sign: string;
}

export interface PedidoFactura {
  puntoVenta: number;
  numero: number;
  fecha: string; // AAAA-MM-DD
  importe: number; // total en pesos
  docTipo?: number; // 99 = sin identificar, 96 = DNI, 80 = CUIT
  docNro?: string;
}

export interface ResultadoFactura {
  aprobada: boolean;
  cae?: string;
  caeVence?: string; // AAAA-MM-DD
  mensajes: string[];
}

function auth(c: Credenciales): string {
  return `<ar:Auth><ar:Token>${escaparXml(c.token)}</ar:Token><ar:Sign>${escaparXml(c.sign)}</ar:Sign><ar:Cuit>${c.cuit}</ar:Cuit></ar:Auth>`;
}

const plata = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const sinGuiones = (f: string) => f.replace(/-/g, "");
const conGuiones = (f: string) => `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;

function lista<T>(x: T | T[] | undefined): T[] {
  return x === undefined ? [] : Array.isArray(x) ? x : [x];
}

function erroresDe(nodo: unknown): string[] {
  const n = nodo as { Err?: unknown; Obs?: unknown } | undefined;
  const items = [...lista(n?.Err as object), ...lista(n?.Obs as object)] as { Code?: string; Msg?: string }[];
  return items.map((e) => `${e.Code ?? ""} ${e.Msg ?? ""}`.trim());
}

/** Arma el XML del pedido de CAE para una Factura C a consumidor final. */
export function xmlSolicitarCAE(c: Credenciales, p: PedidoFactura): string {
  if (!(p.importe > 0)) throw new Error("El importe tiene que ser mayor a cero");
  const total = plata(p.importe);
  return (
    `<ar:FECAESolicitar xmlns:ar="${NS}">${auth(c)}<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${p.puntoVenta}</ar:PtoVta><ar:CbteTipo>${FACTURA_C}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>${CONCEPTO_PRODUCTOS}</ar:Concepto>` +
    `<ar:DocTipo>${p.docTipo ?? DOC_SIN_IDENTIFICAR}</ar:DocTipo><ar:DocNro>${p.docNro ?? "0"}</ar:DocNro>` +
    `<ar:CbteDesde>${p.numero}</ar:CbteDesde><ar:CbteHasta>${p.numero}</ar:CbteHasta>` +
    `<ar:CbteFch>${sinGuiones(p.fecha)}</ar:CbteFch>` +
    `<ar:ImpTotal>${total}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${total}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>` +
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${COND_IVA_CONSUMIDOR_FINAL}</ar:CondicionIVAReceptorId>` +
    `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`
  );
}

/** Interpreta la respuesta de FECAESolicitar. */
export function leerRespuestaCAE(body: Record<string, unknown>): ResultadoFactura {
  const r = (body.FECAESolicitarResponse as { FECAESolicitarResult?: Record<string, unknown> })?.FECAESolicitarResult;
  if (!r) throw new Error("Respuesta de ARCA sin resultado");
  const det = lista((r.FeDetResp as { FECAEDetResponse?: unknown })?.FECAEDetResponse)[0] as
    | { Resultado?: string; CAE?: string; CAEFchVto?: string; Observaciones?: unknown }
    | undefined;
  const mensajes = [...erroresDe(r.Errors), ...erroresDe(det?.Observaciones)];
  const aprobada = det?.Resultado === "A" && !!det.CAE;
  return {
    aprobada,
    cae: aprobada ? det!.CAE : undefined,
    caeVence: aprobada && det!.CAEFchVto ? conGuiones(det!.CAEFchVto) : undefined,
    mensajes,
  };
}

export async function solicitarCAE(c: Credenciales, p: PedidoFactura): Promise<ResultadoFactura> {
  const body = await llamarSoap(URLS[c.ambiente].wsfe, `${NS}FECAESolicitar`, xmlSolicitarCAE(c, p));
  return leerRespuestaCAE(body);
}

/** Último número de Factura C autorizado en ese punto de venta (0 si nunca se usó). */
export async function ultimoNumero(c: Credenciales, puntoVenta: number): Promise<number> {
  const body = await llamarSoap(
    URLS[c.ambiente].wsfe,
    `${NS}FECompUltimoAutorizado`,
    `<ar:FECompUltimoAutorizado xmlns:ar="${NS}">${auth(c)}<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${FACTURA_C}</ar:CbteTipo></ar:FECompUltimoAutorizado>`,
  );
  const r = (body.FECompUltimoAutorizadoResponse as { FECompUltimoAutorizadoResult?: Record<string, unknown> })
    ?.FECompUltimoAutorizadoResult;
  const errores = erroresDe(r?.Errors);
  if (!r || errores.length) throw new Error(`ARCA: ${errores.join("; ") || "sin respuesta"}`);
  return Number(r.CbteNro ?? 0);
}
