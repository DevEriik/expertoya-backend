# Pagos con Mercado Pago (Checkout Pro)

Documentación de la integración de pagos de ExpertoYa: cuenta recaudadora
propia, ledger interno y payouts manuales/simulados.

---

## 1. Alcance

- **Mercado Pago Checkout Pro** únicamente, con la cuenta de ExpertoYa como
  recaudadora. Sin Split Payments, Marketplace ni OAuth.
- Los fondos quedan **retenidos internamente** (cuenta de clearing + ledger).
- Los pagos a profesionales son **manuales o simulados**: no hay transferencias
  bancarias automáticas.
- Moneda única: **ARS**.
- Los **webhooks + la API de Mercado Pago** son la fuente de verdad. Nunca se
  confía en la redirección del frontend ni se almacenan datos de tarjeta.

---

## 2. Arquitectura de fondos

```
Cliente ──paga──▶ Mercado Pago (cuenta ExpertoYa)
                        │ webhook
                        ▼
                 PagoEscrow (RETENIDO)
                        │ confirmaciones de ambas partes
                        ▼
                 Payout (SIMULADO → PAGADO / MANUAL → PENDIENTE)
                        │ admin confirma la transferencia real
                        ▼
                 Payout PAGADO + movimiento en el ledger
```

El **ledger** (`MovimientoPago`) es la contabilidad interna. Cada movimiento
tiene una `referencia` única (generada con `generateLedgerReference`) para
garantizar idempotencia.

Cuentas del ledger (`CuentaLedger`):

| Cuenta | Uso |
|---|---|
| `MERCADO_PAGO` | Entradas de dinero (cobro) y salidas por fee/reembolso |
| `PLATAFORMA` | Comisión de ExpertoYa |
| `PROFESIONAL` | Neto del profesional y payouts (negativos) |

Movimientos generados:

| Momento | Tipo | Cuenta |
|---|---|---|
| Pago aprobado | `COBRO` | `MERCADO_PAGO` |
| Pago aprobado | `COMISION` | `PLATAFORMA` |
| Pago aprobado | `FEE_MP` | `MERCADO_PAGO` |
| Pago aprobado | `NETO_PROFESIONAL` | `PROFESIONAL` |
| Liberación | `PAYOUT` (negativo) | `PROFESIONAL` |
| Reembolso | `REEMBOLSO` + `AJUSTE` | `MERCADO_PAGO`, `PLATAFORMA`, `PROFESIONAL` |

---

## 3. Modelo de datos

- **`PagoEscrow`** (`pago_escrow`): estado del pago de una solicitud.
  Campos clave: `external_reference`, `transaccion_mp_id`, `mp_preference_id`,
  `estado_pago`, `monto_total`, `comision_plataforma`, `fee_mp`,
  `monto_neto_profesional`, `expiracion_preferencia`.
- **`Payout`** (`payout`): pago al profesional. Único por `pago_id` y por
  `solicitud_id`.
- **`MovimientoPago`** (`movimiento_pago`): asientos del ledger.
- **`WebhookEvent`** (`webhook_event`): eventos recibidos de MP, con
  `mp_event_id` único para idempotencia.

Enums: `EstadoPago`, `EstadoPayout`, `MetodoPayout`, `TipoMovimientoPago`,
`CuentaLedger`.

---

## 4. Flujo completo

1. **Crear preferencia** (`POST /api/payments/preferences`): el servicio valida
   que la solicitud esté `ACEPTADO` o `EN_CURSO` y que el usuario sea el
   cliente. Si ya existe un pago `PENDIENTE` con preferencia vigente, la
   reutiliza; si expiró, la cancela y crea otra. Devuelve `init_point` /
   `sandbox_init_point`.
2. **Checkout**: el cliente paga en Mercado Pago (fuera de este backend).
3. **Webhook** (`POST /api/webhooks/mercadopago`): se valida la firma HMAC,
   se registra el `WebhookEvent` y se consulta el pago en la API de MP
   (`processPaymentWebhook`). Se valida moneda ARS, `collector_id`, montos y
   `external_reference`. Si está aprobado, el pago pasa a `RETENIDO` y se
   registran los movimientos del ledger.
4. **Confirmaciones**: cliente y profesional confirman la finalización
   (`POST /api/payments/solicitud/:id/confirm`). Al estar **ambas**, se libera
   automáticamente.
5. **Liberación** (`liberatePayment`): crea el `Payout`, registra el `PAYOUT`
   negativo en el ledger y deja el pago `LIBERADO` y la solicitud `FINALIZADO`.
   Condiciones: ambas confirmaciones, sin disputa abierta, sin payout previo y
   neto > 0.
6. **Payout**:
   - `PAYOUT_MODE=SIMULADO`: el payout nace `PAGADO` (referencia `SIM-…`).
   - `PAYOUT_MODE=MANUAL`: nace `PENDIENTE`; el admin transfiere por fuera y
     confirma con una referencia externa.
7. **Reembolso** (`POST /api/admin/payments/pagos/:pagoId/reembolsar`): solo
   admin, total, motivo mínimo de 5 caracteres.

---

## 5. Endpoints

### Cliente / profesional (JWT)

| Método | Ruta | Roles |
|---|---|---|
| `POST` | `/api/payments/preferences` | `CLIENTE` |
| `GET` | `/api/payments/solicitud/:solicitudId` | `CLIENTE`, `PROFESIONAL`, `ADMIN` |
| `POST` | `/api/payments/solicitud/:solicitudId/confirm` | `CLIENTE`, `PROFESIONAL` |

### Administración (JWT ADMIN)

| Método | Ruta | Body |
|---|---|---|
| `POST` | `/api/admin/payments/pagos/:pagoId/liberar` | `{ motivo?, override? }` |
| `POST` | `/api/admin/payments/pagos/:pagoId/reembolsar` | `{ motivo }` |
| `GET` | `/api/admin/payments/payouts` | query: `estado`, `profesional_id`, `solicitud_id`, `desde`, `hasta` |
| `POST` | `/api/admin/payments/payouts/:payoutId/confirmar` | `{ referencia }` |
| `POST` | `/api/admin/payments/payouts/:payoutId/reintentar` | — |

`override=true` permite al admin liberar sin las confirmaciones, pero exige
`motivo` de al menos 5 caracteres.

### Público

| Método | Ruta | Seguridad |
|---|---|---|
| `POST` | `/api/webhooks/mercadopago` | Firma HMAC (`x-signature`) |

---

## 6. Variables de entorno

```env
MP_ENV=sandbox                 # sandbox | production
MP_ACCESS_TOKEN=               # access token de la cuenta ExpertoYa
MP_PUBLIC_KEY=                 # public key (frontend)
MP_WEBHOOK_SECRET=             # secreto para validar x-signature
MP_COLLECTOR_ID=               # collector_id esperado (validación extra)
BACKEND_PUBLIC_URL=http://localhost:3000
APP_PUBLIC_URL=http://localhost:8081
COMISION_PORCENTAJE=10
PAYOUT_MODE=SIMULADO           # SIMULADO | MANUAL | MERCADO_PAGO
ALLOW_PAYMENT_SIMULATION=true
```

En producción `env.ts` exige `MP_WEBHOOK_SECRET`, `PAYOUT_MODE != SIMULADO` y
`ALLOW_PAYMENT_SIMULATION=false`.

---

## 7. Seguridad

- **Firma del webhook**: manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`
  firmado con HMAC-SHA256 y comparado con `timingSafeEqual`.
- Si `MP_WEBHOOK_SECRET` está vacío (solo desarrollo) se omite la validación y
  se registra un warning.
- **Nunca** se guardan datos de tarjeta: el checkout ocurre en Mercado Pago.
- El webhook responde 200 siempre que el evento sea auténtico, incluso si el
  procesamiento falla, para evitar reintentos infinitos. El error queda en
  `WebhookEvent.error` y lo recupera el script de reconciliación.

---

## 8. Idempotencia

| Nivel | Mecanismo |
|---|---|
| Webhook | `WebhookEvent.mp_event_id` único |
| Pago | Estados finales (`RETENIDO`, `LIBERADO`, `REEMBOLSADO`) cortan el reproceso |
| Payout | `pago_id` y `solicitud_id` únicos; `confirmManualPayout` es idempotente |
| Ledger | `MovimientoPago.referencia` única; `P2002` se ignora en reintentos |

---

## 9. Operación

```bash
# Verificación del flujo sin Mercado Pago
npm run payment:smoke

# Reconciliación (primero en seco)
npm run payment:reconcile:dry
npm run payment:reconcile
```

`reconcile-payments.ts`:

1. Reprocesa `WebhookEvent` con `procesado = false`.
2. Reconsulta en MP los `PagoEscrow` en `PENDIENTE` con `transaccion_mp_id`.
3. Devuelve exit code 1 si hubo fallos (apto para cron/CI).

---

## 10. Limitaciones del Trabajo Práctico

Quedan **fuera de alcance**:

- Split Payments, Marketplace y OAuth.
- Transferencias bancarias automáticas a profesionales.
- Facturación fiscal / integración con AFIP.
- Pagos recurrentes o suscripciones.
- Reembolsos parciales (solo totales).
- Multi-moneda (solo ARS).
- Liberación automática por tiempo: siempre se requieren confirmaciones
  explícitas.
- Envío de emails nuevos: se reutiliza el `EmailService` existente.
- Frontend: este repo solo expone la API.

Pendientes conocidos:

- **`MP_ACCESS_TOKEN` no configurado** en el `.env` actual: el flujo real
  contra Mercado Pago no puede ejecutarse todavía.
- **Disputas**: el modelo `Disputa` existe y bloquea confirmaciones/liberaciones
  si hay una `ABIERTA`, pero no hay endpoint para crearlas ni resolverlas.
- **Comprobante PDF**: el modelo guarda `comprobante_numero`, `comprobante_hash`
  y `comprobante_generado_en`, y la API expone `comprobante_disponible`, pero la
  generación del PDF no está implementada.
- **Tests automatizados**: `payment:smoke` es manual y requiere base de datos.

---

## 11. Incidente de sincronización de base (2026-11-04)

La base de Supabase había sido restaurada desde un dump anterior a la
implementación de pagos: faltaban `payout`, `movimiento_pago`, `webhook_event`,
los enums asociados y varias columnas, aunque `_prisma_migrations` figuraba al
día (drift).

Se reparó generando el SQL con `prisma migrate diff` y aplicándolo en **dos
fases** (`prisma db execute`), porque PostgreSQL no permite usar un valor de
enum recién agregado en la misma transacción:

```bash
head -n 26 /tmp/opencode/drift.sql > /tmp/opencode/drift_enums.sql
tail -n +27 /tmp/opencode/drift.sql > /tmp/opencode/drift_rest.sql
npx prisma db execute --url "$DIRECT_URL" --file /tmp/opencode/drift_enums.sql
npx prisma db execute --url "$DIRECT_URL" --file /tmp/opencode/drift_rest.sql
```

Verificación final: `prisma migrate diff` devuelve una migración vacía, es
decir, base y schema coinciden.

**Para evitar que se repita**: no restaurar dumps sin reaplicar migraciones
(`npx prisma migrate deploy`) y no usar `migrate reset` sobre bases con datos.
