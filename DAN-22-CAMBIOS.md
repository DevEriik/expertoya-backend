# DAN-22 — Backend: comprobante digital, Socket.io y aliases

Registro paso a paso de lo que se implementó en `expertoya-backend` para cerrar
la Tarea 16 (Pasarela de Pagos), partiendo de la base que ya existía.

---

## Punto de partida

El escrow, la preferencia de pago, el webhook, la retención, la comisión, la
doble confirmación, la liberación y los payouts **ya estaban implementados y
probados**. Faltaba:

1. Generar el comprobante PDF y subirlo a Supabase.
2. Exponer la descarga del comprobante.
3. Emitir `pago:retenido` por Socket.io.
4. Ofrecer las rutas/payloads que espera el móvil según la issue.
5. Completar la configuración de Docker.

---

## Paso 1 — Nueva columna `comprobante_url`

**Archivo:** `prisma/schema.prisma`

En `PagoEscrow` ya existían `comprobante_numero`, `comprobante_hash` y
`comprobante_generado_en`, pero faltaba dónde guardar la URL pública del PDF.
Se agregó:

```prisma
comprobante_url String?
```

### Migración sin romper la base

Se detectó que la base contiene tablas y columnas de **otras tareas**
(`bloqueo_usuario`, `reporte_denuncia`, `experiencia`, `activo`, etc.) que este
schema no conoce. Por eso **no se ejecutó `prisma migrate dev`**: el diff
completo habría borrado esas estructuras.

En su lugar se hizo una migración quirúrgica:

1. Se creó la carpeta
   `prisma/migrations/20261115184737_add_comprobante_url_to_pago_escrow/`
   con:

   ```sql
   -- AlterTable
   ALTER TABLE "pago_escrow" ADD COLUMN "comprobante_url" TEXT;
   ```

2. Se aplicó el cambio por la conexión directa:

   ```bash
   npx prisma db execute --url "$DIRECT_URL" --file add_column.sql
   ```

3. Se marcó la migración como aplicada, para que el historial quede coherente:

   ```bash
   npx prisma migrate resolve --applied 20261115184737_add_comprobante_url_to_pago_escrow
   ```

4. Se regeneró el cliente Prisma:

   ```bash
   npx prisma generate
   ```

Resultado: `prisma migrate status` → **“Database schema is up to date!”** con
3 migraciones.

---

## Paso 2 — Subida de buffers a Supabase

**Archivo:** `src/services/storage.service.ts`

El servicio solo sabía subir archivos de Multer (`Express.Multer.File`). Se
separó en dos funciones:

- **`subirBuffer(buffer, nombreArchivo, contentType)`**: nueva. Sube cualquier
  `Buffer` y devuelve la URL pública. Es la que usa el comprobante.
- **`subirArchivo(file, carpeta)`**: se mantiene igual por compatibilidad, pero
  ahora internamente delega en `subirBuffer`.

Así no se duplica la lógica del bucket `archivos` ni la obtención de la URL
pública.

---

## Paso 3 — Generación del comprobante PDF

**Archivo nuevo:** `src/services/receipt.service.ts`

Clase `ReceiptService` con dos métodos:

- **`construirComprobantePdf(data)`**: genera el PDF en memoria con `pdfkit` y
  devuelve un `Buffer`. Es público para poder probarlo sin subir nada.
- **`generarComprobantePago(data)`**: construye el PDF, calcula su **SHA-256**,
  lo sube a Supabase en `comprobantes/CMP-XXXXXXXXXX.pdf` y devuelve
  `{ url, numero, hash, generadoEn }`.

El PDF incluye:

- Nombre **ExpertoYa** y título “Comprobante digital de pago”.
- N° de comprobante, fecha de emisión, estado e ID de operación de Mercado Pago.
- Solicitud y servicio.
- Cliente y profesional (nombre y email).
- Detalle económico: monto total, comisión de ExpertoYa (con porcentaje),
  fee de Mercado Pago y neto del profesional.
- Nota aclaratoria de que el dinero permanece retenido hasta la doble
  confirmación.

Se exporta una instancia lista para usar: `receiptService`.

---

## Paso 4 — Socket.io accesible desde los servicios

**Archivo nuevo:** `src/sockets/socket.registry.ts`

Antes `io` solo existía dentro de `index.ts` y se pasaba a `initChatSocket`.
Los servicios no podían emitir eventos.

Se creó un registro global con:

- `setIO(io)`: guarda la instancia.
- `getIO()`: la devuelve.
- `emitToRoom(room, evento, payload)`: emite si `io` está inicializado; si no
  (por ejemplo, en un script), registra un warning y no falla.

**Archivo:** `index.ts`

- Se importa `setIO` y se llama inmediatamente después de `initChatSocket(io)`.

**Archivo:** `src/sockets/chat.socket.ts`

- Al conectarse, además de `socket.join("usuario_" + userId)`, ahora también se
  hace `socket.join("user:" + userId)`.

Esto es clave porque la issue pide emitir a `user:${clienteId}` y
`user:${profesionalId}`, mientras que el chat ya usaba `usuario_<id>`. Se
mantienen **las dos salas** para no romper nada.

---

## Paso 5 — Integración en `PaymentService`

**Archivo:** `src/services/payment.service.ts`

### 5.1 Método privado `generarComprobanteRetencion(...)`

Hace tres cosas, sin relanzar errores (un fallo del PDF o del socket **no debe**
revertir un pago ya aprobado):

1. Genera el comprobante con `receiptService`.
2. Guarda en `PagoEscrow`: `comprobante_url`, `comprobante_hash`,
   `comprobante_numero` y `comprobante_generado_en`.
3. Emite `pago:retenido` a las salas `usuario_<id>` y `user:<id>` del cliente y
   del profesional, con:

   ```json
   {
     "solicitudId": "…",
     "pagoId": "…",
     "estado": "RETENIDO",
     "montoTotal": "10000.00",
     "moneda": "ARS",
     "comprobanteUrl": "https://…"
   }
   ```

### 5.2 Llamada desde el webhook

Dentro de `processPaymentWebhook`, en la rama donde el pago aprobado pasa a
`RETENIDO`, se invoca `generarComprobanteRetencion(...)` justo antes de
devolver el pago actualizado. Se ejecuta una sola vez porque los estados
finales cortan el reproceso.

### 5.3 Nuevo método público `getComprobante(...)`

Recibe `solicitudId`, `userId` y `userRole`:

- Busca la solicitud con su servicio, profesional y último pago.
- Verifica que el usuario sea el cliente, el profesional o un admin.
- Si el pago no tiene `comprobante_url`, responde con un error de negocio
  (“El comprobante todavía no está disponible”).
- Devuelve `{ comprobante_url, pago_id, estado_pago }`.

### 5.4 `getPaymentDetails` expone la URL

Se agregó `comprobante_url` a `PaymentDetailsResult` y a la respuesta, para que
el móvil pueda habilitar el botón de descarga sin una llamada extra.

### 5.5 Inyección de dependencia

`ReceiptService` se agregó al constructor de `PaymentService` y se pasa la
instancia en el export final:

```ts
export const paymentService = new PaymentService(
  prisma,
  mercadoPagoService,
  notificacionService,
  emailService,
  receiptService,
);
```

---

## Paso 6 — Controlador y rutas

**Archivo:** `src/controllers/payment.controller.ts`

- Nuevo handler `getComprobante`, con el mismo manejo de errores que el resto.
- `createPaymentPreference` ahora acepta `solicitud_id` **o** `solicitudId`
  (el nombre que usa la issue), sin romper el contrato anterior.

**Archivo:** `src/routes/payment.routes.ts`

Se agregó `GET /:solicitudId/comprobante` y tres **aliases** compatibles con la
issue, que conviven con las rutas originales:

| Issue DAN-22 | Implementado |
|---|---|
| `POST /api/payments/create-preference` | `POST /api/payments/preferences` |
| `POST /api/payments/:solicitudId/confirmar-finalizacion` | `POST /api/payments/solicitud/:solicitudId/confirm` |
| `POST /api/payments/webhook` | `POST /api/webhooks/mercadopago` |

**Archivo:** `index.ts`

- Se monta `app.use("/api/payments/webhook", webhookRoutes)` **antes** del
  router general de pagos, para el alias del webhook.

---

## Paso 7 — Docker

**Archivo:** `docker-compose.yml`

Se agregaron las variables de Mercado Pago y de negocio, con valores por
defecto para desarrollo:

```yaml
- MP_ENV=${MP_ENV:-sandbox}
- MP_ACCESS_TOKEN=${MP_ACCESS_TOKEN}
- MP_PUBLIC_KEY=${MP_PUBLIC_KEY}
- MP_WEBHOOK_SECRET=${MP_WEBHOOK_SECRET}
- MP_COLLECTOR_ID=${MP_COLLECTOR_ID}
- BACKEND_PUBLIC_URL=${BACKEND_PUBLIC_URL:-http://localhost:3000}
- APP_PUBLIC_URL=${APP_PUBLIC_URL:-http://localhost:8081}
- COMISION_PORCENTAJE=${COMISION_PORCENTAJE:-10}
- PAYOUT_MODE=${PAYOUT_MODE:-SIMULADO}
- ALLOW_PAYMENT_SIMULATION=${ALLOW_PAYMENT_SIMULATION:-true}
```

---

## Paso 8 — Pruebas ejecutadas

### 8.1 TypeScript

```bash
npx tsc --noEmit
```

→ sin errores.

### 8.2 Smoke test ampliado

**Archivo:** `scripts/payment-smoke.ts`

Se agregó un paso 6 que genera el PDF en memoria y verifica:

- Que el buffer empiece con `%PDF`.
- Que tenga contenido (> 1000 bytes).

Resultado:

```text
6) Comprobante PDF
  ✔ el comprobante tiene cabecera %PDF
  ✔ el comprobante tiene contenido (2535 bytes)

✅ Smoke test completado con éxito
[Cleanup] Datos de prueba eliminados.
```

### 8.3 Subida real a Supabase

Se ejecutó un script temporal que generó un comprobante, lo subió y luego lo
eliminó del bucket. Resultado:

```text
URL: https://<proyecto>.supabase.co/storage/v1/object/public/archivos/comprobantes/CMP-0000000000.pdf
NUMERO: CMP-0000000000
Archivo de prueba eliminado.
```

El script temporal se borró después de la prueba.

### 8.4 Estado de migraciones

```bash
npx prisma migrate status
```

→ `3 migrations found` / `Database schema is up to date!`

---

## Estado final del checklist

| Requisito | Estado |
|---|---|
| Integración con Mercado Pago (crédito, débito y saldo) | ✅ Checkout Pro |
| “Marcar como finalizado” por ambas partes | ✅ |
| Retención y comisión automática | ✅ |
| Comprobante digital descargable | ✅ PDF + Supabase + endpoint |
| Protección antifraude delegada | ✅ Checkout Pro + firma HMAC |

---

## Pendientes / decisiones

1. **`MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`** siguen vacíos en el `.env`
   local. El flujo real contra Mercado Pago (sandbox con dinero ficticio)
   requiere esas credenciales, usuarios de prueba y exponer el webhook con
   ngrok/cloudflared.
2. **Emails con Resend**: la issue lo menciona, pero se mantuvo el
   `EmailService` existente (nodemailer/Gmail). Si la cátedra exige Resend,
   hay que agregar el SDK y el proveedor.
3. **Disputas**: el modelo existe y bloquea liberaciones, pero no hay endpoints
   para crearlas/resolverlas (Tarea 18).
4. **Drift de enums**: al reparar la base el 2026-11-04, los enums quedaron con
   los valores nuevos al final. Prisma lo detecta como diferencia de orden, pero
   es cosmético: no afecta el funcionamiento. No se reordenaron para evitar
   romper dependencias.
5. **Tablas de otras ramas**: la base tiene estructuras (`bloqueo_usuario`,
   `reporte_denuncia`, etc.) que este schema no declara. Antes de correr
   `prisma migrate dev` hay que sincronizar el schema con todas las ramas, o se
   corre riesgo de que Prisma proponga borrarlas.

---

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `comprobante_url` en `PagoEscrow` |
| `prisma/migrations/20261115184737_…/migration.sql` | Migración de la columna |
| `src/services/storage.service.ts` | `subirBuffer` + refactor |
| `src/services/receipt.service.ts` | **Nuevo**: PDF con pdfkit |
| `src/sockets/socket.registry.ts` | **Nuevo**: registro global de io |
| `src/sockets/chat.socket.ts` | Join a la sala `user:<id>` |
| `src/services/payment.service.ts` | Comprobante, socket, `getComprobante`, URL en detalles |
| `src/controllers/payment.controller.ts` | Handler de comprobante y payload flexible |
| `src/routes/payment.routes.ts` | Descarga + aliases |
| `index.ts` | `setIO` y alias del webhook |
| `docker-compose.yml` | Variables `MP_*` y de negocio |
| `scripts/payment-smoke.ts` | Verificación del PDF |
| `PAYMENTS.md` | Documentación actualizada |
