import { generarPDF } from "@/lib/pdf";
import { numeroFactura } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioActual();
  const { id } = await ctx.params;
  const db = clienteServidor();
  const [{ data: f }, { data: e }] = await Promise.all([
    db.from("facturas").select("*").eq("id", id).eq("usuario_id", u.id).maybeSingle(),
    db.from("emisores").select("*").eq("usuario_id", u.id).maybeSingle(),
  ]);
  if (!f || !e) return new Response("No encontrada", { status: 404 });

  const bytes = await generarPDF({
    emisor: { nombre: e.nombre, cuit: e.cuit, domicilio: e.domicilio, ingresosBrutos: e.ingresos_brutos, inicioActividades: e.inicio_actividades },
    factura: {
      puntoVenta: f.punto_venta, numero: f.numero, fecha: f.fecha, importe: Number(f.importe),
      cae: f.cae, caeVence: f.cae_vence, ambiente: f.ambiente,
    },
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Factura-C-${numeroFactura(f.punto_venta, f.numero)}.pdf"`,
    },
  });
}
