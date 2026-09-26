import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

// 1. Listar todos los profesionales pendientes de validación
export const getPendingProfessionals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const pendientes = await prisma.profile.findMany({
      where: {
        estado_validado: false,
      },
      include: {
        user: {
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
        user: {
          creado_en: "desc",
        },
      },
    });

    res.status(200).json(pendientes);
  } catch (error) {
    console.error("Error al obtener profesionales pendientes:", error);
    res
      .status(500)
      .json({ error: "Error al obtener profesionales pendientes" });
  }
};

// 2. Aprobar el perfil de un profesional
export const approveProfessional = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params; // Puede ser el id del Profile o el userId
    const adminId = req.user?.userId;

    const perfilExistente = await prisma.profile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
      },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "Perfil profesional no encontrado" });
      return;
    }

    const profesionalAprobado = await prisma.profile.update({
      where: { id: perfilExistente.id },
      data: {
        estado_validado: true,
        fecha_validacion: new Date(),
        validado_por: adminId,
      },
    });

    res.status(200).json({
      message: "Profesional aprobado con éxito",
      profesional: profesionalAprobado,
    });
  } catch (error) {
    console.error("Error al aprobar profesional:", error);
    res.status(500).json({ error: "Error al aprobar el perfil profesional" });
  }
};

// 3. Rechazar el perfil de un profesional
export const rejectProfessional = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const adminId = req.user?.userId;

    const perfilExistente = await prisma.profile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
      },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "Perfil profesional no encontrado" });
      return;
    }

    const profesionalRechazado = await prisma.profile.update({
      where: { id: perfilExistente.id },
      data: {
        estado_validado: false,
        fecha_validacion: new Date(),
        validado_por: adminId,
      },
    });

    res.status(200).json({
      message: "Profesional rechazado",
      profesional: profesionalRechazado,
    });
  } catch (error) {
    console.error("Error al rechazar profesional:", error);
    res.status(500).json({ error: "Error al rechazar el perfil profesional" });
  }
};
