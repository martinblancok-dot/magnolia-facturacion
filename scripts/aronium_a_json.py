"""Convierte la base de Aronium (.db) en un archivo para importar las ventas viejas al sistema.

Uso: python3 scripts/aronium_a_json.py base.db LOCAL HASTA salida.json [--credito-en-cuotas]
  LOCAL: 1 = Magnolia Home, 2 = Magnolia Beauty
  HASTA: último día incluido (AAAA-MM-DD), el corte con Aronium
  --credito-en-cuotas: "Tarjeta de Credito" (sin aclarar) cuenta como cuotas (así era en Magnolia Home)
"""
import json, sqlite3, sys, uuid

NS = uuid.UUID("6f1d1a52-6c1b-4b5e-9a37-6d61676e6f6c")
MEDIOS = {
    "efectivo": "efectivo", "transferencia": "transferencia", "qr": "qr",
    "tarjeta de debito": "debito", "tarjeta de credito": "credito", "tarjeta de credito contado": "credito",
    "tarjeta de credito cuotas": "cuotas", "tarjeta elebar": "credito",
}

def main(db, local, hasta, salida, credito_en_cuotas=False):
    medios = dict(MEDIOS, **({"tarjeta de credito": "cuotas"} if credito_en_cuotas else {}))
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    codigos = {}
    for r in c.execute("select ProductId, Value from Barcode where Value is not null and trim(Value) <> '' order by Id"):
        codigos.setdefault(r["ProductId"], []).append(str(r["Value"]).strip())
    productos = {r["Id"]: r for r in c.execute("select Id, Name, Code from Product")}
    pagos = {}
    for r in c.execute("select p.DocumentId, p.Amount, pt.Name from Payment p join PaymentType pt on pt.Id = p.PaymentTypeId order by p.Id"):
        pagos.setdefault(r["DocumentId"], []).append((str(r["Name"]).strip().lower(), float(r["Amount"])))
    items = {}
    for r in c.execute("select * from DocumentItem order by Id"):
        items.setdefault(r["DocumentId"], []).append(r)

    ventas, desconocidos = [], set()
    for d in c.execute("select * from Document where DocumentTypeId in (2, 4) and substr(DateCreated, 1, 10) <= ? order by DateCreated", (hasta,)):
        devolucion = d["DocumentTypeId"] == 4
        signo = -1 if devolucion else 1
        ps = pagos.get(d["Id"], [])
        medio = medios.get(ps[0][0]) if ps else "efectivo"
        if medio is None:
            desconocidos.add(ps[0][0]); medio = "efectivo"
        lineas = []
        for n, i in enumerate(items.get(d["Id"], []), start=1):
            p = productos.get(i["ProductId"])
            cant = float(i["Quantity"])
            total = round(float(i["TotalAfterDocumentDiscount"]), 2)
            nombre = (p["Name"] if p else f"Producto {i['ProductId']}").strip()
            lineas.append({
                "n": n, "codigos": codigos.get(i["ProductId"], []), "sku": (str(p["Code"]).strip() if p and p["Code"] else None),
                "nombre": ("Devolución: " + nombre) if devolucion else nombre,
                "cantidad": signo * cant, "precio_unitario": round(total / cant, 2) if cant else total,
                "total": signo * total, "costo": round(float(i["ProductCost"]), 2) if i["ProductCost"] and float(i["ProductCost"]) > 0 else None,
            })
        fecha = str(d["DateCreated"])[:19].replace(" ", "T") + "-03:00"
        ventas.append({
            "id": str(uuid.uuid5(NS, f"aronium-{local}-{d['Id']}")), "numero": d["Number"], "creada_en": fecha, "medio_pago": medio,
            "total": signo * round(float(d["Total"]), 2),
            "total_lista": signo * round(sum(float(i["Total"]) for i in items.get(d["Id"], [])), 2),
            "items": lineas,
        })
    resumen = {}
    for v in ventas:
        m = v["creada_en"][:7]
        r = resumen.setdefault(m, {"ventas": 0, "total": 0})
        r["ventas"] += 1; r["total"] = round(r["total"] + v["total"], 2)
    json.dump({"origen": "aronium", "local": local, "hasta": hasta, "ventas": ventas, "resumen": resumen}, open(salida, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{salida}: {len(ventas)} documentos, total ${sum(v['total'] for v in ventas):,.0f}", "medios desconocidos:", desconocidos or "ninguno")

if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], "--credito-en-cuotas" in sys.argv[5:])
