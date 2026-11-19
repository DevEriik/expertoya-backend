/*
  Warnings:

  - You are about to drop the column `userId` on the `profesional` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[token_dispositivo]` on the table `token_dispositivo` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'EN_CURSO', 'FINALIZADO', 'DISPUTA', 'CANCELADO', 'CANCELADO_AUTO');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'RETENIDO', 'LIBERADO', 'REEMBOLSADO', 'FALLIDO', 'CANCELADO', 'EN_DISPUTA', 'CONTRACARGO', 'REVISION_MANUAL');

-- CreateEnum
CREATE TYPE "EstadoPayout" AS ENUM ('PENDIENTE', 'PROCESANDO', 'PAGADO', 'FALLIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "MetodoPayout" AS ENUM ('SIMULADO', 'MANUAL', 'MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "TipoMovimientoPago" AS ENUM ('COBRO', 'COMISION', 'FEE_MP', 'NETO_PROFESIONAL', 'PAYOUT', 'REEMBOLSO', 'CONTRACARGO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "CuentaLedger" AS ENUM ('MERCADO_PAGO', 'PLATAFORMA', 'PROFESIONAL');

-- CreateEnum
CREATE TYPE "EstadoDisputa" AS ENUM ('ABIERTA', 'RESUELTA_CLIENTE', 'RESUELTA_PROFESIONAL');

-- CreateEnum
CREATE TYPE "EstadoAuditoria" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- DropForeignKey
ALTER TABLE "profesional" DROP CONSTRAINT "profesional_userId_fkey";

-- DropIndex
DROP INDEX "profesional_userId_key";

-- AlterTable
ALTER TABLE "profesional" DROP COLUMN "userId",
ADD COLUMN     "alias_cbu" TEXT,
ADD COLUMN     "antecedentes_penales" TEXT,
ADD COLUMN     "banco" TEXT,
ADD COLUMN     "cbu" TEXT,
ADD COLUMN     "certificado_no_deudor" TEXT,
ADD COLUMN     "constancia_afip" TEXT,
ADD COLUMN     "cuit" TEXT,
ADD COLUMN     "disponible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dni_dorso" TEXT,
ADD COLUMN     "dni_frente" TEXT,
ADD COLUMN     "estado_auditoria" "EstadoAuditoria" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "latitud" DOUBLE PRECISION,
ADD COLUMN     "longitud" DOUBLE PRECISION,
ADD COLUMN     "motivo_rechazo" TEXT,
ADD COLUMN     "selfie_biometrica" TEXT,
ADD COLUMN     "titular_cuenta" TEXT,
ADD COLUMN     "ubicacion_geografica" TEXT;

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "fecha_nacimiento" TIMESTAMP(3),
ADD COLUMN     "sonido_activo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "disponibilidad_profesional" (
    "id" TEXT NOT NULL,
    "profesional_id" TEXT NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "hora_inicio" TIME NOT NULL,
    "hora_fin" TIME NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disponibilidad_profesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oficio" (
    "id" SERIAL NOT NULL,
    "nombre_oficio" TEXT NOT NULL,
    "descripcion_oficio" TEXT,

    CONSTRAINT "oficio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicio_publicado" (
    "id" TEXT NOT NULL,
    "profesional_id" TEXT NOT NULL,
    "oficio_id" INTEGER NOT NULL,
    "titulo_servicio" TEXT NOT NULL,
    "descripcion_servicio" TEXT NOT NULL,
    "costo_estimado" DECIMAL(10,2) NOT NULL,
    "duracion_estimada" TEXT NOT NULL,
    "fotos_servicio" JSONB,
    "servicio_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "servicio_publicado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_diagnostico_ia" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "input_cliente" TEXT NOT NULL,
    "oficio_sugerido" TEXT,
    "fecha_consulta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_diagnostico_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_trabajo" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "fecha_solicitada" TIMESTAMP(3) NOT NULL,
    "monto_acordado" DECIMAL(12,2),
    "confirmado_cliente_en" TIMESTAMP(3),
    "confirmado_profesional_en" TIMESTAMP(3),
    "liberado_en" TIMESTAMP(3),
    "estado_solicitud_trabajo" "EstadoSolicitud" NOT NULL DEFAULT 'PENDIENTE',
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitud_trabajo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago_escrow" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "transaccion_mp_id" TEXT,
    "external_reference" TEXT,
    "mp_preference_id" TEXT,
    "mp_status" TEXT,
    "mp_status_detail" TEXT,
    "mp_payment_method_id" TEXT,
    "mp_payment_type_id" TEXT,
    "mp_merchant_order_id" TEXT,
    "monto_total" DECIMAL(12,2) NOT NULL,
    "comision_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "comision_plataforma" DECIMAL(12,2) NOT NULL,
    "fee_mp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_neto_profesional" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "estado_pago" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
    "init_point" TEXT,
    "sandbox_init_point" TEXT,
    "fecha_pago" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_aprobacion" TIMESTAMP(3),
    "fecha_liberacion" TIMESTAMP(3),
    "fecha_reembolso" TIMESTAMP(3),
    "mp_refund_id" TEXT,
    "comprobante_numero" TEXT,
    "comprobante_hash" TEXT,
    "comprobante_generado_en" TIMESTAMP(3),
    "metadata" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "expiracion_preferencia" TIMESTAMP(3),

    CONSTRAINT "pago_escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "pago_id" TEXT NOT NULL,
    "profesional_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoPayout" NOT NULL DEFAULT 'PENDIENTE',
    "metodo" "MetodoPayout" NOT NULL DEFAULT 'SIMULADO',
    "referencia" TEXT,
    "comprobante_url" TEXT,
    "error" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagado_en" TIMESTAMP(3),

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_pago" (
    "id" TEXT NOT NULL,
    "pago_id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "tipo" "TipoMovimientoPago" NOT NULL,
    "cuenta" "CuentaLedger" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "referencia" TEXT NOT NULL,
    "descripcion" TEXT,
    "metadata" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "mp_event_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "accion" TEXT,
    "payload" JSONB,
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMP(3),

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesion_videollamada" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "proveedor_id" TEXT,
    "hora_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hora_fin" TIMESTAMP(3),
    "duracion_segundos" INTEGER,

    CONSTRAINT "sesion_videollamada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resenia" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "profesional_id" TEXT NOT NULL,
    "calificacion" INTEGER NOT NULL,
    "comentario" TEXT,
    "respuesta_profesional" TEXT,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resenia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje_chat" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "remitente_id" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "adjunto_url" TEXT,
    "enviado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leido" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mensaje_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputa" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" "EstadoDisputa" NOT NULL DEFAULT 'ABIERTA',
    "resolucion_admin" TEXT,
    "abierta_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "data" JSONB,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "critica" BOOLEAN NOT NULL DEFAULT false,
    "intentos_reenvio" INTEGER NOT NULL DEFAULT 0,
    "ultimo_envio_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProfesionalOficios" (
    "A" INTEGER NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProfesionalOficios_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "pago_escrow_transaccion_mp_id_key" ON "pago_escrow"("transaccion_mp_id");

-- CreateIndex
CREATE UNIQUE INDEX "pago_escrow_external_reference_key" ON "pago_escrow"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "pago_escrow_mp_preference_id_key" ON "pago_escrow"("mp_preference_id");

-- CreateIndex
CREATE UNIQUE INDEX "pago_escrow_comprobante_numero_key" ON "pago_escrow"("comprobante_numero");

-- CreateIndex
CREATE INDEX "pago_escrow_solicitud_id_idx" ON "pago_escrow"("solicitud_id");

-- CreateIndex
CREATE INDEX "pago_escrow_estado_pago_idx" ON "pago_escrow"("estado_pago");

-- CreateIndex
CREATE UNIQUE INDEX "payout_solicitud_id_key" ON "payout"("solicitud_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_pago_id_key" ON "payout"("pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_referencia_key" ON "payout"("referencia");

-- CreateIndex
CREATE INDEX "payout_profesional_id_estado_idx" ON "payout"("profesional_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_pago_referencia_key" ON "movimiento_pago"("referencia");

-- CreateIndex
CREATE INDEX "movimiento_pago_pago_id_creado_en_idx" ON "movimiento_pago"("pago_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_mp_event_id_key" ON "webhook_event"("mp_event_id");

-- CreateIndex
CREATE INDEX "notificacion_usuario_id_leida_idx" ON "notificacion"("usuario_id", "leida");

-- CreateIndex
CREATE INDEX "notificacion_critica_leida_ultimo_envio_at_idx" ON "notificacion"("critica", "leida", "ultimo_envio_at");

-- CreateIndex
CREATE INDEX "_ProfesionalOficios_B_index" ON "_ProfesionalOficios"("B");

-- CreateIndex
CREATE UNIQUE INDEX "token_dispositivo_token_dispositivo_key" ON "token_dispositivo"("token_dispositivo");

-- AddForeignKey
ALTER TABLE "profesional" ADD CONSTRAINT "profesional_id_fkey" FOREIGN KEY ("id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidad_profesional" ADD CONSTRAINT "disponibilidad_profesional_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_publicado" ADD CONSTRAINT "servicio_publicado_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_publicado" ADD CONSTRAINT "servicio_publicado_oficio_id_fkey" FOREIGN KEY ("oficio_id") REFERENCES "oficio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_diagnostico_ia" ADD CONSTRAINT "historial_diagnostico_ia_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_trabajo" ADD CONSTRAINT "solicitud_trabajo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_trabajo" ADD CONSTRAINT "solicitud_trabajo_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio_publicado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_escrow" ADD CONSTRAINT "pago_escrow_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago_escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_pago" ADD CONSTRAINT "movimiento_pago_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago_escrow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_pago" ADD CONSTRAINT "movimiento_pago_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesion_videollamada" ADD CONSTRAINT "sesion_videollamada_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenia" ADD CONSTRAINT "resenia_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenia" ADD CONSTRAINT "resenia_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenia" ADD CONSTRAINT "resenia_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_chat" ADD CONSTRAINT "mensaje_chat_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_chat" ADD CONSTRAINT "mensaje_chat_remitente_id_fkey" FOREIGN KEY ("remitente_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputa" ADD CONSTRAINT "disputa_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProfesionalOficios" ADD CONSTRAINT "_ProfesionalOficios_A_fkey" FOREIGN KEY ("A") REFERENCES "oficio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProfesionalOficios" ADD CONSTRAINT "_ProfesionalOficios_B_fkey" FOREIGN KEY ("B") REFERENCES "profesional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
