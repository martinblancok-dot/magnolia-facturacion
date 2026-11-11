/**
 * Magnolia ⇄ Precios Deco
 * Se pega en la planilla: Extensiones → Apps Script. Después, en la planilla: menú Magnolia → Configurar conexión.
 *
 * Qué hace:
 *  - Cada 10 minutos manda al sistema las pestañas de proveedores (productos nuevos, precios, nombres, bajas).
 *  - Antes, escribe en la planilla lo que se cambió en el sistema (nombre, costo, categoría y productos nuevos).
 *  - Desde el menú, suma al stock de un local las cantidades de "Lista Etiquetas".
 */

var URL_POR_DEFECTO = 'https://sistema.casamagnolia.com.ar';
var LOCALES = { 1: 'Magnolia Home', 2: 'Magnolia Beauty' };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Magnolia')
    .addItem('Sincronizar ahora', 'sincronizarAhora')
    .addSeparator()
    .addItem('Sumar "Lista Etiquetas" al stock de Magnolia Home', 'sumarStockHome')
    .addItem('Sumar "Lista Etiquetas" al stock de Magnolia Beauty', 'sumarStockBeauty')
    .addSeparator()
    .addItem('Copia de seguridad: hacer ahora', 'respaldoAhora')
    .addItem('Copia de seguridad: activar todas las semanas', 'activarRespaldoSemanal')
    .addSeparator()
    .addItem('Configurar conexión', 'configurar')
    .addToUi();
}

// ---------- Configuración ----------

function configurar() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var r1 = ui.prompt('Dirección del sistema', 'Dejá esta salvo que cambie:\n' + (props.getProperty('url') || URL_POR_DEFECTO), ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var url = (r1.getResponseText().trim() || props.getProperty('url') || URL_POR_DEFECTO).replace(/\/+$/, '');
  var r2 = ui.prompt('Clave de la planilla', 'Pegá la clave que genera el sistema en Configuración → Precios Deco.', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var token = r2.getResponseText().trim();
  if (!token) { ui.alert('Falta la clave.'); return; }
  props.setProperties({ url: url, token: token });
  props.deleteProperty('ultimaFirma');

  // Sincronización automática cada 10 minutos (una sola)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarAutomatico') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizarAutomatico').timeBased().everyMinutes(10).create();
  sincronizarAhora();
}

// ---------- Comunicación con el sistema ----------

function llamar_(metodo, ruta, cuerpo) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('url'), token = props.getProperty('token');
  if (!url || !token) throw new Error('Falta configurar la conexión: menú Magnolia → Configurar conexión.');
  var opciones = { method: metodo, headers: { 'x-magnolia-token': token }, muteHttpExceptions: true };
  if (cuerpo) { opciones.contentType = 'application/json'; opciones.payload = JSON.stringify(cuerpo); }
  var r = UrlFetchApp.fetch(url + ruta, opciones);
  var datos = {};
  try { datos = JSON.parse(r.getContentText()); } catch (e) { /* respuesta sin JSON */ }
  if (r.getResponseCode() >= 300) throw new Error(datos.error || ('El sistema respondió ' + r.getResponseCode()));
  return datos;
}

// ---------- Pestañas de proveedores ----------

function columnas_(hoja) {
  var ultimaCol = Math.min(hoja.getLastColumn(), 30);
  if (ultimaCol < 1) return null;
  var titulos = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0];
  var c = {};
  titulos.forEach(function (t, i) { var k = String(t).trim().toLowerCase(); if (k && !(k in c)) c[k] = i + 1; });
  return c;
}

function esProveedor_(c) {
  return c && c['producto'] && c['precio sugerido'] && c['barcode'] && (c['articulo interno'] || c['articulo']);
}

/** Todas las pestañas de proveedores, solo las filas con producto y solo hasta la columna que se usa. */
function leerPestanas_() {
  var res = [];
  SpreadsheetApp.getActive().getSheets().forEach(function (hoja) {
    var c = columnas_(hoja);
    if (!esProveedor_(c)) return;
    var ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return;
    var ancho = Math.max.apply(null, Object.keys(c).map(function (k) { return c[k]; }).filter(function (n) { return n <= 12; }));
    var datos = hoja.getRange(1, 1, ultimaFila, ancho).getValues();
    var colProducto = c['producto'] - 1;
    var filas = [datos[0]].concat(datos.slice(1).filter(function (f) { return String(f[colProducto]).trim() !== ''; }));
    res.push({ sheet: hoja.getName(), data: filas });
  });
  return res;
}

function filaPorBarcode_(hoja, c, barcode) {
  var n = hoja.getLastRow() - 1;
  if (n < 1) return 0;
  var valores = hoja.getRange(2, c['barcode'], n, 1).getValues();
  for (var i = 0; i < valores.length; i++) if (String(valores[i][0]).trim() === String(barcode)) return i + 2;
  return 0;
}

function conSku_(nombre, sku) {
  nombre = String(nombre).trim();
  sku = String(sku || '').trim();
  return sku && nombre.toLowerCase().indexOf(sku.toLowerCase()) < 0 ? nombre + ' ' + sku : nombre;
}

// ---------- Del sistema a la planilla ----------

function aplicarEdicion_(cambio) {
  var ss = SpreadsheetApp.getActive();
  var candidatas = [ss.getSheetByName(cambio.hoja)].concat(ss.getSheets());
  for (var i = 0; i < candidatas.length; i++) {
    var hoja = candidatas[i];
    if (!hoja) continue;
    var c = columnas_(hoja);
    if (!esProveedor_(c)) continue;
    var fila = filaPorBarcode_(hoja, c, cambio.barcode);
    if (!fila) continue;
    var d = cambio.datos || {};
    var colSku = c['articulo interno'] || c['articulo'];
    if (d.nombre) hoja.getRange(fila, c['producto']).setValue(conSku_(d.nombre, hoja.getRange(fila, colSku).getDisplayValue()));
    if (d.costo !== undefined && d.costo !== null && c['precio unitario']) hoja.getRange(fila, c['precio unitario']).setValue(Number(d.costo));
    if (d.categoria && c['categoria']) {
      var celda = hoja.getRange(fila, c['categoria']);
      if (String(celda.getValue()) !== String(d.categoria)) celda.setValue(d.categoria);
    }
    return;
  }
  throw new Error('No encontré el código de barras ' + cambio.barcode + ' en la planilla.');
}

function agregarNuevo_(cambio) {
  var hoja = SpreadsheetApp.getActive().getSheetByName(cambio.hoja);
  if (!hoja) throw new Error('No existe la pestaña "' + cambio.hoja + '".');
  var c = columnas_(hoja);
  if (!esProveedor_(c) || !c['articulo prov'] || !c['precio unitario']) {
    throw new Error('La pestaña "' + cambio.hoja + '" no tiene la columna Articulo Prov: cargalo a mano en la planilla.');
  }
  var d = cambio.datos || {};
  var articulo = String(d.articulo_prov).trim();
  var ultima = hoja.getLastRow();
  var productos = hoja.getRange(1, c['producto'], ultima, 1).getValues();
  var articulos = hoja.getRange(1, c['articulo prov'], ultima, 1).getDisplayValues();
  var ultimaConDatos = 1;
  for (var i = 1; i < ultima; i++) {
    if (String(productos[i][0]).trim() !== '') ultimaConDatos = i + 1;
    if (String(articulos[i][0]).trim() === articulo && String(productos[i][0]).trim() !== '') {
      throw new Error('El artículo ' + articulo + ' ya existe en "' + cambio.hoja + '" (fila ' + (i + 1) + ').');
    }
  }
  if (ultimaConDatos < 2) throw new Error('La pestaña "' + cambio.hoja + '" no tiene ninguna fila de ejemplo para copiar las fórmulas.');
  var fila = ultimaConDatos + 1;
  var ancho = hoja.getLastColumn();
  // Copia la fila de arriba (con sus fórmulas) y cambia los datos propios del producto
  hoja.getRange(ultimaConDatos, 1, 1, ancho).copyTo(hoja.getRange(fila, 1, 1, ancho));
  var celdaArticulo = hoja.getRange(fila, c['articulo prov']);
  celdaArticulo.setNumberFormat('@'); // conserva los ceros adelante
  celdaArticulo.setValue(articulo);
  hoja.getRange(fila, c['precio unitario']).setValue(Number(d.costo));
  if (d.categoria && c['categoria']) hoja.getRange(fila, c['categoria']).setValue(d.categoria);
  SpreadsheetApp.flush();
  var sku = hoja.getRange(fila, c['articulo interno'] || c['articulo prov']).getDisplayValue();
  hoja.getRange(fila, c['producto']).setValue(conSku_(d.nombre, sku));
}

function aplicarCambios_() {
  var r = llamar_('get', '/api/planilla/cambios');
  var resultados = [];
  (r.cambios || []).forEach(function (cambio) {
    try {
      if (cambio.tipo === 'nuevo') agregarNuevo_(cambio); else aplicarEdicion_(cambio);
      resultados.push({ id: cambio.id, ok: true });
    } catch (e) {
      resultados.push({ id: cambio.id, ok: false, error: e.message });
    }
  });
  if (resultados.length) llamar_('post', '/api/planilla/cambios', { resultados: resultados });
  return resultados;
}

// ---------- Sincronizar ----------

function firma_(texto) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texto, Utilities.Charset.UTF_8));
}

function sincronizar_(forzar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return null;
  try {
    var aplicados = aplicarCambios_();
    if (aplicados.length) SpreadsheetApp.flush();
    var hojas = leerPestanas_();
    var props = PropertiesService.getScriptProperties();
    var firma = firma_(JSON.stringify(hojas));
    if (!forzar && firma === props.getProperty('ultimaFirma')) return { sinCambios: true, aplicados: aplicados };
    var r = llamar_('post', '/api/planilla/sync', { hojas: hojas });
    props.setProperty('ultimaFirma', firma);
    r.aplicados = aplicados;
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** Lo corre el reloj cada 10 minutos. */
function sincronizarAutomatico() {
  sincronizar_(false);
}

function sincronizarAhora() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = sincronizar_(true);
    if (!r) { ui.alert('Ya se está sincronizando. Probá en un minuto.'); return; }
    var errores = (r.aplicados || []).filter(function (x) { return !x.ok; });
    var texto = 'Listo. ' + r.productos + ' productos en la planilla.\n' +
      '• Nuevos en el sistema: ' + r.nuevos + '\n• Actualizados: ' + r.actualizados + '\n• Dados de baja: ' + r.bajas;
    if ((r.aplicados || []).length) texto += '\n\nCambios del sistema escritos en la planilla: ' + (r.aplicados.length - errores.length);
    if (errores.length) texto += '\nNo se pudieron escribir ' + errores.length + ':\n' + errores.map(function (e) { return '- ' + e.error; }).join('\n');
    if (r.bajasFrenadas) texto += '\n\nOjo: llegaron muy pocos productos, así que no se dio de baja nada (' + r.bajasFrenadas + ' quedaron igual).';
    if (r.repetidos && r.repetidos.length) texto += '\n\nHay ' + r.repetidos.length + ' códigos de barras repetidos (se ven en el sistema, Configuración → Precios Deco).';
    ui.alert('Magnolia', texto, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Magnolia', 'No se pudo sincronizar: ' + e.message, ui.ButtonSet.OK);
  }
}

// ---------- Stock desde "Lista Etiquetas" ----------

function sumarStockHome() { sumarStock_(1); }
function sumarStockBeauty() { sumarStock_(2); }

function sumarStock_(local) {
  var ui = SpreadsheetApp.getUi();
  var hoja = SpreadsheetApp.getActive().getSheetByName('Lista Etiquetas');
  if (!hoja) { ui.alert('No encontré la pestaña "Lista Etiquetas".'); return; }
  var n = Math.max(hoja.getLastRow() - 1, 0);
  var filas = n ? hoja.getRange(2, 1, n, 2).getValues() : [];
  var items = [];
  for (var i = 0; i < filas.length; i++) {
    var sku = String(filas[i][0]).trim();
    if (!sku) continue;
    var cant = Number(filas[i][1]);
    items.push({ sku: sku, cantidad: cant > 0 ? Math.round(cant) : 1 });
  }
  if (!items.length) { ui.alert('"Lista Etiquetas" está vacía.'); return; }
  var unidades = items.reduce(function (s, x) { return s + x.cantidad; }, 0);

  var props = PropertiesService.getScriptProperties();
  var firma = firma_(JSON.stringify(items));
  var previo = JSON.parse(props.getProperty('ultimoStock') || 'null');
  if (previo && previo.firma === firma) {
    var otra = ui.alert('Ojo', 'Esta misma lista ya se sumó el ' + previo.fecha + ' a ' + LOCALES[previo.local] + '.\n¿Sumarla otra vez?', ui.ButtonSet.YES_NO);
    if (otra !== ui.Button.YES) return;
  }
  var ok = ui.alert('Sumar al stock', 'Se van a sumar ' + unidades + ' unidades (' + items.length + ' productos) al stock de ' + LOCALES[local] + '.\n¿Seguro?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  try {
    sincronizar_(false); // primero, que el sistema conozca los productos nuevos de la compra
    var r = llamar_('post', '/api/planilla/stock', { local: local, items: items, nota: 'Compra cargada desde Precios Deco (Lista Etiquetas)' });
    props.setProperty('ultimoStock', JSON.stringify({ firma: firma, local: local, fecha: Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM HH:mm') }));
    var texto = 'Listo: se sumaron ' + r.unidades + ' unidades de ' + r.sumados + ' productos al stock de ' + LOCALES[local] + '.';
    if (r.noEncontrados && r.noEncontrados.length) texto += '\n\nEstos SKU no están en el sistema (revisalos):\n' + r.noEncontrados.join(', ');
    ui.alert('Magnolia', texto, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Magnolia', 'No se pudo sumar el stock: ' + e.message, ui.ButtonSet.OK);
  }
}

// ---------- Copia de seguridad del sistema (en el Drive) ----------
// Baja todas las tablas del sistema (productos, stock, ventas, cajas, gift cards, cuentas, pedidos online,
// facturas) como archivos CSV dentro de un .zip en la carpeta "Respaldos Magnolia" del Drive.
// Guarda las últimas 12 copias. No incluye claves ni certificados.

var CARPETA_RESPALDOS = 'Respaldos Magnolia';
var COPIAS_A_GUARDAR = 12;

function csv_(filas) {
  if (!filas.length) return '';
  var cols = [];
  filas.forEach(function (f) { Object.keys(f).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
  var celda = function (v) {
    if (v === null || v === undefined) return '';
    var t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return [cols.join(',')].concat(filas.map(function (f) { return cols.map(function (c) { return celda(f[c]); }).join(','); })).join('\r\n');
}

function respaldo_() {
  var info = llamar_('get', '/api/respaldo');
  var blobs = [], total = 0;
  info.tablas.forEach(function (tabla) {
    var filas = [];
    for (var pagina = 0; pagina < 500; pagina++) {
      var r = llamar_('get', '/api/respaldo?tabla=' + encodeURIComponent(tabla) + '&pagina=' + pagina);
      filas = filas.concat(r.filas || []);
      if (!r.mas) break;
    }
    total += filas.length;
    blobs.push(Utilities.newBlob('\ufeff' + csv_(filas), 'text/csv', tabla + '.csv'));
  });
  var fecha = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd HH.mm');
  var nombre = 'Magnolia ' + fecha + '.zip';
  var carpetas = DriveApp.getFoldersByName(CARPETA_RESPALDOS);
  var carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(CARPETA_RESPALDOS);
  carpeta.createFile(Utilities.zip(blobs, nombre));
  // Borra las copias viejas (deja las últimas 12)
  var archivos = [], it = carpeta.getFiles();
  while (it.hasNext()) { var a = it.next(); if (/^Magnolia .*\.zip$/.test(a.getName())) archivos.push(a); }
  archivos.sort(function (x, y) { return y.getDateCreated() - x.getDateCreated(); });
  archivos.slice(COPIAS_A_GUARDAR).forEach(function (a) { a.setTrashed(true); });
  try { llamar_('post', '/api/respaldo', { archivo: nombre, filas: total }); } catch (e) { /* no frena la copia */ }
  return { nombre: nombre, filas: total, tablas: info.tablas.length };
}

/** Lo corre el reloj una vez por semana. */
function respaldoSemanal() {
  try { respaldo_(); }
  catch (e) {
    try { llamar_('post', '/api/respaldo', { error: e.message }); } catch (e2) { /* sin conexión */ }
    throw e; // Google le manda un mail al dueño del script avisando que falló
  }
}

function respaldoAhora() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = respaldo_();
    ui.alert('Magnolia', 'Copia guardada en tu Drive, carpeta "' + CARPETA_RESPALDOS + '":\n' + r.nombre + '\n(' + r.filas + ' filas de ' + r.tablas + ' tablas)', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Magnolia', 'No se pudo hacer la copia: ' + e.message, ui.ButtonSet.OK);
  }
}

function activarRespaldoSemanal() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'respaldoSemanal') ScriptApp.deleteTrigger(t);
  });
  // Domingos a la madrugada (los locales están cerrados)
  ScriptApp.newTrigger('respaldoSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).inTimezone('America/Argentina/Buenos_Aires').create();
  respaldoAhora();
}
