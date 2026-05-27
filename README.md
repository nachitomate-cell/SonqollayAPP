# SonqollayAPP

App móvil (PWA) para gestionar clientes y cotizaciones. Sin pérdida de seguimientos.

## Cómo usar

### Opción A — Abrir directo en el teléfono

1. Subí los archivos a cualquier hosting estático (GitHub Pages, Netlify, Vercel, etc.).
2. Abrí la URL desde tu teléfono.
3. En iPhone: Safari → Compartir → "Agregar a pantalla de inicio".
4. En Android: Chrome → menú → "Instalar app" / "Agregar a pantalla principal".

### Opción B — Probar local

```bash
cd SonqollayAPP
python3 -m http.server 8080
```

Luego abrir `http://localhost:8080` desde el teléfono (en la misma red Wi-Fi).

## Características

- **Cotizaciones**: alta/edición/borrado, estado (Borrador, Enviada, En revisión, Adjudicada, Perdida), valor en CLP, contactos, próximo seguimiento, notas.
- **Clientes**: ficha por empresa con persona de contacto, email, teléfono, cargo.
- **Dashboard**: KPIs, próximos seguimientos, últimas cotizaciones.
- **Buscador** en cotizaciones y clientes.
- **Exportar/Importar** respaldo en JSON. Exportar cotizaciones a CSV (compatible con Excel).
- **Enviar correo** desde el detalle de la cotización (abre el cliente de email del teléfono).
- **Compartir** vía `navigator.share` o portapapeles.
- **Offline-first**: funciona sin conexión gracias al Service Worker.
- **Datos locales**: persisten en `localStorage` del navegador del teléfono.

## Datos precargados

La app viene precargada con las 12 cotizaciones del respaldo de contactos (Arcadis, Keypro, Worley, JRI, WSP, Salfa, Techint, R&Q).

## Backup

Tus datos viven en el teléfono. Andá a **Ajustes → Exportar respaldo (JSON)** periódicamente y guardá el archivo en Drive / iCloud / email para no perder seguimientos.
