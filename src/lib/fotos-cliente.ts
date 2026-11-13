"use client";
// Achica una foto en la compu antes de subirla (así no se manda una foto de 5 MB por internet).
// El servidor la vuelve a pasar a .webp de 300x300 y menos de 40 KB, así que acá alcanza con acercarse.
import { LADO_MINIATURA } from "./fotos";

export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];

export async function achicarFoto(archivo: File): Promise<Blob> {
  if (!TIPOS_FOTO.includes(archivo.type) && !/\.(jpe?g|png|webp)$/i.test(archivo.name)) {
    throw new Error("Tiene que ser una foto .jpg, .png o .webp");
  }
  let img: ImageBitmap;
  try { img = await createImageBitmap(archivo, { imageOrientation: "from-image" }); }
  catch { throw new Error("No se pudo leer la foto (¿está dañada?)"); }
  // Recorte cuadrado desde el centro y al tamaño de la miniatura (el doble, para que el servidor la deje nítida)
  const lado = LADO_MINIATURA * 2;
  const corte = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(lado, corte);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, (img.width - corte) / 2, (img.height - corte) / 2, corte, corte, 0, 0, canvas.width, canvas.height);
  img.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.9));
  if (!blob) throw new Error("No se pudo achicar la foto");
  return blob; // si el navegador no sabe hacer .webp (algunos iPad) manda .png, y el servidor lo convierte
}
