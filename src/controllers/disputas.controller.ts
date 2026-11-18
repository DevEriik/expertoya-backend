import { Response } from "express";
import { EstadoDisputa, EstadoPago, EstadoSolicitud } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import { getIO } from "../sockets/io";
import { finalizarLlamadaPorBloqueo } from "../sockets/chat.socket";
import { paymentService } from "../services/payment.service";
import { notificacionService } from "../services/notification.service";
import { emailService } from "../services/email.service";
import { formatCurrency, toDecimal } from "../utils/money";

export const disputasController = {
  /**
   * POST /api/disputas
   * El cliente inicia un reclamo ANTES de la confirmación final de pago.
   * Congela el PagoEscrow en EN_DISPUTA, pasa la solicitud a DISPUTA,
   * bloquea la comunicación y envía una notificación destacada al administrador.
   */
  abrirDisputa: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const clienteId = req.user?.userId;
      if (!clienteId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      const { solicitud_id, motivo, descripcion, evidencia_urls } =
        req.body ?? {};

      if (
        !solicitud_id ||
        !motivo ||
        typeof motivo !== "string" ||
        !motivo.trim()
      ) {
        res.status(400).json({
          error: "Los campos 'solicitud_id' y 'motivo' son obligatorios.",
        });
        return;
      }

      const solicitud = await prisma.solicitudTrabajo.findUnique({
        where: { id: solicitud_id },
        include: {
          cliente: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
          servicio: {
            include: {
              profesional: {
                include: {
                  usuario: {
                    select: {
                      id: true,
                      nombre: true,
                      apellido: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
          pagos: {
            orderBy: { creado_en: "desc" },
            take: 1,
          },
          disputas: {
            where: { estado: EstadoDisputa.ABIERTA },
          },
        },
      });

      if (!solicitud) {
        res.status(404).json({ error: "Solicitud de trabajo no encontrada." });
        return;
      }

      if (solicitud.cliente_id !== clienteId) {
        res.status(403).json({
          error:
            "Solo el cliente titular de la solicitud puede iniciar un reclamo.",
        });
        return;
      }

      if (solicitud.disputas.length > 0) {
        res.status(400).json({
          error: "Ya existe una disputa abierta para esta solicitud.",
        });
        return;
      }

      const pagoActivo = solicitud.pagos[0];
      if (!pagoActivo || pagoActivo.estado_pago !== EstadoPago.RETENIDO) {
        res.status(400).json({
          error:
            "Solo puedes iniciar un reclamo mientras el pago esté retenido en custodia y antes de la confirmación final.",
        });
        return;
      }

      if (solicitud.liberado_en) {
        res.status(400).json({
          error:
            "El pago ya fue liberado al profesional; no es posible iniciar un reclamo.",
        });
        return;
      }

      const profesionalId = solicitud.servicio.profesional.id;

      // Transacción atómica: crear ticket de disputa + congelar pago + pasar solicitud a DISPUTA
      const disputaCreada = await prisma.$transaction(async (tx) => {
        const disputa = await tx.disputa.create({
          data: {
            solicitud_id: solicitud.id,
            cliente_id: clienteId,
            profesional_id: profesionalId,
            pago_id: pagoActivo.id,
            motivo: motivo.trim(),
            descripcion:
              typeof descripcion === "string" && descripcion.trim()
                ? descripcion.trim()
                : null,
            evidencia_urls: Array.isArray(evidencia_urls)
              ? evidencia_urls
              : undefined,
            estado: EstadoDisputa.ABIERTA,
            monto_retenido: pagoActivo.monto_total,
          },
        });

        await tx.pagoEscrow.update({
          where: { id: pagoActivo.id },
          data: { estado_pago: EstadoPago.EN_DISPUTA },
        });

        await tx.solicitudTrabajo.update({
          where: { id: solicitud.id },
          data: { estado_solicitud_trabajo: EstadoSolicitud.DISPUTA },
        });

        return disputa;
      });

      // Cortar videollamada activa y bloquear el chat en tiempo real
      await finalizarLlamadaPorBloqueo(
        solicitud.id,
        "Llamada finalizada: Se abrió una disputa en esta solicitud",
      );

      const io = getIO();
      io?.to(`solicitud_${solicitud.id}`).emit("chat_bloqueado", {
        solicitud_id: solicitud.id,
        motivo: `Disputa abierta: ${motivo.trim()}`,
        estado_solicitud: "DISPUTA",
      });

      // Notificación destacada al administrador principal (Socket + Push + Email)
      const admins = await prisma.usuario.findMany({
        where: { rol: "ADMIN", activo: true },
        select: { id: true, email: true, nombre: true },
      });

      const alertaAdmin = {
        tipo: "NUEVA_DISPUTA",
        disputa_id: disputaCreada.id,
        solicitud_id: solicitud.id,
        servicio: solicitud.servicio.titulo_servicio,
        monto_retenido: pagoActivo.monto_total.toFixed(2),
        motivo: disputaCreada.motivo,
        cliente: `${solicitud.cliente.nombre} ${solicitud.cliente.apellido}`,
        profesional: `${solicitud.servicio.profesional.usuario.nombre} ${solicitud.servicio.profesional.usuario.apellido}`,
        abierta_en: disputaCreada.abierta_en,
      };

      io?.to("admins").emit("admin:nueva_disputa", alertaAdmin);

      for (const admin of admins) {
        notificacionService
          .sendPushNotification(
            admin.id,
            "⚠️ Nueva Disputa Abierta",
            `Reclamo por ${formatCurrency(pagoActivo.monto_total)} en "${solicitud.servicio.titulo_servicio}". Fondos congelados.`,
            {
              type: "NUEVA_DISPUTA",
              disputaId: disputaCreada.id,
              solicitudId: solicitud.id,
              critica: true,
            } as any,
          )
          .catch(() => {});

        emailService
          .sendCustomEmail({
            to: admin.email,
            subject: `⚠️ [URGENTE] Nueva Disputa #${disputaCreada.id.slice(0, 8)} - ExpertoYa`,
            html: `<h2>Nuevo ticket de disputa abierto</h2>
                   <p>Hola ${admin.nombre}, un cliente inició un reclamo y los fondos quedaron congelados para auditoría:</p>
                   <ul>
                     <li><strong>Servicio:</strong> ${solicitud.servicio.titulo_servicio}</li>
                     <li><strong>Monto retenido:</strong> ${formatCurrency(pagoActivo.monto_total)}</li>
                     <li><strong>Cliente:</strong> ${solicitud.cliente.nombre} ${solicitud.cliente.apellido} (${solicitud.cliente.email})</li>
                     <li><strong>Profesional:</strong> ${solicitud.servicio.profesional.usuario.nombre} ${solicitud.servicio.profesional.usuario.apellido}</li>
                     <li><strong>Motivo:</strong> ${disputaCreada.motivo}</li>
                     <li><strong>Detalle:</strong> ${disputaCreada.descripcion || "Sin detalle adicional"}</li>
                   </ul>
                   <p>Ingresa al Panel de Administración Web para leer el historial del chat y emitir una resolución.</p>`,
          })
          .catch(() => {});
      }

      // Notificar al profesional
      notificacionService
        .sendPushNotification(
          profesionalId,
          "⚖️ Reclamo abierto por el cliente",
          `El cliente inició una disputa en "${solicitud.servicio.titulo_servicio}". Un moderador revisará el caso.`,
          {
            type: "DISPUTA_ABIERTA",
            disputaId: disputaCreada.id,
            solicitudId: solicitud.id,
          } as any,
        )
        .catch(() => {});

      res.status(201).json({
        ok: true,
        mensaje:
          "Reclamo iniciado. La transacción fue congelada para revisión de soporte.",
        disputa: disputaCreada,
      });
    } catch (error: any) {
      console.error("[disputasController] abrirDisputa:", error.message);
      res.status(500).json({ error: "Error interno al iniciar el reclamo." });
    }
  },

  /**
   * GET /api/disputas/solicitud/:solicitudId
   * Consulta la disputa asociada a una solicitud (cliente, profesional o admin).
   */
  obtenerDisputaPorSolicitud: async (
    req: AuthRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const rol = req.user?.rol;
      const { solicitudId } = req.params;

      const solicitud = await prisma.solicitudTrabajo.findUnique({
        where: { id: solicitudId },
        include: {
          servicio: { select: { profesional_id: true } },
          disputas: { orderBy: { abierta_en: "desc" }, take: 1 },
        },
      });

      if (!solicitud) {
        res.status(404).json({ error: "Solicitud no encontrada." });
        return;
      }

      const autorizado =
        rol === "ADMIN" ||
        solicitud.cliente_id === userId ||
        solicitud.servicio.profesional_id === userId;

      if (!autorizado) {
        res.status(403).json({ error: "No autorizado." });
        return;
      }

      res.json({ ok: true, disputa: solicitud.disputas[0] || null });
    } catch (error: any) {
      console.error(
        "[disputasController] obtenerDisputaPorSolicitud:",
        error.message,
      );
      res.status(500).json({ error: "Error al consultar la disputa." });
    }
  },

  /**
   * GET /api/disputas/admin/todas
   * Lista todas las disputas en el backoffice admin (priorizando las ABIERTAS).
   */
  listarDisputasAdmin: async (
    req: AuthRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const { estado } = req.query;

      const where: any = {};
      if (typeof estado === "string" && estado) {
        if (!Object.values(EstadoDisputa).includes(estado as EstadoDisputa)) {
          res.status(400).json({ error: "Filtro de estado inválido." });
          return;
        }
        where.estado = estado as EstadoDisputa;
      }

      const disputas = await prisma.disputa.findMany({
        where,
        include: {
          cliente: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              foto_perfil: true,
            },
          },
          profesional: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              foto_perfil: true,
              strikes: true,
              suspendido_hasta: true,
            },
          },
          solicitud: {
            select: {
              id: true,
              estado_solicitud_trabajo: true,
              monto_acordado: true,
              fecha_solicitada: true,
              servicio: {
                select: {
                  id: true,
                  titulo_servicio: true,
                },
              },
              pagos: {
                orderBy: { creado_en: "desc" },
                take: 1,
                select: {
                  id: true,
                  estado_pago: true,
                  monto_total: true,
                  monto_neto_profesional: true,
                  comision_plataforma: true,
                  transaccion_mp_id: true,
                },
              },
            },
          },
        },
        orderBy: [{ abierta_en: "desc" }],
      });

      // Priorizar las disputas ABIERTAS arriba del listado
      disputas.sort((a, b) => {
        if (
          a.estado === EstadoDisputa.ABIERTA &&
          b.estado !== EstadoDisputa.ABIERTA
        )
          return -1;
        if (
          a.estado !== EstadoDisputa.ABIERTA &&
          b.estado === EstadoDisputa.ABIERTA
        )
          return 1;
        return 0;
      });

      res.json({ ok: true, disputas });
    } catch (error: any) {
      console.error("[disputasController] listarDisputasAdmin:", error.message);
      res.status(500).json({ error: "Error al listar las disputas." });
    }
  },

  /**
   * GET /api/disputas/admin/:disputaId/chat
   * Acceso de SOLO LECTURA al historial completo del chat privado para el moderador.
   */
  obtenerHistorialChatDisputa: async (
    req: AuthRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const { disputaId } = req.params;

      const disputa = await prisma.disputa.findUnique({
        where: { id: disputaId },
        include: {
          cliente: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              foto_perfil: true,
            },
          },
          profesional: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              foto_perfil: true,
            },
          },
          solicitud: {
            select: {
              id: true,
              descripcion: true,
              monto_acordado: true,
              fecha_solicitada: true,
              servicio: { select: { titulo_servicio: true } },
            },
          },
        },
      });

      if (!disputa) {
        res.status(404).json({ error: "Disputa no encontrada." });
        return;
      }

      const mensajes = await prisma.mensajeChat.findMany({
        where: { solicitud_id: disputa.solicitud_id },
        include: {
          remitente: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              rol: true,
              foto_perfil: true,
            },
          },
        },
        orderBy: { enviado_en: "asc" },
      });

      res.json({
        ok: true,
        solo_lectura: true,
        disputa,
        mensajes,
      });
    } catch (error: any) {
      console.error(
        "[disputasController] obtenerHistorialChatDisputa:",
        error.message,
      );
      res
        .status(500)
        .json({ error: "Error al obtener el historial del chat." });
    }
  },

  /**
   * POST /api/disputas/admin/:disputaId/resolver
   * Resolución final del moderador:
   * - REEMBOLSO_TOTAL: devuelve 100% al cliente
   * - REEMBOLSO_PARCIAL: devuelve monto_reembolso al cliente
   * - FAVOR_PROFESIONAL: descongela y libera el pago al profesional
   * Opcionalmente aplica suspensión temporal al trabajador por mala fe.
   */
  resolverDisputaAdmin: async (
    req: AuthRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const adminId = req.user?.userId;
      if (!adminId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      const { disputaId } = req.params;
      const { decision, monto_reembolso, resolucion_admin, dias_suspension } =
        req.body ?? {};

      if (
        !decision ||
        !["REEMBOLSO_TOTAL", "REEMBOLSO_PARCIAL", "FAVOR_PROFESIONAL"].includes(
          decision,
        )
      ) {
        res.status(400).json({
          error:
            "La decisión es obligatoria: 'REEMBOLSO_TOTAL', 'REEMBOLSO_PARCIAL' o 'FAVOR_PROFESIONAL'.",
        });
        return;
      }

      if (
        !resolucion_admin ||
        typeof resolucion_admin !== "string" ||
        resolucion_admin.trim().length < 5
      ) {
        res.status(400).json({
          error:
            "La justificación de la resolución ('resolucion_admin') es obligatoria (mínimo 5 caracteres).",
        });
        return;
      }

      const disputa = await prisma.disputa.findUnique({
        where: { id: disputaId },
        include: {
          solicitud: {
            include: {
              servicio: {
                include: { profesional: { include: { usuario: true } } },
              },
              pagos: {
                where: {
                  estado_pago: {
                    in: [EstadoPago.EN_DISPUTA, EstadoPago.RETENIDO],
                  },
                },
                orderBy: { creado_en: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      if (!disputa) {
        res.status(404).json({ error: "Disputa no encontrada." });
        return;
      }

      if (disputa.estado !== EstadoDisputa.ABIERTA) {
        res.status(400).json({ error: "Esta disputa ya fue resuelta." });
        return;
      }

      const pagoActivo = disputa.solicitud.pagos[0];
      if (!pagoActivo) {
        res.status(400).json({
          error:
            "No se encontró un pago retenido o en disputa asociado a esta solicitud.",
        });
        return;
      }

      const profesionalId = disputa.solicitud.servicio.profesional.id;
      let nuevoEstadoDisputa: EstadoDisputa;
      let montoReembolsadoFinal = toDecimal(0);

      // 1. Ejecutar movimiento financiero en Mercado Pago / Ledger
      if (decision === "REEMBOLSO_TOTAL") {
        await paymentService.refundPayment(
          pagoActivo.id,
          adminId,
          `Disputa #${disputa.id}: ${resolucion_admin.trim()}`,
        );
        nuevoEstadoDisputa = EstadoDisputa.RESUELTA_CLIENTE;
        montoReembolsadoFinal = pagoActivo.monto_total;
      } else if (decision === "REEMBOLSO_PARCIAL") {
        const montoNum = Number(monto_reembolso);
        if (
          isNaN(montoNum) ||
          montoNum <= 0 ||
          montoNum >= pagoActivo.monto_total.toNumber()
        ) {
          res.status(400).json({
            error: `Para reembolso parcial, 'monto_reembolso' debe ser mayor a 0 y menor a ${pagoActivo.monto_total.toFixed(2)}.`,
          });
          return;
        }
        await paymentService.refundPayment(
          pagoActivo.id,
          adminId,
          `Disputa #${disputa.id} (Parcial): ${resolucion_admin.trim()}`,
          montoNum,
        );
        nuevoEstadoDisputa = EstadoDisputa.RESUELTA_REEMBOLSO_PARCIAL;
        montoReembolsadoFinal = toDecimal(montoNum);
      } else {
        // FAVOR_PROFESIONAL: cerrar disputa primero para habilitar liberatePayment
        await prisma.disputa.update({
          where: { id: disputa.id },
          data: {
            estado: EstadoDisputa.RESUELTA_PROFESIONAL,
            resolucion_admin: resolucion_admin.trim(),
            resuelto_por: adminId,
            resuelta_en: new Date(),
          },
        });

        await prisma.pagoEscrow.update({
          where: { id: pagoActivo.id },
          data: { estado_pago: EstadoPago.RETENIDO },
        });

        await paymentService.liberatePayment(
          disputa.solicitud_id,
          pagoActivo.id,
          profesionalId,
          adminId,
          `Disputa #${disputa.id} resuelta a favor del profesional: ${resolucion_admin.trim()}`,
          true,
        );
        nuevoEstadoDisputa = EstadoDisputa.RESUELTA_PROFESIONAL;
      }

      // 2. Actualizar registro final de Disputa y estado de SolicitudTrabajo
      const disputaResuelta = await prisma.disputa.update({
        where: { id: disputa.id },
        data: {
          estado: nuevoEstadoDisputa,
          resolucion_admin: resolucion_admin.trim(),
          monto_reembolsado: montoReembolsadoFinal,
          resuelto_por: adminId,
          resuelta_en: new Date(),
        },
      });

      if (decision !== "FAVOR_PROFESIONAL") {
        await prisma.solicitudTrabajo.update({
          where: { id: disputa.solicitud_id },
          data: { estado_solicitud_trabajo: EstadoSolicitud.CANCELADO },
        });
      }

      // 3. Aplicar suspensión temporal al profesional si se demuestra mala fe
      let suspendidoHasta: Date | null = null;
      const dias = Number(dias_suspension || 0);
      if (dias > 0) {
        suspendidoHasta = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
        await prisma.$transaction([
          prisma.usuario.update({
            where: { id: profesionalId },
            data: {
              suspendido_hasta: suspendidoHasta,
              strikes: { increment: 1 },
            },
          }),
          prisma.servicioPublicado.updateMany({
            where: { profesional_id: profesionalId },
            data: { servicio_activo: false },
          }),
        ]);

        emailService
          .sendCustomEmail({
            to: disputa.solicitud.servicio.profesional.usuario.email,
            subject: "⚠️ Suspensión temporal de cuenta - ExpertoYa",
            html: `<p>Hola ${disputa.solicitud.servicio.profesional.usuario.nombre},</p>
                   <p>Tras auditar la disputa #${disputa.id.slice(0, 8)}, el equipo de moderación determinó incumplimiento/mala fe y aplicó una <strong>suspensión temporal de ${dias} día(s)</strong> (hasta el ${suspendidoHasta.toLocaleDateString("es-AR")}).</p>
                   <p><strong>Motivo:</strong> ${resolucion_admin.trim()}</p>`,
          })
          .catch(() => {});
      }

      res.json({
        ok: true,
        mensaje: "Disputa resuelta exitosamente.",
        disputa: disputaResuelta,
        suspension_aplicada: suspendidoHasta
          ? { dias, suspendido_hasta: suspendidoHasta }
          : null,
      });
    } catch (error: any) {
      console.error(
        "[disputasController] resolverDisputaAdmin:",
        error.message,
      );
      res.status(400).json({
        error: error.message || "Error al resolver la disputa.",
      });
    }
  },
};
