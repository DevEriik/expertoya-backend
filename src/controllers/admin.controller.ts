import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

export const getPendingProfessionals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profesionalesPendientes = await prisma.profesional.findMany({
      where: { estado_validado: false },
      include: {
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
      orderBy: {
        usuario: { creado_en: "desc" },
      },
    });

    res.status(200).json(profesionalesPendientes);
  } catch (error) {
    console.error("Error al obtener profesionales pendientes:", error);
    res
      .status(500)
      .json({ error: "Error interno al obtener profesionales pendientes" });
  }
};

export const approveProfessional = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const idAdministrador = req.user?.userId;

    const perfilExistente = await prisma.profesional.findUnique({
      where: { id },
    });

    if (!perfilExistente) {
      res
        .status(404)
        .json({ error: "El perfil del profesional no ha sido encontrado" });
      return;
    }

    const profesionalAprobado = await prisma.profesional.update({
      where: { id: perfilExistente.id },
      data: {
        estado_validado: true,
        fecha_validacion: new Date(),
        validado_por: idAdministrador,
      },
    });

    res.status(200).json({
      message: "El perfil del profesional ha sido aprobado con éxito",
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

    const perfilExistente = await prisma.profesional.findUnique({
      where: { id },
    });

    if (!perfilExistente) {
      res
        .status(404)
        .json({ error: "El perfil del profesional no ha sido encontrado" });
      return;
    }

    const profesionalRechazado = await prisma.profesional.update({
      where: { id: perfilExistente.id },
      data: {
        estado_validado: false,
        fecha_validacion: new Date(),
        validado_por: idAdministrador,
      },
    });

    res.status(200).json({
      message: "El perfil del profesional ha sido rechazado",
      motivo: motivo || "Documentación no legible o inválida",
      profesional: profesionalRechazado,
    });
  } catch (error) {
    console.error("Error al rechazar profesional:", error);
    res.status(500).json({ error: "Error al rechazar el perfil profesional" });
  }
};
