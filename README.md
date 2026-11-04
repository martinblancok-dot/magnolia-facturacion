# Magnolia · Facturación automática

Factura en ARCA (Factura C, monotributo) los cobros que entran por Mercado Pago:

- **Posnet y QR**: se facturan solos.
- **Transferencias**: quedan en "revisar" hasta que alguien confirme que son una venta.
- **Efectivo**: se sigue facturando a mano en Comprobantes en línea.

Cada persona (Martín, Sofi) tiene su usuario, su CUIT, su certificado y su cuenta de Mercado Pago.

## Cómo está armado

| Carpeta | Qué hay |
| --- | --- |
| `src/lib/arca/` | Conexión con ARCA: login (WSAA) y factura electrónica (WSFE) |
| `src/lib/mercadopago.ts` | Lee los cobros de Mercado Pago y decide si son posnet, QR o transferencia |
| `src/lib/fechas.ts` | Qué fecha lleva cada factura (hasta 5 días atrás, nunca antes de la última) |
| `src/lib/facturador.ts` | Factura los pendientes en orden, sin saltear números |
| `src/lib/secretos.ts` | Cifra certificados y tokens antes de guardarlos |
| `src/app/api/procesar/` | La tarea automática que corre cada 10-15 minutos |
| `supabase/migrations/` | Las tablas de la base de datos |
| `tests/` | Pruebas automáticas (`npm test`) |

## Reglas de seguridad

- Si ARCA no responde, el sistema **frena** y marca el cobro "[VERIFICAR EN ARCA]": no reintenta solo, para no facturar dos veces.
- Las ventas por encima de `UMBRAL_IDENTIFICACION` nunca se facturan solas (ARCA pide datos del comprador).
- Cada emisor arranca en `homologacion` (pruebas) y con `facturar_automatico = false`.

## Pantallas

- **Cobros**: pestañas Para revisar / Por facturar / Errores / Facturados / No son venta, botón "Traer cobros" desde una fecha y "Facturar ahora".
- **Facturas**: por mes, con total del mes, total de los últimos 12 meses contra el tope del monotributo, y PDF con QR de cada factura.
- **Configuración**: datos, archivos de ARCA, credencial de Mercado Pago, prueba/real, facturación automática, y "Probar conexión con ARCA".

## Estado

- [x] Conexión con ARCA, lectura de Mercado Pago, lógica de facturación, base de datos (con pruebas)
- [x] Pantallas
- [ ] Publicar: proyecto en Supabase + Vercel
- [ ] Tarea programada (`supabase/tarea-automatica.sql`)
- [ ] Prueba real en homologación con los certificados de Martín y Sofi
- [ ] Pasar a producción
