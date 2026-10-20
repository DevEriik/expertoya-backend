import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import emailService from "../services/email.service";
import { EstadoAuditoria } from "@prisma/client";

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

