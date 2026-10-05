import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

// Listar todos los profesionales pendientes de validación
export const getPendingProfessionals = async (
    req: AuthRequest,
    res: Response,
): Promise<void> => {
    try {
        const profesionalesPendientes = await prisma.profile.findMany({
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

    res.status(200).json(profesionalesPendientes);
    } catch (error) {
        console.error("Error al obtener profesionales pendientes:", error);
        res
        .status(500)
        .json({ error: "Error interno al obtener profesionales pendientes" });
    }
};

// Aprobar el perfil de un profesional
export const approveProfessional = async (
    req: AuthRequest,
    res: Response,
): Promise<void> => {
    try {
        const { id } = req.params; // Puede ser el id del Profile o el userId
        const idAdministrador = req.user?.userId;

        const perfilExistente = await prisma.profile.findFirst({
        where: {
            OR: [{ id }, { userId: id }],
        },
    });

    if (!perfilExistente) {
        res.status(404).json({ error: "El perfil del profesional no ha encontrado" });
        return;
    }

    const profesionalAprobado = await prisma.profile.update({
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
        res.status(500).json({ error: "Error interno al aprobar el perfil profesional" });
    }
};

// Rechazar el perfil de un profesional
export const rejectProfessional = async (
    req: AuthRequest,
    res: Response,
): Promise<void> => {
    try {
        const { id } = req.params;
        const idAdministrador = req.user?.userId;
        const { motivo } = req.body;

        const perfilExistente = await prisma.profile.findFirst({
        where: { id }
        })
    
        if (!perfilExistente) {
        res.status(404).json({ error: "El perfil del profesional no ha sido encontrado" });
        return;
        }

        const profesionalRechazado = await prisma.profile.update({
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
