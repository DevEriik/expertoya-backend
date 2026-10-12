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

    const whereFilter: any = {
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
      orderBy: status === "PENDIENTE"
        ? { usuario: { creado_en: "desc" } }
        : { fecha_validacion: "desc" },
    });

    res.status(200).json(profesionales);
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
      include: { usuario: true },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "El perfil no ha sido encontrado" });
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
        perfilExistente.usuario.nombre
      );
    }

    res.status(200).json({
      message: "Profesional aprobado con éxito",
      profesional: profesionalAprobado,
    });
  } catch (error) {
    console.error("Error al aprobar profesional:", error);
    res.status(500).json({ error: "Error interno al aprobar el perfil profesional" });
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
      include: { usuario: true },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "El perfil no ha sido encontrado" });
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
        motivoFinal
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

