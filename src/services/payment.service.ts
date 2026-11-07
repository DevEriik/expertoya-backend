import {
  PrismaClient,
  SolicitudTrabajo,
  PagoEscrow,
  EstadoSolicitud,
  EstadoPago,
  TipoMovimientoPago,
  CuentaLedger,
  Profesional,
  Usuario,
  EstadoPayout, // Importar EstadoPayout para el tipo
  Disputa, // Importar Disputa para el tipo de canLiberate
  Payout, // Importar Payout para el tipo de canLiberate
  Prisma,
} from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  mercadoPagoService,
  PaymentResponse,
  PreferenceResponse,
  MercadoPagoService,
} from "./mercadopago.service"; // Importar MercadoPagoService
import { env } from "../config/env";
import {
  roundDecimal,
  toDecimal,
  compareDecimals,
  formatCurrency,
} from "../utils/money"; // Importar formatCurrency
import { generateLedgerReference } from "../utils/ledger";
import { addHours, isAfter } from "date-fns";
import {
  NotificacionService,
  notificacionService,
  NotificationData,
} from "./notification.service"; // Importar la clase y la instancia
import { EmailService, EmailOptions, emailService } from "./email.service"; // Importar la clase, interfaz y la instancia

interface CreatePreferenceResult {
  pago_id: string;
  preference_id: string;
  init_point: string;
  sandbox_init_point: string;
  monto_total: string;
  comision_plataforma: string;
  neto_estimado_profesional: string;
  moneda: string;
  expira_en: Date;
}

interface PaymentDetailsResult {
  solicitud_id: string;
  estado_solicitud: EstadoSolicitud;
  monto_acordado: string;
  pago: {
    id: string;
    estado: EstadoPago;
    monto_total: string;
    comision_plataforma: string;
    fee_mp: string;
    neto_profesional: string;
    mp_payment_id: string | null;
    mp_status: string | null;
    fecha_pago: Date;
    fecha_aprobacion: Date | null;
    fecha_liberacion: Date | null;
  } | null;
  confirmaciones: {
    cliente: boolean;
    profesional: boolean;
    cliente_en: Date | null;
    profesional_en: Date | null;
  };
  payout: {
    id: string;
    estado: EstadoPayout; // Usar EstadoPayout
    monto: string;
    metodo: string;
    pagado_en: Date | null;
  } | null;
  comprobante_disponible: boolean;
}

interface ConfirmCompletionResult {
  confirmado_cliente: boolean;
  confirmado_profesional: boolean;
  puede_liberar: boolean;
  liberado: boolean;
  estado_pago: EstadoPago;
}

export class PaymentService {
  constructor(
    private readonly prismaClient: PrismaClient,
    private readonly mpService: MercadoPagoService,
    private readonly notificationService: NotificacionService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Calcula la comisión de la plataforma y el monto neto estimado para el profesional.
   * @param montoTotal El monto total del servicio.
   * @returns Objeto con comisionPlataforma, comisionPorcentaje y montoNetoProfesional.
   */
  private calculateCommissions(montoTotal: Prisma.Decimal) {
    const comisionPorcentaje = toDecimal(env.COMISION_PORCENTAJE);
    const comisionPlataforma = roundDecimal(
      montoTotal.times(comisionPorcentaje).dividedBy(100),
    );
    const montoNetoProfesional = roundDecimal(
      montoTotal.minus(comisionPlataforma),
    ); // Sin fee de MP aún
    return { comisionPlataforma, comisionPorcentaje, montoNetoProfesional };
  }

  /**
   * Crea una preferencia de pago en Mercado Pago para una solicitud de trabajo.
   * @param solicitudId ID de la solicitud de trabajo.
   * @param clienteId ID del cliente.
   * @returns Objeto con los detalles de la preferencia de pago.
   */
  async createPaymentPreference(
    solicitudId: string,
    clienteId: string,
  ): Promise<CreatePreferenceResult> {
    const solicitud = await this.prismaClient.solicitudTrabajo.findUnique({
      where: { id: solicitudId },
      include: {
        cliente: true,
        servicio: {
          include: {
            profesional: {
              include: {
                usuario: true, // Incluir usuario
              },
            },
          },
        },
        pagos: true,
      },
    });

    if (!solicitud) {
      throw new Error("Solicitud de trabajo no encontrada.");
    }
    if (solicitud.cliente_id !== clienteId) {
      throw new Error(
        "No tienes permiso para crear una preferencia para esta solicitud.",
      );
    }
    if (
      ![EstadoSolicitud.ACEPTADO, EstadoSolicitud.EN_CURSO].includes(
        solicitud.estado_solicitud_trabajo as any,
      )
    ) {
      throw new Error(
        `La solicitud debe estar en estado ACEPTADO o EN_CURSO para crear una preferencia de pago. Estado actual: ${solicitud.estado_solicitud_trabajo}`,
      );
    }

    // Verificar pagos existentes
    const pagoActivo = solicitud.pagos.find(
      (p) =>
        p.estado_pago === EstadoPago.PENDIENTE ||
        p.estado_pago === EstadoPago.RETENIDO ||
        p.estado_pago === EstadoPago.EN_DISPUTA,
    );

    if (pagoActivo) {
      // Si hay un pago RETENIDO o EN_DISPUTA, no permitir nueva preferencia
      if (
        [EstadoPago.RETENIDO, EstadoPago.EN_DISPUTA].includes(
          pagoActivo.estado_pago as any,
        )
      ) {
        throw new Error(
          "Ya existe un pago aprobado o en disputa para esta solicitud.",
        );
      }
      // Si hay un pago PENDIENTE y la preferencia no ha expirado, devolver la misma
      if (
        pagoActivo.estado_pago === EstadoPago.PENDIENTE &&
        pagoActivo.mp_preference_id
      ) {
        const assumedExpiration = addHours(pagoActivo.creado_en, 24);
        if (
          pagoActivo.expiracion_preferencia &&
          isAfter(pagoActivo.expiracion_preferencia, new Date())
        ) {
          return {
            pago_id: pagoActivo.id,
            preference_id: pagoActivo.mp_preference_id,
            init_point: pagoActivo.init_point || "",
            sandbox_init_point: pagoActivo.sandbox_init_point || "",
            monto_total: pagoActivo.monto_total.toFixed(2),
            comision_plataforma: pagoActivo.comision_plataforma.toFixed(2),
            neto_estimado_profesional:
              pagoActivo.monto_neto_profesional.toFixed(2),
            moneda: pagoActivo.moneda,
            expira_en: pagoActivo.expiracion_preferencia,
          };
        } else if (
          !pagoActivo.expiracion_preferencia &&
          isAfter(assumedExpiration, new Date())
        ) {
          // Fallback si no tiene expiracion_preferencia
          return {
            pago_id: pagoActivo.id,
            preference_id: pagoActivo.mp_preference_id,
            init_point: pagoActivo.init_point || "",
            sandbox_init_point: pagoActivo.sandbox_init_point || "",
            monto_total: pagoActivo.monto_total.toFixed(2),
            comision_plataforma: pagoActivo.comision_plataforma.toFixed(2),
            neto_estimado_profesional:
              pagoActivo.monto_neto_profesional.toFixed(2),
            moneda: pagoActivo.moneda,
            expira_en: assumedExpiration,
          };
        } else {
          // Preferencia expirada, cancelar pago anterior
          await this.prismaClient.pagoEscrow.update({
            where: { id: pagoActivo.id },
            data: { estado_pago: EstadoPago.CANCELADO },
          });
        }
      }
    }

    // Determinar monto total
    let montoAcordado = solicitud.monto_acordado;
    if (!montoAcordado || compareDecimals(montoAcordado, toDecimal(0)) <= 0) {
      montoAcordado = solicitud.servicio.costo_estimado;
    }
    if (compareDecimals(montoAcordado, toDecimal(0)) <= 0) {
      throw new Error(
        "El monto acordado o costo estimado debe ser mayor a cero.",
      );
    }

    const { comisionPlataforma, comisionPorcentaje, montoNetoProfesional } =
      this.calculateCommissions(montoAcordado);

    // Crear registro de PagoEscrow PENDIENTE antes de llamar a MP
    const nuevoPago = await this.prismaClient.pagoEscrow.create({
      data: {
        solicitud_id: solicitud.id,
        monto_total: montoAcordado,
        comision_plataforma: comisionPlataforma,
        comision_porcentaje: comisionPorcentaje,
        monto_neto_profesional: montoNetoProfesional, // Neto estimado sin el fee de MP
        estado_pago: EstadoPago.PENDIENTE,
        moneda: "ARS", // hardcoded por requerimiento
        external_reference: solicitud.id + "-" + Date.now(), // Referencia única para MP
      },
    });

    try {
      const mpMetadata = {
        solicitud_id: solicitud.id,
        pago_id: nuevoPago.id,
        cliente_id: solicitud.cliente_id,
        profesional_id: solicitud.servicio.profesional.id, // Acceder al ID del profesional
      };

      const mpPreference: PreferenceResponse =
        await this.mpService.createPreference(
          nuevoPago.external_reference!, // external_reference no será null
          `Servicio ExpertoYa - ${solicitud.servicio.titulo_servicio}`,
          nuevoPago.monto_total,
          1,
          solicitud.cliente.email,
          solicitud.cliente.nombre,
          solicitud.cliente.apellido,
          mpMetadata,
        );

      // Actualizar el pago con los datos de la preferencia de MP
      const updatedPago = await this.prismaClient.pagoEscrow.update({
        where: { id: nuevoPago.id },
        data: {
          mp_preference_id: mpPreference.id,
          init_point: mpPreference.init_point,
          sandbox_init_point: mpPreference.sandbox_init_point,
          fecha_aprobacion: null, // Se seteará al aprobarse el pago
          fecha_liberacion: null,
          expiracion_preferencia: mpPreference.expiration_date_to
            ? new Date(mpPreference.expiration_date_to)
            : addHours(new Date(), 24), // Fallback
        },
      });

      // Si monto_acordado era null, persistirlo ahora
      if (!solicitud.monto_acordado) {
        await this.prismaClient.solicitudTrabajo.update({
          where: { id: solicitud.id },
          data: { monto_acordado: montoAcordado },
        });
      }

      return {
        pago_id: updatedPago.id,
        preference_id: updatedPago.mp_preference_id!,
        init_point: updatedPago.init_point!,
        sandbox_init_point: updatedPago.sandbox_init_point!,
        monto_total: updatedPago.monto_total.toFixed(2),
        comision_plataforma: updatedPago.comision_plataforma.toFixed(2),
        neto_estimado_profesional:
          updatedPago.monto_neto_profesional.toFixed(2),
        moneda: updatedPago.moneda,
        expira_en: updatedPago.expiracion_preferencia!,
      };
    } catch (error) {
      console.error(
        `Error al crear preferencia de MP para solicitud ${solicitudId}:`,
        error,
      );
      // Marcar el pago como FALLIDO si la llamada a MP falla
      await this.prismaClient.pagoEscrow.update({
        where: { id: nuevoPago.id },
        data: {
          estado_pago: EstadoPago.FALLIDO,
          metadata: {
            error: (error as Error).message,
          } as Prisma.InputJsonValue,
        }, // Casteo a Prisma.InputJsonValue
      });
      throw new Error(
        "No se pudo crear la preferencia de pago. Intenta de nuevo más tarde.",
      );
    }
  }

  /**
   * Procesa un evento de webhook de Mercado Pago para un pago.
   * @param mpPaymentId ID del pago de Mercado Pago.
   * @returns El pago de escrow actualizado.
   */
  async processPaymentWebhook(mpPaymentId: string): Promise<PagoEscrow> {
    const paymentDetails: PaymentResponse =
      await this.mpService.getPaymentDetails(mpPaymentId);

    if (paymentDetails.currency_id !== "ARS") {
      throw new Error(
        `Moneda inesperada: ${paymentDetails.currency_id}. Se esperaba ARS.`,
      );
    }
    if (!this.mpService.isCollectorIdValid(paymentDetails.collector_id)) {
      throw new Error(`Collector ID inválido: ${paymentDetails.collector_id}.`);
    }

    const externalReference = paymentDetails.external_reference;
    if (!externalReference) {
      throw new Error(
        `External reference no encontrado en los detalles del pago MP ${mpPaymentId}.`,
      );
    }

    const existingPago = await this.prismaClient.pagoEscrow.findUnique({
      where: { external_reference: externalReference },
      include: {
        solicitud: {
          include: {
            servicio: {
              include: {
                profesional: {
                  include: {
                    usuario: true, // Incluir usuario
                  },
                },
              },
            },
            cliente: true,
          },
        },
      },
    });

    if (!existingPago) {
      throw new Error(
        `PagoEscrow con external_reference ${externalReference} no encontrado en la base de datos.`,
      );
    }

    if (
      existingPago.estado_pago === EstadoPago.RETENIDO ||
      existingPago.estado_pago === EstadoPago.LIBERADO ||
      existingPago.estado_pago === EstadoPago.REEMBOLSADO
    ) {
      // Ya procesado, ignorar
      console.log(
        `Webhook para pago ${mpPaymentId} ya procesado (estado: ${existingPago.estado_pago}).`,
      );
      return existingPago;
    }

    let newEstadoPago: EstadoPago;
    let feeMp = toDecimal(0);
    const montoTotalMP = toDecimal(paymentDetails.transaction_amount);

    // Validar montos y moneda
    if (
      compareDecimals(
        existingPago.monto_total,
        montoTotalMP,
        toDecimal(0.01),
      ) !== 0
    ) {
      console.warn(
        `Inconsistencia de monto para external_reference ${externalReference}. BD: ${existingPago.monto_total}, MP: ${montoTotalMP}. Marcando para REVISION_MANUAL.`,
      );
      newEstadoPago = EstadoPago.REVISION_MANUAL;
    } else {
      switch (paymentDetails.status) {
        case "approved":
          newEstadoPago = EstadoPago.RETENIDO;
          // Calcular fee_mp
          if (
            paymentDetails.fee_details &&
            paymentDetails.fee_details.length > 0
          ) {
            feeMp = roundDecimal(
              paymentDetails.fee_details.reduce(
                (sum, fee) => toDecimal(sum).plus(fee.amount),
                toDecimal(0),
              ),
            );
          } else if (
            paymentDetails.transaction_details?.net_received_amount !==
            undefined
          ) {
            // Si no hay fee_details, calcularlo como la diferencia
            feeMp = roundDecimal(
              montoTotalMP.minus(
                toDecimal(
                  paymentDetails.transaction_details.net_received_amount,
                ),
              ),
            );
          }
          if (
            compareDecimals(feeMp, toDecimal(0)) < 0 ||
            compareDecimals(feeMp, montoTotalMP) > 0
          ) {
            console.warn(
              `Fee MP calculado inconsistente (${feeMp}) para pago ${mpPaymentId}. Marcando para REVISION_MANUAL.`,
            );
            newEstadoPago = EstadoPago.REVISION_MANUAL;
          }
          break;
        case "pending":
        case "in_process":
        case "authorized":
          newEstadoPago = EstadoPago.PENDIENTE;
          break;
        case "rejected":
        case "cancelled":
        case "expired":
          newEstadoPago = EstadoPago.FALLIDO;
          break;
        case "refunded":
          newEstadoPago = EstadoPago.REEMBOLSADO;
          break;
        case "charged_back":
          newEstadoPago = EstadoPago.CONTRACARGO;
          break;
        default:
          newEstadoPago = EstadoPago.REVISION_MANUAL;
          break;
      }
    }

    // Si el pago es aprobado y el estado era PENDIENTE, registrar movimientos
    if (
      newEstadoPago === EstadoPago.RETENIDO &&
      existingPago.estado_pago === EstadoPago.PENDIENTE
    ) {
      // Recalcular neto con el fee real de MP
      const montoNetoProfesional = roundDecimal(
        existingPago.monto_total
          .minus(existingPago.comision_plataforma)
          .minus(feeMp),
      );

      // Invariante de negocio: COBRO = COMISION + FEE_MP + NETO_PROFESIONAL
      // Si esto no se cumple, marcar REVISION_MANUAL
      const sumOfParts = existingPago.comision_plataforma
        .plus(feeMp)
        .plus(montoNetoProfesional);
      if (
        compareDecimals(
          existingPago.monto_total,
          sumOfParts,
          toDecimal(0.01),
        ) !== 0
      ) {
        console.error(
          `Invariante de negocio violado para pago ${existingPago.id}: COBRO (${existingPago.monto_total}) != COMISION (${existingPago.comision_plataforma}) + FEE_MP (${feeMp}) + NETO (${montoNetoProfesional}). Suma: ${sumOfParts}. Marcando REVISION_MANUAL.`,
        );
        newEstadoPago = EstadoPago.REVISION_MANUAL;
      }

      // Iniciar transacción para actualizar pago y crear movimientos
      const updatedPagoAndMovements = await this.prismaClient.$transaction(
        async (tx) => {
          const updatedPago = await tx.pagoEscrow.update({
            where: { id: existingPago.id },
            data: {
              transaccion_mp_id: mpPaymentId,
              mp_status: paymentDetails.status,
              mp_status_detail: paymentDetails.status_detail,
              mp_payment_method_id: paymentDetails.payment_method_id,
              mp_payment_type_id: paymentDetails.payment_type_id,
              fee_mp: feeMp,
              monto_neto_profesional: montoNetoProfesional,
              fecha_aprobacion: new Date(paymentDetails.date_approved),
              estado_pago: newEstadoPago,
            },
          });

          const movementsData = [
            {
              pago_id: updatedPago.id,
              solicitud_id: updatedPago.solicitud_id,
              tipo: TipoMovimientoPago.COBRO,
              cuenta: CuentaLedger.MERCADO_PAGO,
              monto: updatedPago.monto_total,
              moneda: updatedPago.moneda,
              referencia: generateLedgerReference(
                TipoMovimientoPago.COBRO,
                mpPaymentId,
              ),
              descripcion: "Cobro aprobado de Mercado Pago",
            },
            {
              pago_id: updatedPago.id,
              solicitud_id: updatedPago.solicitud_id,
              tipo: TipoMovimientoPago.COMISION,
              cuenta: CuentaLedger.PLATAFORMA,
              monto: updatedPago.comision_plataforma,
              moneda: updatedPago.moneda,
              referencia: generateLedgerReference(
                TipoMovimientoPago.COMISION,
                mpPaymentId,
              ),
              descripcion: `Comisión de plataforma (${updatedPago.comision_porcentaje.toFixed(2)}%)`,
            },
            {
              pago_id: updatedPago.id,
              solicitud_id: updatedPago.solicitud_id,
              tipo: TipoMovimientoPago.FEE_MP,
              cuenta: CuentaLedger.MERCADO_PAGO,
              monto: updatedPago.fee_mp,
              moneda: updatedPago.moneda,
              referencia: generateLedgerReference(
                TipoMovimientoPago.FEE_MP,
                mpPaymentId,
              ),
              descripcion: "Fee por transacción de Mercado Pago",
            },
            {
              pago_id: updatedPago.id,
              solicitud_id: updatedPago.solicitud_id,
              tipo: TipoMovimientoPago.NETO_PROFESIONAL,
              cuenta: CuentaLedger.PROFESIONAL,
              monto: updatedPago.monto_neto_profesional,
              moneda: updatedPago.moneda,
              referencia: generateLedgerReference(
                TipoMovimientoPago.NETO_PROFESIONAL,
                mpPaymentId,
              ),
              descripcion: "Monto neto para el profesional (retenido)",
            },
          ];

          // Usar createMany para insertar varios movimientos, pero sin skipDuplicates ya que se maneja la idempotencia con 'referencia'
          for (const data of movementsData) {
            try {
              await tx.movimientoPago.create({ data });
            } catch (error: any) {
              // Si ya existe la referencia única, ignorar (idempotencia)
              if (error.code === "P2002") {
                // P2002 es el código de error para violación de unique constraint
                console.warn(
                  `MovimientoPago con referencia ${data.referencia} ya existe. Ignorando duplicado.`,
                );
              } else {
                throw error; // Re-lanzar otros errores
              }
            }
          }

          // Actualizar estado de la solicitud a EN_CURSO si estaba en ACEPTADO o PENDIENTE
          if (
            existingPago.solicitud.estado_solicitud_trabajo ===
              EstadoSolicitud.ACEPTADO ||
            existingPago.solicitud.estado_solicitud_trabajo ===
              EstadoSolicitud.PENDIENTE
          ) {
            await tx.solicitudTrabajo.update({
              where: { id: existingPago.solicitud.id },
              data: { estado_solicitud_trabajo: EstadoSolicitud.EN_CURSO },
            });
          }

          return updatedPago;
        },
        {
          maxWait: 5000, // default: 2000
          timeout: 10000, // default: 5000
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // Para garantizar consistencia
        },
      );

      // Notificar al profesional sobre el pago retenido
      this.notificationService.sendPushNotification(
        existingPago.solicitud.servicio.profesional.id,
        "¡Pago retenido!",
        `El pago de la solicitud '${existingPago.solicitud.servicio.titulo_servicio}' ha sido aprobado y está retenido.`,
        {
          type: "payment",
          solicitudId: existingPago.solicitud_id,
          pagoId: existingPago.id,
        },
      );
      this.emailService.sendCustomEmail({
        to: existingPago.solicitud.servicio.profesional.usuario.email,
        subject: "¡Pago de solicitud aprobado y retenido! 🎉",
        html: `<p>Hola ${existingPago.solicitud.servicio.profesional.usuario.nombre},</p>
               <p>Te informamos que el cliente ha pagado por la solicitud de trabajo "<strong>${existingPago.solicitud.servicio.titulo_servicio}</strong>".</p>
               <p>El monto total de ${formatCurrency(existingPago.monto_total)} ha sido retenido en escrow. Una vez que tanto tú como el cliente confirmen la finalización del trabajo, el pago será liberado.</p>
               <p>Puedes ver los detalles de la solicitud y del pago en tu panel de ExpertoYa.</p>
               <p>¡Gracias por usar ExpertoYa!</p>`,
      });

      return updatedPagoAndMovements;
    } else {
      // Actualizar el estado si no fue aprobado o si ya estaba retenido
      const updatedPago = await this.prismaClient.pagoEscrow.update({
        where: { id: existingPago.id },
        data: {
          transaccion_mp_id: mpPaymentId,
          mp_status: paymentDetails.status,
          mp_status_detail: paymentDetails.status_detail,
          estado_pago: newEstadoPago,
          metadata: {
            ...((existingPago.metadata as object) || {}),
            mpRawStatus: paymentDetails.status,
          } as Prisma.InputJsonValue,
        },
      });
      return updatedPago;
    }
  }

  /**
   * Obtiene los detalles de un pago para una solicitud.
   * @param solicitudId ID de la solicitud.
   * @param userId ID del usuario que consulta (para validación de permisos).
   * @param userRole Rol del usuario.
   * @returns Detalles del pago y la solicitud.
   */
  async getPaymentDetails(
    solicitudId: string,
    userId: string,
    userRole: string,
  ): Promise<PaymentDetailsResult> {
    const solicitud = await this.prismaClient.solicitudTrabajo.findUnique({
      where: { id: solicitudId },
      include: {
        cliente: true,
        servicio: { include: { profesional: { include: { usuario: true } } } }, // Incluir usuario
        pagos: {
          orderBy: { creado_en: "desc" },
          take: 1, // Obtener el pago más reciente
          include: {
            payout: true,
            movimientos: true, // Incluir movimientos para propósitos de auditoría/debug
          },
        },
        disputas: {
          where: { estado: "ABIERTA" },
          take: 1,
        },
        payout: true, // Incluir el payout asociado a la solicitud (si existe)
      },
    });

    if (!solicitud) {
      throw new Error("Solicitud de trabajo no encontrada.");
    }

    const isClient = solicitud.cliente_id === userId;
    const isProfessional = solicitud.servicio.profesional.id === userId;
    const isAdmin = userRole === "ADMIN";

    if (!isClient && !isProfessional && !isAdmin) {
      throw new Error("No tienes permiso para ver los detalles de este pago.");
    }

    const ultimoPago = solicitud.pagos[0] || null;

    const comprobanteDisponible =
      ultimoPago?.estado_pago === EstadoPago.RETENIDO ||
      ultimoPago?.estado_pago === EstadoPago.LIBERADO ||
      ultimoPago?.estado_pago === EstadoPago.REEMBOLSADO;

    return {
      solicitud_id: solicitud.id,
      estado_solicitud: solicitud.estado_solicitud_trabajo,
      monto_acordado: solicitud.monto_acordado?.toFixed(2) || "0.00",
      pago: ultimoPago
        ? {
            id: ultimoPago.id,
            estado: ultimoPago.estado_pago,
            monto_total: ultimoPago.monto_total.toFixed(2),
            comision_plataforma: ultimoPago.comision_plataforma.toFixed(2),
            fee_mp: ultimoPago.fee_mp.toFixed(2),
            neto_profesional: ultimoPago.monto_neto_profesional.toFixed(2),
            mp_payment_id: ultimoPago.transaccion_mp_id,
            mp_status: ultimoPago.mp_status,
            fecha_pago: ultimoPago.fecha_pago,
            fecha_aprobacion: ultimoPago.fecha_aprobacion,
            fecha_liberacion: ultimoPago.fecha_liberacion,
          }
        : null,
      confirmaciones: {
        cliente: !!solicitud.confirmado_cliente_en,
        profesional: !!solicitud.confirmado_profesional_en,
        cliente_en: solicitud.confirmado_cliente_en,
        profesional_en: solicitud.confirmado_profesional_en,
      },
      payout: solicitud.payout // Acceder directamente a solicitud.payout
        ? {
            id: solicitud.payout.id,
            estado: solicitud.payout.estado,
            monto: solicitud.payout.monto.toFixed(2),
            metodo: solicitud.payout.metodo,
            pagado_en: solicitud.payout.pagado_en,
          }
        : null,
      comprobante_disponible: comprobanteDisponible,
    };
  }

  /**
   * Permite a un cliente o profesional confirmar la finalización de una solicitud.
   * @param solicitudId ID de la solicitud.
   * @param userId ID del usuario que confirma.
   * @returns Estado actualizado de las confirmaciones.
   */
  async confirmCompletion(
    solicitudId: string,
    userId: string,
  ): Promise<ConfirmCompletionResult> {
    const solicitud = await this.prismaClient.solicitudTrabajo.findUnique({
      where: { id: solicitudId },
      include: {
        cliente: true,
        servicio: {
          include: {
            profesional: {
              include: {
                usuario: true,
              },
            },
          },
        },
        pagos: {
          where: {
            estado_pago: {
              in: [
                EstadoPago.RETENIDO,
                EstadoPago.EN_DISPUTA,
                EstadoPago.REVISION_MANUAL,
              ], // Permitir confirmar si está en estos estados
            },
          },
          orderBy: { creado_en: "desc" },
          take: 1,
        },
        disputas: {
          where: { estado: "ABIERTA" },
          take: 1,
        },
        payout: true, // Para verificar si ya hay un payout
      },
    });

    if (!solicitud) {
      throw new Error("Solicitud de trabajo no encontrada.");
    }

    const isClient = solicitud.cliente_id === userId;
    const isProfessional = solicitud.servicio.profesional.id === userId;

    if (!isClient && !isProfessional) {
      throw new Error("No tienes permiso para confirmar esta solicitud.");
    }

    const pagoActivo = solicitud.pagos[0];
    if (
      !pagoActivo ||
      ![
        EstadoPago.RETENIDO,
        EstadoPago.EN_DISPUTA,
        EstadoPago.REVISION_MANUAL,
      ].includes(pagoActivo.estado_pago as any)
    ) {
      throw new Error(
        "El pago no está en un estado válido (RETENIDO, EN_DISPUTA, REVISION_MANUAL). No se puede confirmar.",
      );
    }
    if (solicitud.disputas.length > 0) {
      throw new Error(
        "Existe una disputa abierta para esta solicitud. No se puede confirmar.",
      );
    }
    if (solicitud.payout && solicitud.payout.estado !== EstadoPayout.FALLIDO) {
      throw new Error(
        "El pago ya ha sido liberado o está en proceso de payout.",
      );
    }

    let updatedSolicitud: SolicitudTrabajo;
    if (isClient && !solicitud.confirmado_cliente_en) {
      updatedSolicitud = await this.prismaClient.solicitudTrabajo.update({
        where: { id: solicitudId },
        data: { confirmado_cliente_en: new Date() },
      });
      console.log(
        `Cliente ${userId} confirmó finalización para solicitud ${solicitudId}`,
      );
      this.notificationService.sendPushNotification(
        solicitud.servicio.profesional.id,
        "Cliente ha confirmado!",
        `El cliente ha confirmado la finalización de la solicitud '${solicitud.servicio.titulo_servicio}'.`,
        { type: "confirmation", solicitudId: solicitud.id, role: "client" },
      );
    } else if (isProfessional && !solicitud.confirmado_profesional_en) {
      updatedSolicitud = await this.prismaClient.solicitudTrabajo.update({
        where: { id: solicitudId },
        data: { confirmado_profesional_en: new Date() },
      });
      console.log(
        `Profesional ${userId} confirmó finalización para solicitud ${solicitudId}`,
      );
      this.notificationService.sendPushNotification(
        solicitud.cliente_id,
        "Profesional ha confirmado!",
        `El profesional ha confirmado la finalización de la solicitud '${solicitud.servicio.titulo_servicio}'.`,
        {
          type: "confirmation",
          solicitudId: solicitud.id,
          role: "professional",
        },
      );
    } else {
      // Ya estaba confirmado por este usuario, devolver estado actual
      return {
        confirmado_cliente: !!solicitud.confirmado_cliente_en,
        confirmado_profesional: !!solicitud.confirmado_profesional_en,
        puede_liberar: this.canLiberate(solicitud, pagoActivo),
        liberado: false, // La liberación se hace en el mismo ciclo, si aplica
        estado_pago: pagoActivo.estado_pago,
      };
    }

    // Recargar solicitud para tener los últimos estados de confirmación
    const refreshedSolicitud =
      await this.prismaClient.solicitudTrabajo.findUnique({
        where: { id: solicitudId },
        include: {
          pagos: {
            where: { id: pagoActivo.id },
            take: 1,
          },
          disputas: {
            where: { estado: "ABIERTA" },
            take: 1,
          },
          payout: true,
          cliente: true,
          servicio: {
            include: { profesional: { include: { usuario: true } } },
          },
        },
      });

    if (!refreshedSolicitud || !refreshedSolicitud.pagos[0]) {
      throw new Error(
        "Error al recargar la solicitud después de la confirmación.",
      );
    }

    const canLiberate = this.canLiberate(
      refreshedSolicitud,
      refreshedSolicitud.pagos[0],
    );
    let liberado = false;
    let finalPagoEscrow = refreshedSolicitud.pagos[0];

    if (canLiberate) {
      finalPagoEscrow = await this.liberatePayment(
        refreshedSolicitud.id,
        refreshedSolicitud.pagos[0].id,
        refreshedSolicitud.servicio.profesional.id,
      );
      liberado = true;
      console.log(
        `Pago ${finalPagoEscrow.id} liberado automáticamente por confirmaciones.`,
      );
    }

    return {
      confirmado_cliente: !!refreshedSolicitud.confirmado_cliente_en,
      confirmado_profesional: !!refreshedSolicitud.confirmado_profesional_en,
      puede_liberar: canLiberate,
      liberado: liberado,
      estado_pago: finalPagoEscrow.estado_pago,
    };
  }

  /**
   * Verifica si un pago puede ser liberado.
   * @param solicitud La solicitud de trabajo.
   * @param pagoActivo El pago activo asociado.
   * @returns `true` si se puede liberar, `false` en caso contrario.
   */
  private canLiberate(
    solicitud: SolicitudTrabajo & {
      disputas: Disputa[];
      payout: Payout | null;
    }, // Extendemos el tipo
    pagoActivo: PagoEscrow,
  ): boolean {
    return (
      !!solicitud.confirmado_cliente_en &&
      !!solicitud.confirmado_profesional_en &&
      pagoActivo.estado_pago === EstadoPago.RETENIDO &&
      solicitud.disputas.filter((d) => d.estado === "ABIERTA").length === 0 &&
      !solicitud.payout && // No debe existir un payout previo
      compareDecimals(pagoActivo.monto_neto_profesional, toDecimal(0)) > 0
    );
  }

  /**
   * Libera un pago escrow y genera el payout.
   * @param solicitudId ID de la solicitud.
   * @param pagoId ID del pago.
   * @param profesionalId ID del profesional.
   * @param actorId ID del administrador que realiza la acción (opcional).
   * @param motivo Motivo de la liberación (obligatorio si es por admin).
   * @param override Indica si se ignoran las confirmaciones (solo admin).
   * @returns El pago escrow actualizado.
   */
  async liberatePayment(
    solicitudId: string,
    pagoId: string,
    profesionalId: string,
    actorId?: string,
    motivo?: string,
    override: boolean = false,
  ): Promise<PagoEscrow> {
    return this.prismaClient.$transaction(
      async (tx) => {
        const solicitud = await tx.solicitudTrabajo.findUnique({
          where: { id: solicitudId },
          include: {
            pagos: {
              where: { id: pagoId },
              take: 1,
            },
            disputas: {
              where: { estado: "ABIERTA" },
              take: 1,
            },
            payout: true,
            cliente: true,
            servicio: {
              include: { profesional: { include: { usuario: true } } },
            },
          },
        });

        if (!solicitud || !solicitud.pagos[0]) {
          throw new Error("Solicitud o pago no encontrado.");
        }
        const pagoActivo = solicitud.pagos[0];

        if (pagoActivo.estado_pago === EstadoPago.LIBERADO) {
          console.log(`Pago ${pagoId} ya estaba LIBERADO. Idempotencia.`);
          return pagoActivo; // Idempotente
        }

        if (solicitud.disputas.length > 0) {
          throw new Error(
            "No se puede liberar el pago: existe una disputa abierta.",
          );
        }
        if (
          solicitud.payout &&
          solicitud.payout.estado !== EstadoPayout.FALLIDO
        ) {
          // Usar EstadoPayout
          throw new Error(
            "Ya existe un payout asociado a este pago que no está FALLIDO.",
          );
        }
        if (
          compareDecimals(pagoActivo.monto_neto_profesional, toDecimal(0)) <= 0
        ) {
          throw new Error(
            "El monto neto para el profesional debe ser mayor a cero para liberar.",
          );
        }

        const canLiberateNormally = this.canLiberate(
          solicitud as SolicitudTrabajo & {
            disputas: Disputa[];
            payout: Payout | null;
          },
          pagoActivo,
        ); // Casteo

        if (!override && !canLiberateNormally) {
          throw new Error(
            "No se cumplen las condiciones para la liberación automática (confirmaciones, estado del pago, disputa).",
          );
        }
        if (override && (!actorId || !motivo || motivo.length < 5)) {
          throw new Error(
            "Se requiere actor y motivo de al menos 5 caracteres para liberación administrativa.",
          );
        }

        // 1. Crear Payout
        const payout = await tx.payout.create({
          data: {
            solicitud_id: solicitud.id,
            pago_id: pagoActivo.id,
            profesional_id: profesionalId,
            monto: pagoActivo.monto_neto_profesional,
            estado:
              env.PAYOUT_MODE === "SIMULADO"
                ? EstadoPayout.PAGADO
                : EstadoPayout.PENDIENTE, // Usar EstadoPayout
            metodo: env.PAYOUT_MODE,
            referencia:
              env.PAYOUT_MODE === "SIMULADO"
                ? `SIM-${solicitud.id}-${Date.now()}`
                : `PAYOUT-${solicitud.id}-${Date.now()}`,
          },
        });

        // 2. Registrar movimiento PAYOUT en el ledger
        await tx.movimientoPago.create({
          data: {
            pago_id: pagoActivo.id,
            solicitud_id: solicitud.id,
            tipo: TipoMovimientoPago.PAYOUT,
            cuenta: CuentaLedger.PROFESIONAL,
            monto: payout.monto.negated(), // Es una salida de la cuenta PROFESIONAL
            moneda: pagoActivo.moneda,
            referencia: generateLedgerReference(
              TipoMovimientoPago.PAYOUT,
              payout.id,
            ),
            descripcion: `Payout al profesional. Método: ${env.PAYOUT_MODE}`,
            metadata: actorId
              ? ({ actorId, motivo, override } as Prisma.InputJsonValue)
              : undefined,
          },
        });

        // 3. Actualizar PagoEscrow y SolicitudTrabajo
        const updatedPago = await tx.pagoEscrow.update({
          where: { id: pagoId },
          data: {
            estado_pago: EstadoPago.LIBERADO,
            fecha_liberacion: new Date(),
            payout: { connect: { id: payout.id } },
          },
        });

        const updatedSolicitud = await tx.solicitudTrabajo.update({
          where: { id: solicitudId },
          data: {
            estado_solicitud_trabajo: EstadoSolicitud.FINALIZADO,
            liberado_en: new Date(),
            payout: { connect: { id: payout.id } },
          },
        });

        // Notificar al cliente y profesional
        this.notificationService.sendPushNotification(
          solicitud.cliente_id,
          "¡Pago liberado!",
          `El pago por la solicitud '${solicitud.servicio.titulo_servicio}' ha sido liberado al profesional.`,
          {
            type: "payment_liberated",
            solicitudId: solicitud.id,
            pagoId: pagoActivo.id,
          },
        );
        this.emailService.sendCustomEmail({
          to: solicitud.cliente.email,
          subject: "¡Pago de solicitud liberado! ✅",
          html: `<p>Hola ${solicitud.cliente.nombre},</p>
                 <p>Confirmamos que el pago de <strong>${formatCurrency(pagoActivo.monto_total)}</strong> por la solicitud "<strong>${solicitud.servicio.titulo_servicio}</strong>" ha sido liberado exitosamente al profesional.</p>
                 <p>¡Esperamos que tu experiencia con ExpertoYa haya sido excelente!</p>`,
        });

        this.notificationService.sendPushNotification(
          solicitud.servicio.profesional.id,
          "¡Recibiste un pago!",
          `Se ha liberado el pago de la solicitud '${solicitud.servicio.titulo_servicio}'.`,
          {
            type: "payment_received",
            solicitudId: solicitud.id,
            pagoId: pagoActivo.id,
          },
        );
        this.emailService.sendCustomEmail({
          to: solicitud.servicio.profesional.usuario.email,
          subject: "¡Has recibido un pago! 💰",
          html: `<p>Hola ${solicitud.servicio.profesional.usuario.nombre},</p>
                 <p>Te confirmamos que el pago de <strong>${formatCurrency(pagoActivo.monto_neto_profesional)}</strong> por la solicitud "<strong>${solicitud.servicio.titulo_servicio}</strong>" ha sido liberado y ya está disponible según el método de payout configurado.</p>
                 <p>¡Felicidades por tu trabajo!</p>`,
        });

        return updatedPago;
      },
      {
        maxWait: 5000,
        timeout: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * Procesa un reembolso total de un pago.
   * Solo para uso administrativo.
   * @param pagoId ID del pago.
   * @param actorId ID del administrador que realiza la acción.
   * @param motivo Motivo del reembolso.
   * @returns El pago escrow actualizado.
   */
  async refundPayment(
    pagoId: string,
    actorId: string,
    motivo: string,
  ): Promise<PagoEscrow> {
    if (!motivo || motivo.length < 5) {
      throw new Error(
        "El motivo del reembolso es obligatorio y debe tener al menos 5 caracteres.",
      );
    }

    const pago = await this.prismaClient.pagoEscrow.findUnique({
      where: { id: pagoId },
      include: {
        solicitud: {
          include: {
            cliente: true,
            servicio: { include: { profesional: true } },
          },
        },
        payout: true,
      },
    });

    if (!pago) {
      throw new Error("Pago no encontrado.");
    }

    // Mover validaciones de estado para evitar warnings de TS
    if (pago.estado_pago === EstadoPago.REEMBOLSADO) {
      console.log(`Pago ${pagoId} ya estaba REEMBOLSADO. Idempotencia.`);
      return pago; // Idempotente
    }

    if (pago.estado_pago === EstadoPago.LIBERADO) {
      // Si ya está liberado, no reembolsar automáticamente
      await this.prismaClient.webhookEvent.create({
        data: {
          mp_event_id: `REFUND_FAIL_LIBERATED_${pagoId}_${Date.now()}`,
          tipo: "INTERNAL_ALERT",
          accion: "REFUND_ATTEMPT_LIBERATED",
          payload: { pagoId, actorId, motivo },
          error:
            "Intento de reembolso en pago ya liberado. Requiere acción manual.",
          procesado: false,
        },
      });
      throw new Error(
        "El pago ya ha sido LIBERADO. Se requiere un proceso de recuperación manual. Se ha registrado una alerta.",
      );
    }
    if (
      pago.estado_pago !== EstadoPago.RETENIDO &&
      pago.estado_pago !== EstadoPago.EN_DISPUTA &&
      pago.estado_pago !== EstadoPago.REVISION_MANUAL
    ) {
      throw new Error(
        `El pago debe estar en estado RETENIDO, EN_DISPUTA o REVISION_MANUAL para ser reembolsado. Estado actual: ${pago.estado_pago}`,
      );
    }
    if (!pago.transaccion_mp_id) {
      throw new Error(
        "El pago no tiene un ID de transacción de Mercado Pago para reembolsar.",
      );
    }

    const idempotencyKey = generateLedgerReference(
      TipoMovimientoPago.REEMBOLSO,
      pago.id,
    );

    try {
      const refundResponse = await this.mpService.refundPayment(
        pago.transaccion_mp_id,
        idempotencyKey,
      );

      if (
        refundResponse.status !== "approved" &&
        refundResponse.status !== "pending"
      ) {
        throw new Error(
          `Mercado Pago rechazó el reembolso: ${refundResponse.status}`,
        );
      }

      const updatedPago = await this.prismaClient.$transaction(async (tx) => {
        // Actualizar el pago a REEMBOLSADO
        const updated = await tx.pagoEscrow.update({
          where: { id: pagoId },
          data: {
            estado_pago: EstadoPago.REEMBOLSADO,
            fecha_reembolso: new Date(),
            mp_refund_id: refundResponse.id.toString(),
            metadata: {
              ...((pago.metadata as object) || {}),
              refundMotivo: motivo,
              actorIdRefund: actorId,
            } as Prisma.InputJsonValue,
          },
        });

        // Cancelar payout pendiente o procesando
        if (
          pago.payout &&
          [EstadoPayout.PENDIENTE, EstadoPayout.PROCESANDO].includes(
            pago.payout.estado as any,
          )
        ) {
          await tx.payout.update({
            where: { id: pago.payout.id },
            data: {
              estado: EstadoPayout.CANCELADO,
              error: "Reembolso iniciado por admin.",
            },
          });
        }

        // Registrar movimientos de ajuste/reembolso
        const refundAmount = toDecimal(
          refundResponse.amount || pago.monto_total,
        ); // Usar monto reembolsado por MP si disponible, sino el total
        const movementsData = [
          {
            pago_id: updated.id,
            solicitud_id: updated.solicitud_id,
            tipo: TipoMovimientoPago.REEMBOLSO,
            cuenta: CuentaLedger.MERCADO_PAGO,
            monto: refundAmount.negated(), // Salida de dinero de MP
            moneda: updated.moneda,
            referencia: generateLedgerReference(
              TipoMovimientoPago.REEMBOLSO,
              updated.id,
              "MP",
            ),
            descripcion: `Reembolso total al cliente por MP (ID: ${refundResponse.id})`,
            metadata: {
              actorId,
              motivo,
              mpRefundId: refundResponse.id,
            } as Prisma.InputJsonValue,
          },
          // Movimientos de ajuste para anular los cobros anteriores en el ledger interno
          {
            pago_id: updated.id,
            solicitud_id: updated.solicitud_id,
            tipo: TipoMovimientoPago.AJUSTE,
            cuenta: CuentaLedger.PLATAFORMA,
            monto: updated.comision_plataforma.negated(), // Devolver comisión a plataforma
            moneda: updated.moneda,
            referencia: generateLedgerReference(
              TipoMovimientoPago.AJUSTE,
              updated.id,
              "COMISION_REVERSAL",
            ),
            descripcion: "Reversión de comisión por reembolso",
            metadata: { actorId, motivo } as Prisma.InputJsonValue,
          },
          {
            pago_id: updated.id,
            solicitud_id: updated.solicitud_id,
            tipo: TipoMovimientoPago.AJUSTE,
            cuenta: CuentaLedger.PROFESIONAL,
            monto: updated.monto_neto_profesional.negated(), // Devolver neto a profesional (o eliminar saldo)
            moneda: updated.moneda,
            referencia: generateLedgerReference(
              TipoMovimientoPago.AJUSTE,
              updated.id,
              "NETO_REVERSAL",
            ),
            descripcion: "Reversión de neto profesional por reembolso",
            metadata: { actorId, motivo } as Prisma.InputJsonValue,
          },
        ];

        // Usar create para cada movimiento para la idempotencia controlada por la referencia única
        for (const data of movementsData) {
          try {
            await tx.movimientoPago.create({ data });
          } catch (error: any) {
            if (error.code === "P2002") {
              console.warn(
                `MovimientoPago con referencia ${data.referencia} ya existe. Ignorando duplicado en reembolso.`,
              );
            } else {
              throw error;
            }
          }
        }

        // Notificar al cliente sobre el reembolso
        this.notificationService.sendPushNotification(
          pago.solicitud.cliente_id,
          "¡Reembolso completado!",
          `Se ha reembolsado el pago de la solicitud '${pago.solicitud.servicio.titulo_servicio}'.`,
          {
            type: "payment_refunded",
            solicitudId: pago.solicitud_id,
            pagoId: pago.id,
          },
        );
        this.emailService.sendCustomEmail({
          to: pago.solicitud.cliente.email,
          subject: "¡Tu reembolso ha sido procesado! 💸",
          html: `<p>Hola ${pago.solicitud.cliente.nombre},</p>
                 <p>Confirmamos que el reembolso de <strong>${formatCurrency(refundAmount)}</strong> por la solicitud "<strong>${pago.solicitud.servicio.titulo_servicio}</strong>" ha sido procesado y se verá reflejado en tu cuenta según los tiempos de tu banco.</p>
                 <p>ID de reembolso de Mercado Pago: ${refundResponse.id}</p>
                 <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>`,
        });

        return updated;
      });
      return updatedPago;
    } catch (error) {
      console.error(
        `Error al procesar el reembolso del pago ${pagoId}:`,
        error,
      );
      throw new Error(
        `No se pudo procesar el reembolso: ${(error as Error).message}`,
      );
    }
  }
}

export const paymentService = new PaymentService(
  prisma,
  mercadoPagoService,
  notificacionService,
  emailService,
);
