import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import emailService from "../services/email.service";
import {
  EstadoAuditoria,
  EstadoReporte,
  SancionAplicada,
  TipoMotivoReporte,
} from "@prisma/client";
import { getIO } from "../sockets/io";

export const getProfessionalsByStatus = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const statusQuery = (req.query.status as string) || "PENDIENTE";
    const status = statusQuery.toUpperCase() as EstadoAuditoria;

    const whereFilter: any =
      status === "PENDIENTE"
        ? {
          OR: [
            { estado_auditoria: "PENDIENTE" },
            {
              AND: [
                { estado_validado: true },
                {
                  motivo_rechazo: {
                    startsWith: "SOLICITUD_MATRICULA_PENDIENTE:",
                  },
                },
              ],
            },
          ],
        }
        : {
          estado_auditoria: status,
        };

    const profesionales = await prisma.profesional.findMany({
      where: whereFilter,
      include: {
        oficios: true,
        usuario: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            foto_perfil: true,
            creado_en: true,
          },
        },
      },
      orderBy:
        status === "PENDIENTE"
          ? { usuario: { creado_en: "desc" } }
          : { fecha_validacion: "desc" },
    });

    const allOficios = await prisma.oficio.findMany();

    const mapped = profesionales.map((prof) => {
      const esNuevaMatricula = Boolean(
        prof.estado_validado &&
        prof.motivo_rechazo?.startsWith("SOLICITUD_MATRICULA_PENDIENTE:"),
      );

      let oficiosPendientes: { id: number; nombre_oficio: string }[] = [];
      if (esNuevaMatricula && prof.motivo_rechazo) {
        const match = prof.motivo_rechazo.match(/ids=([0-9,]+)/);
        if (match && match[1]) {
          const ids = match[1]
            .split(",")
            .map((n) => Number(n.trim()))
            .filter((n) => !isNaN(n));
          oficiosPendientes = allOficios.filter((o) => ids.includes(o.id));
        }
      }

      return {
        ...prof,
        es_profesional_auditado_nueva_matricula: esNuevaMatricula,
        oficios_pendientes: oficiosPendientes,
      };
    });

    res.status(200).json(mapped);
  } catch (error) {
    console.error("Error al obtener profesionales por estado:", error);
    res.status(500).json({ error: "Error interno al obtener profesionales" });
  }
};

export const getPendingProfessionals = getProfessionalsByStatus;

export const approveProfessional = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const idAdministrador = req.user?.userId;

    const perfilExistente = await prisma.profesional.findUnique({
      where: { id },
      include: { usuario: true, oficios: true },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "El perfil no ha sido encontrado" });
      return;
    }

    const isMatriculaUpdate = Boolean(
      perfilExistente.estado_validado &&
      perfilExistente.motivo_rechazo?.startsWith(
        "SOLICITUD_MATRICULA_PENDIENTE:",
      ),
    );

    if (isMatriculaUpdate) {
      const match = perfilExistente.motivo_rechazo?.match(/ids=([0-9,]+)/);
      const pendingIds =
        match && match[1]
          ? match[1]
            .split(",")
            .map((n) => Number(n.trim()))
            .filter((n) => !isNaN(n))
          : [];

      const tradeConnect = pendingIds.map((tid) => ({ id: tid }));
      const allOficios = await prisma.oficio.findMany({
        where: { id: { in: pendingIds } },
      });
      const tradeNames = allOficios.map((o) => o.nombre_oficio);

      const profesionalActualizado = await prisma.profesional.update({
        where: { id: perfilExistente.id },
        data: {
          motivo_rechazo: null,
          fecha_validacion: new Date(),
          validado_por: idAdministrador,
          ...(tradeConnect.length > 0 && {
            oficios: { connect: tradeConnect },
          }),
        },
        include: { oficios: true },
      });

      if (perfilExistente.usuario.email) {
        await emailService.sendMatriculaApprovedEmail(
          perfilExistente.usuario.email,
          perfilExistente.usuario.nombre,
          tradeNames,
        );
      }

      res.status(200).json({
        message: "Matrícula aprobada y oficios habilitados con éxito",
        profesional: profesionalActualizado,
        es_nueva_matricula: true,
        oficios_habilitados: tradeNames,
      });
      return;
    }

    const updateData: any = {
      estado_auditoria: "APROBADO",
      estado_validado: true,
      motivo_rechazo: null,
      fecha_validacion: new Date(),
      validado_por: idAdministrador,
    };

    const profesionalAprobado = await prisma.profesional.update({
      where: { id: perfilExistente.id },
      data: updateData,
    });

    await prisma.usuario.update({
      where: { id: perfilExistente.usuario.id },
      data: { rol: "PROFESIONAL" },
    });

    if (perfilExistente.usuario.email) {
      await emailService.sendApprovalEmail(
        perfilExistente.usuario.email,
        perfilExistente.usuario.nombre,
      );
    }

    res.status(200).json({
      message: "Profesional aprobado con éxito",
      profesional: profesionalAprobado,
    });
  } catch (error) {
    console.error("Error al aprobar profesional:", error);
    res
      .status(500)
      .json({ error: "Error interno al aprobar el perfil profesional" });
  }
};

export const rejectProfessional = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const idAdministrador = req.user?.userId;
    const { motivo } = req.body;
    const motivoFinal = motivo || "Documentación no legible o incompleta";

    const perfilExistente = await prisma.profesional.findUnique({
      where: { id },
      include: { usuario: true, oficios: true },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "El perfil no ha sido encontrado" });
      return;
    }

    const isMatriculaUpdate = Boolean(
      perfilExistente.estado_validado &&
      perfilExistente.motivo_rechazo?.startsWith(
        "SOLICITUD_MATRICULA_PENDIENTE:",
      ),
    );

    if (isMatriculaUpdate) {
      const match = perfilExistente.motivo_rechazo?.match(/ids=([0-9,]+)/);
      const pendingIds =
        match && match[1]
          ? match[1]
            .split(",")
            .map((n) => Number(n.trim()))
            .filter((n) => !isNaN(n))
          : [];

      const allOficios = await prisma.oficio.findMany({
        where: { id: { in: pendingIds } },
      });
      const tradeNames = allOficios.map((o) => o.nombre_oficio);

      const profesionalActualizado = await prisma.profesional.update({
        where: { id: perfilExistente.id },
        data: {
          motivo_rechazo: null,
        },
        include: { oficios: true },
      });

      if (perfilExistente.usuario.email) {
        await emailService.sendMatriculaRejectedEmail(
          perfilExistente.usuario.email,
          perfilExistente.usuario.nombre,
          tradeNames,
          motivoFinal,
        );
      }

      res.status(200).json({
        message: "Matrícula rechazada y notificación enviada al profesional",
        motivo: motivoFinal,
        profesional: profesionalActualizado,
        es_nueva_matricula: true,
      });
      return;
    }

    const updateData: any = {
      estado_auditoria: "RECHAZADO",
      estado_validado: false,
      motivo_rechazo: motivoFinal,
      fecha_validacion: new Date(),
      validado_por: idAdministrador,
    };

    const profesionalRechazado = await prisma.profesional.update({
      where: { id: perfilExistente.id },
      data: updateData,
    });

    await prisma.usuario.update({
      where: { id: perfilExistente.usuario.id },
      data: { rol: "CLIENTE" },
    });

    if (perfilExistente.usuario.email) {
      await emailService.sendRejectionEmail(
        perfilExistente.usuario.email,
        perfilExistente.usuario.nombre,
        motivoFinal,
      );
    }

    res.status(200).json({
      message: "Profesional rechazado",
      motivo: motivoFinal,
      profesional: profesionalRechazado,
    });
  } catch (error) {
    console.error("Error al rechazar profesional:", error);
    res.status(500).json({ error: "Error al rechazar el perfil profesional" });
  }
};

/**
 * Listado paginado de denuncias y reportes con filtros por estado y tipología
 */
export const getReportesDenuncia = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const estadoQuery = req.query.estado as string;
    const tipoMotivoQuery = req.query.tipo_motivo as string;
    const search = req.query.search as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (estadoQuery) {
      const estadoUpper = estadoQuery.toUpperCase();
      if (estadoUpper === "RESUELTO") {
        where.estado = {
          in: [EstadoReporte.RESUELTO_CON_SANCION, EstadoReporte.DESESTIMADO],
        };
      } else if (Object.values(EstadoReporte).includes(estadoUpper as EstadoReporte)) {
        where.estado = estadoUpper as EstadoReporte;
      }
    }

    if (tipoMotivoQuery) {
      const motivoUpper = tipoMotivoQuery.toUpperCase();
      if (Object.values(TipoMotivoReporte).includes(motivoUpper as TipoMotivoReporte)) {
        where.tipo_motivo = motivoUpper as TipoMotivoReporte;
      }
    }

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { descripcion: { contains: term, mode: "insensitive" } },
        { denunciante: { nombre: { contains: term, mode: "insensitive" } } },
        { denunciante: { apellido: { contains: term, mode: "insensitive" } } },
        { denunciante: { email: { contains: term, mode: "insensitive" } } },
        { denunciado: { nombre: { contains: term, mode: "insensitive" } } },
        { denunciado: { apellido: { contains: term, mode: "insensitive" } } },
        { denunciado: { email: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [total, reportes] = await Promise.all([
      prisma.reporteDenuncia.count({ where }),
      prisma.reporteDenuncia.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creado_en: "desc" },
        include: {
          denunciante: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              telefono: true,
              rol: true,
              foto_perfil: true,
            },
          },
          denunciado: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              telefono: true,
              rol: true,
              foto_perfil: true,
              strikes: true,
              activo: true,
              suspendido_hasta: true,
            },
          },
          solicitud: {
            select: {
              id: true,
              estado_solicitud_trabajo: true,
              fecha_solicitada: true,
              servicio: {
                select: {
                  titulo_servicio: true,
                  oficio: { select: { nombre_oficio: true } },
                },
              },
            },
          },
          admin_revisor: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
      }),
    ]);

    res.json({
      reportes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    console.error("Error al obtener reportes de denuncia:", error.message);
    res.status(500).json({ error: "Error interno al obtener los reportes" });
  }
};

/**
 * Detalle completo de un reporte de denuncia, con chat asociado y bitácora de bloqueos
 */
export const getReporteDenunciaDetalle = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const reporte = await prisma.reporteDenuncia.findUnique({
      where: { id },
      include: {
        denunciante: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            rol: true,
            foto_perfil: true,
            creado_en: true,
          },
        },
        denunciado: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            rol: true,
            foto_perfil: true,
            creado_en: true,
            strikes: true,
            activo: true,
            suspendido_hasta: true,
            profesional: {
              select: {
                estado_validado: true,
                estado_auditoria: true,
                calificacion_promedio: true,
              },
            },
          },
        },
        solicitud: {
          include: {
            servicio: {
              include: {
                oficio: true,
              },
            },
          },
        },
        admin_revisor: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
          },
        },
      },
    });

    if (!reporte) {
      res.status(404).json({ error: "Reporte de denuncia no encontrado" });
      return;
    }

    let mensajesChat: any[] = [];
    let bloqueosRelacionados: any[] = [];

    if (reporte.solicitud_id) {
      mensajesChat = await prisma.mensajeChat.findMany({
        where: { solicitud_id: reporte.solicitud_id },
        orderBy: { enviado_en: "asc" },
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
      });

      bloqueosRelacionados = await prisma.bloqueoUsuario.findMany({
        where: { solicitud_id: reporte.solicitud_id },
        orderBy: { fecha_bloqueo: "desc" },
      });
    }

    const [reportesPreviosCount, bloqueosRecibidosCount] = await Promise.all([
      prisma.reporteDenuncia.count({
        where: {
          denunciado_id: reporte.denunciado_id,
          id: { not: reporte.id },
        },
      }),
      prisma.bloqueoUsuario.count({
        where: {
          bloqueado_id: reporte.denunciado_id,
          activo: true,
        },
      }),
    ]);

    res.json({
      reporte,
      mensajes: mensajesChat,
      bloqueos: bloqueosRelacionados,
      estadisticas_denunciado: {
        reportes_previos: reportesPreviosCount,
        bloqueos_recibidos: bloqueosRecibidosCount,
      },
    });
  } catch (error: any) {
    console.error("Error al obtener detalle del reporte:", error.message);
    res.status(500).json({ error: "Error interno al obtener detalle del reporte" });
  }
};

/**
 * Resuelve una denuncia aplicando la sanción administrativa elegida
 */
export const resolverReporteDenuncia = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const adminId = req.user?.userId;
    const { resolucion, sancion } = req.body;

    if (!resolucion || typeof resolucion !== "string" || !resolucion.trim()) {
      res.status(400).json({ error: "La resolución o dictamen administrativo es obligatorio" });
      return;
    }

    const sancionesValidas = Object.values(SancionAplicada);
    if (!sancion || !sancionesValidas.includes(sancion as SancionAplicada)) {
      res.status(400).json({
        error: "Sanción aplicada inválida",
        sanciones_validas: sancionesValidas,
      });
      return;
    }

    const reporte = await prisma.reporteDenuncia.findUnique({
      where: { id },
    });

    if (!reporte) {
      res.status(404).json({ error: "Reporte de denuncia no encontrado" });
      return;
    }

    const sancionTyped = sancion as SancionAplicada;
    const nuevoEstado: EstadoReporte =
      sancionTyped === SancionAplicada.NINGUNA
        ? EstadoReporte.DESESTIMADO
        : EstadoReporte.RESUELTO_CON_SANCION;

    const denunciadoId = reporte.denunciado_id;

    if (sancionTyped === SancionAplicada.ADVERTENCIA) {
      await prisma.usuario.update({
        where: { id: denunciadoId },
        data: {
          strikes: { increment: 1 },
        },
      });
    } else if (sancionTyped === SancionAplicada.SUSPENSION_TEMPORAL) {
      const diasSuspension = 7;
      const fechaFinSuspension = new Date();
      fechaFinSuspension.setDate(fechaFinSuspension.getDate() + diasSuspension);

      await prisma.usuario.update({
        where: { id: denunciadoId },
        data: {
          strikes: { increment: 1 },
          suspendido_hasta: fechaFinSuspension,
        },
      });

      await prisma.sesion.deleteMany({
        where: { usuario_id: denunciadoId },
      });
    } else if (sancionTyped === SancionAplicada.EXPULSION_DEFINITIVA) {
      await prisma.usuario.update({
        where: { id: denunciadoId },
        data: {
          activo: false,
          strikes: { increment: 1 },
        },
      });

      await prisma.profesional.updateMany({
        where: { id: denunciadoId },
        data: { disponible: false },
      });

      await prisma.sesion.deleteMany({
        where: { usuario_id: denunciadoId },
      });
    }

    const reporteActualizado = await prisma.reporteDenuncia.update({
      where: { id },
      data: {
        estado: nuevoEstado,
        sancion_aplicada: sancionTyped,
        resolucion_admin: resolucion.trim(),
        revisado_por: adminId,
      },
      include: {
        denunciante: {
          select: { id: true, nombre: true, apellido: true, email: true },
        },
        denunciado: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            strikes: true,
            activo: true,
            suspendido_hasta: true,
          },
        },
        admin_revisor: {
          select: { id: true, nombre: true, apellido: true, email: true },
        },
      },
    });

    const io = getIO();
    if (io) {
      const eventoResolucion = {
        reporte_id: id,
        estado: nuevoEstado,
        sancion: sancionTyped,
        resolucion: resolucion.trim(),
        denunciado_id: denunciadoId,
      };
      io.to("admins").emit("admin:reporte_resuelto", eventoResolucion);
      io.emit("admin:reporte_resuelto", eventoResolucion);

      if (
        sancionTyped === SancionAplicada.SUSPENSION_TEMPORAL ||
        sancionTyped === SancionAplicada.EXPULSION_DEFINITIVA
      ) {
        io.to(`usuario_${denunciadoId}`).emit("cuenta:sancionada", {
          sancion: sancionTyped,
          resolucion: resolucion.trim(),
        });
      }
    }

    res.json({
      ok: true,
      mensaje: "Denuncia resuelta y sanción procesada correctamente",
      reporte: reporteActualizado,
    });
  } catch (error: any) {
    console.error("Error al resolver reporte de denuncia:", error.message);
    res.status(500).json({ error: "Error interno al resolver la denuncia" });
  }
};

/**
 * Bitácora de todos los bloqueos bilaterales para auditar anomalías o usuarios con múltiples bloqueos
 */
export const getBitacoraBloqueos = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const usuarioId = req.query.usuario_id as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (usuarioId) {
      where.OR = [
        { bloqueador_id: usuarioId },
        { bloqueado_id: usuarioId },
      ];
    }

    const [total, bloqueos] = await Promise.all([
      prisma.bloqueoUsuario.count({ where }),
      prisma.bloqueoUsuario.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fecha_bloqueo: "desc" },
        include: {
          bloqueador: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              rol: true,
              foto_perfil: true,
            },
          },
          bloqueado: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              rol: true,
              foto_perfil: true,
              strikes: true,
              activo: true,
              suspendido_hasta: true,
            },
          },
          solicitud: {
            select: {
              id: true,
              estado_solicitud_trabajo: true,
              fecha_solicitada: true,
            },
          },
        },
      }),
    ]);

    const agrupadosReincidentes = await prisma.bloqueoUsuario.groupBy({
      by: ["bloqueado_id"],
      where: { activo: true },
      _count: { bloqueado_id: true },
      having: {
        bloqueado_id: {
          _count: { gte: 3 },
        },
      },
    });

    const idsReincidentes = agrupadosReincidentes.map((r: any) => r.bloqueado_id);
    const usuariosReincidentes = await prisma.usuario.findMany({
      where: { id: { in: idsReincidentes } },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        rol: true,
        foto_perfil: true,
        strikes: true,
        activo: true,
      },
    });

    const reincidentesConConteo = usuariosReincidentes.map((usr: any) => {
      const match = agrupadosReincidentes.find((r: any) => r.bloqueado_id === usr.id);
      return {
        ...usr,
        total_bloqueos_recibidos: match?._count.bloqueado_id || 0,
      };
    });

    res.json({
      bloqueos,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      reincidentes: reincidentesConConteo,
    });
  } catch (error: any) {
    console.error("Error al obtener bitácora de bloqueos:", error.message);
    res.status(500).json({ error: "Error interno al recuperar bitácora de bloqueos" });
  }
};


