import {
  PrismaClient,
  Payout,
  EstadoPayout,
  MetodoPayout,
  TipoMovimientoPago,
  CuentaLedger,
  Prisma,
} from "@prisma/client";
import { prisma } from "../config/prisma";
import { generateLedgerReference } from "../utils/ledger";
import {
  NotificacionService,
  notificacionService,
  NotificationData,
} from "./notification.service";
import { EmailService, emailService } from "./email.service";
import { formatCurrency, toDecimal } from "../utils/money";

export class PayoutService {
  constructor(
    private readonly prismaClient: PrismaClient,
    private readonly notificationService: NotificacionService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Confirma un payout manual.
   */
  async confirmManualPayout(
    payoutId: string,
    actorId: string,
    referencia: string,
  ): Promise<Payout> {
    const payout = await this.prismaClient.payout.findUnique({
      where: { id: payoutId },
      include: {
        pago: {
          include: {
            solicitud: {
              include: {
                servicio: {
                  include: {
                    profesional: {
                      include: {
                        usuario: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payout) {
      throw new Error("Payout no encontrado.");
    }
    if (payout.metodo !== MetodoPayout.MANUAL) {
      throw new Error(
        `Este payout no es de método MANUAL, es ${payout.metodo}.`,
      );
    }
    if (payout.estado === EstadoPayout.PAGADO) {
      console.log(`Payout ${payoutId} ya estaba PAGADO. Idempotencia.`);
      return payout;
    }
    if (payout.estado !== EstadoPayout.PENDIENTE) {
      throw new Error(
        `El payout debe estar en estado PENDIENTE para ser confirmado. Estado actual: ${payout.estado}`,
      );
    }

    const updatedPayoutResult = await this.prismaClient.$transaction(async (tx) => {
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: {
          estado: EstadoPayout.PAGADO,
          referencia: referencia,
          pagado_en: new Date(),
        },
        include: {
          pago: true,
        },
      });

      try {
        await tx.movimientoPago.create({
          data: {
            pago_id: updated.pago_id,
            solicitud_id: updated.solicitud_id,
            tipo: TipoMovimientoPago.AJUSTE,
            cuenta: CuentaLedger.PROFESIONAL,
            monto: toDecimal(0),
            moneda: updated.pago?.moneda || "ARS",
            referencia: generateLedgerReference(
              TipoMovimientoPago.AJUSTE,
              updated.id,
              "MANUAL_CONFIRM",
            ),
            descripcion: `Confirmación manual de payout por admin (Ref: ${referencia})`,
            metadata: {
              actorId,
              metodo: MetodoPayout.MANUAL,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (error: any) {
        if (error.code === "P2002") {
          console.warn(
            `MovimientoPago con referencia ya existe en confirmación manual. Ignorando duplicado.`,
          );
        } else {
          throw error;
        }
      }

      return updated;
    });

    const updatedPayoutWithRelation = await this.prismaClient.payout.findUnique({
      where: { id: updatedPayoutResult.id },
      include: {
        pago: {
          include: {
            solicitud: {
              include: {
                servicio: {
                  include: {
                    profesional: {
                      include: {
                        usuario: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (updatedPayoutWithRelation?.pago?.solicitud?.servicio?.profesional?.usuario) {
      this.notificationService.sendPushNotification(
        updatedPayoutResult.profesional_id,
        "¡Payout confirmado!",
        `El payout de ${formatCurrency(updatedPayoutResult.monto)} para la solicitud '${
          updatedPayoutWithRelation.pago.solicitud.servicio.titulo_servicio
        }' ha sido confirmado.`,
        { type: "payout_confirmed", payoutId: updatedPayoutResult.id },
      );
      this.emailService.sendCustomEmail({
        to: updatedPayoutWithRelation.pago.solicitud.servicio.profesional.usuario.email,
        subject: "¡Tu payout ha sido confirmado! ✅",
        html: `<p>Hola ${updatedPayoutWithRelation.pago.solicitud.servicio.profesional.usuario.nombre},</p>
               <p>Confirmamos que el payout de <strong>${formatCurrency(
                 updatedPayoutResult.monto,
               )}</strong> por la solicitud "<strong>${
                 updatedPayoutWithRelation.pago.solicitud.servicio.titulo_servicio
               }</strong>" ha sido procesado y confirmado manualmente.</p>
               <p>Referencia: ${referencia}</p>
               <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>`,
      });
    }

    return updatedPayoutResult;
  }

  /**
   * Intenta reintentar un payout fallido.
   */
  async retryPayout(payoutId: string, actorId: string): Promise<Payout> {
    const payout = await this.prismaClient.payout.findUnique({
      where: { id: payoutId },
      include: {
        pago: {
          include: {
            solicitud: {
              include: {
                servicio: {
                  include: {
                    profesional: {
                      include: {
                        usuario: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payout) {
      throw new Error("Payout no encontrado.");
    }
    if (payout.estado !== EstadoPayout.FALLIDO) {
      throw new Error(
        `El payout no está en estado FALLIDO. Estado actual: ${payout.estado}`,
      );
    }

    let newEstado: EstadoPayout;
    if (payout.metodo === MetodoPayout.SIMULADO) {
      newEstado = EstadoPayout.PAGADO;
    } else if (payout.metodo === MetodoPayout.MERCADO_PAGO) {
      throw new Error(
        "Payout con Mercado Pago no implementado para reintentos automáticos.",
      );
    } else {
      newEstado = EstadoPayout.PENDIENTE;
    }

    const updatedPayout = await this.prismaClient.$transaction(async (tx) => {
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: {
          estado: newEstado,
          error: null,
          pagado_en: newEstado === EstadoPayout.PAGADO ? new Date() : null,
          referencia:
            newEstado === EstadoPayout.PAGADO &&
            payout.metodo === MetodoPayout.SIMULADO
              ? `SIM-RETRY-${payout.id}-${Date.now()}`
              : payout.referencia,
        },
        include: {
          pago: true,
        },
      });

      try {
        await tx.movimientoPago.create({
          data: {
            pago_id: updated.pago_id,
            solicitud_id: updated.solicitud_id,
            tipo: TipoMovimientoPago.AJUSTE,
            cuenta: CuentaLedger.PLATAFORMA,
            monto: toDecimal(0),
            moneda: updated.pago?.moneda || "ARS",
            referencia: generateLedgerReference(
              TipoMovimientoPago.AJUSTE,
              updated.id,
              "RETRY",
            ),
            descripcion: `Reintento de payout. Nuevo estado: ${newEstado}`,
            metadata: { actorId } as Prisma.InputJsonValue,
          },
        });
      } catch (error: any) {
        if (error.code === "P2002") {
          console.warn(
            `MovimientoPago con referencia ya existe en reintento de payout. Ignorando duplicado.`,
          );
        } else {
          throw error;
        }
      }
      return updated;
    });

    const updatedPayoutWithRelation = await this.prismaClient.payout.findUnique({
      where: { id: updatedPayout.id },
      include: {
        pago: {
          include: {
            solicitud: {
              include: {
                servicio: {
                  include: {
                    profesional: {
                      include: {
                        usuario: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (
      newEstado === EstadoPayout.PAGADO &&
      updatedPayoutWithRelation?.pago?.solicitud?.servicio?.profesional?.usuario
    ) {
      this.notificationService.sendPushNotification(
        updatedPayout.profesional_id,
        "¡Payout reintentado y pagado!",
        `El payout de ${formatCurrency(updatedPayout.monto)} para la solicitud '${
          updatedPayoutWithRelation.pago.solicitud.servicio.titulo_servicio
        }' ha sido reintentado y marcado como pagado.`,
        { type: "payout_retried_paid", payoutId: updatedPayout.id },
      );
      this.emailService.sendCustomEmail({
        to: updatedPayoutWithRelation.pago.solicitud.servicio.profesional.usuario.email,
        subject: "¡Tu payout ha sido reintentado y pagado! ✅",
        html: `<p>Hola ${updatedPayoutWithRelation.pago.solicitud.servicio.profesional.usuario.nombre},</p>
               <p>Te confirmamos que el payout de <strong>${formatCurrency(
                 updatedPayout.monto,
               )}</strong> por la solicitud "<strong>${
                 updatedPayoutWithRelation.pago.solicitud.servicio.titulo_servicio
               }</strong>" ha sido reintentado y marcado como pagado. Ref: ${updatedPayout.referencia}.</p>
               <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>`,
      });
    } else if (
      newEstado === EstadoPayout.PENDIENTE &&
      updatedPayoutWithRelation?.pago?.solicitud?.servicio?.profesional?.usuario
    ) {
      this.notificationService.sendPushNotification(
        updatedPayout.profesional_id,
        "¡Payout reintentado!",
        `El payout de ${formatCurrency(updatedPayout.monto)} para la solicitud '${
          updatedPayoutWithRelation.pago.solicitud.servicio.titulo_servicio
        }' ha sido reintentado y está nuevamente pendiente de procesamiento.`,
        { type: "payout_retried_pending", payoutId: updatedPayout.id },
      );
      this.emailService.sendCustomEmail({
        to: updatedPayoutWithRelation.pago.solicitud.servicio.profesional.usuario.email,
        subject: "¡Tu payout ha sido reintentado! 🔄",
        html: `<p>Hola ${updatedPayoutWithRelation.pago.solicitud.servicio.profesional.usuario.nombre},</p>
               <p>Te confirmamos que el payout de <strong>${formatCurrency(
                 updatedPayout.monto,
               )}</strong> por la solicitud "<strong>${
                 updatedPayoutWithRelation.pago.solicitud.servicio.titulo_servicio
               }</strong>" ha sido reintentado y está nuevamente pendiente de procesamiento.</p>
               <p>Te mantendremos informado.</p>`,
      });
    }

    return updatedPayout;
  }

  async getPayouts(filters: {
    estado?: EstadoPayout;
    profesional_id?: string;
    solicitud_id?: string;
    desde?: Date;
    hasta?: Date;
  }): Promise<Payout[]> {
    const where: Prisma.PayoutWhereInput = {};
    if (filters.estado) where.estado = filters.estado;
    if (filters.profesional_id) where.profesional_id = filters.profesional_id;
    if (filters.solicitud_id) where.solicitud_id = filters.solicitud_id;

    if (filters.desde || filters.hasta) {
      where.creado_en = {};
      if (filters.desde) where.creado_en.gte = filters.desde;
      if (filters.hasta) where.creado_en.lte = filters.hasta;
    }

    return this.prismaClient.payout.findMany({
      where,
      include: {
        profesional: {
          select: {
            id: true,
            usuario: { select: { nombre: true, apellido: true, email: true } },
          },
        },
        pago: {
          select: {
            id: true,
            monto_total: true,
            estado_pago: true,
            solicitud_id: true,
          },
        },
        solicitud: {
          select: {
            id: true,
            servicio: { select: { titulo_servicio: true } },
            cliente: { select: { nombre: true, apellido: true } },
          },
        },
      },
      orderBy: { creado_en: "desc" },
    });
  }
}

export const payoutService = new PayoutService(
  prisma,
  notificacionService,
  emailService,
);
