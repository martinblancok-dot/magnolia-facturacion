// Avisos de privacidad que Tiendanube exige a toda app (store/redact, customers/redact,
// customers/data_request). El sistema no guarda datos de clientes de la tienda online aparte
// de los pedidos, así que solo se verifica la firma, se registra y se responde OK.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { configTN } from "@/lib/tiendanube";

export async function POST(req: Request) {
  const cuerpo = await req.text();
  const firma = req.headers.get("x-linkedstore-hmac-sha256") ?? "";
  const { secreto } = configTN();
  if (secreto) {
    const esperada = createHmac("sha256", secreto).update(cuerpo).digest("hex");
    const a = Buffer.from(firma), b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }
  let evento = "";
  try { evento = (JSON.parse(cuerpo) as { event?: string }).event ?? ""; } catch {}
  console.log("Tiendanube privacidad:", evento || "(sin evento)");
  return NextResponse.json({ ok: true });
}
