# ExpertoYa Backend API

Servicio backend en Node.js, Express, TypeScript, Prisma y PostgreSQL (Supabase) para la plataforma transaccional de oficios **ExpertoYa**.

---

## 🛠️ Scripts de Prueba Disponibles

### Reseñas Closed-Loop (Tarea 17)
* `npm run review:smoke`
  * Ejecuta el Smoke Test automatizado de las 8 reglas Closed-Loop (validación de solicitud finalizada, pago liberado, transacción atómica, inmutabilidad y única réplica).
* `npm run review:seed`
  * Genera un escenario interactivo en la base de datos con un Cliente (`cliente.review@expertoya.com` / `123456`), un Profesional (`pro.review@expertoya.com` / `123456`) y una solicitud en estado `FINALIZADO` con pago `LIBERADO` lista para calificar desde la app móvil o web.

Para más detalles, consulta la [Guía de Pruebas de Reseñas](../../Tarea_17_Prueba_Sistema_Resenas_Closed_Loop.md).

---

### Pagos Escrow y Reconciliación
* `npm run payment:smoke`: Smoke test del flujo de pagos en custodia.
* `npm run payment:reconcile`: Reconciliación de pagos pendientes.
* `npm run payment:reconcile:dry`: Simulación en seco (dry-run) de la reconciliación.

---

## 🚀 Entorno de Desarrollo
```bash
npm install
npm run dev
```

