import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

/**
 * GET /api/professionals/profile
 * Obtiene los datos del profesional autenticado para precargar el formulario en la app móvil.
 */
export const getProfile = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ error: "No autenticado" });
            return;
        }

        const usuarioConPerfil = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                nombre: true,
                apellido: true,
                email: true,
                telefono: true,
                foto_perfil: true,
                rol: true,
                profile: {
                    select: {
                        id: true,
                        descripcion_perfil: true,
                        ubicacion_geografica: true,
                        estado_validado: true,
                        calificacion_promedio: true,
                    },
                },
            },
        });

        if (!usuarioConPerfil || !usuarioConPerfil.profile) {
            res.status(404).json({ error: "Perfil profesional no encontrado" });
            return;
        }

        res.status(200).json({
            id: usuarioConPerfil.profile.id,
            userId: usuarioConPerfil.id,
            nombre: usuarioConPerfil.nombre,
            apellido: usuarioConPerfil.apellido,
            email: usuarioConPerfil.email,
            telefono: usuarioConPerfil.telefono,
            foto_perfil: usuarioConPerfil.foto_perfil,
            descripcion_perfil: usuarioConPerfil.profile.descripcion_perfil,
            ubicacion_geografica: usuarioConPerfil.profile.ubicacion_geografica,
            estado_validado: usuarioConPerfil.profile.estado_validado,
            calificacion_promedio: usuarioConPerfil.profile.calificacion_promedio,
        });
    } catch (error: any) {
        console.error("Error al obtener perfil profesional:", error);
        res.status(500).json({
            error: "Error interno al obtener el perfil",
            detalle: error.message || error,
        });
    }
};

/**
 * PUT /api/professionals/profile
 * Actualiza la información pública, foto y zonas de cobertura del profesional.
 */
export const updateProfile = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ error: "No autenticado" });
            return;
        }

        const {
            nombre,
            apellido,
            telefono,
            foto_perfil,
            descripcion_perfil,
            ubicacion_geografica,
        } = req.body;

        const perfilExistente = await prisma.profile.findUnique({
            where: { userId },
        });

        if (!perfilExistente) {
            res.status(404).json({ error: "Perfil profesional no encontrado" });
            return;
        }

        const usuarioActualizado = await prisma.user.update({
            where: { id: userId },
            data: {
                ...(nombre !== undefined && { nombre }),
                ...(apellido !== undefined && { apellido }),
                ...(telefono !== undefined && { telefono }),
                ...(foto_perfil !== undefined && { foto_perfil }),
                profile: {
                    update: {
                        ...(descripcion_perfil !== undefined && { descripcion_perfil }),
                        ...(ubicacion_geografica !== undefined && { ubicacion_geografica }),
                    },
                },
            },
            include: {
                profile: true,
            },
        });

        res.status(200).json({
            mensaje: "Perfil profesional actualizado con éxito",
            perfil: {
                id: usuarioActualizado.profile?.id,
                userId: usuarioActualizado.id,
                nombre: usuarioActualizado.nombre,
                apellido: usuarioActualizado.apellido,
                telefono: usuarioActualizado.telefono,
                foto_perfil: usuarioActualizado.foto_perfil,
                descripcion_perfil: usuarioActualizado.profile?.descripcion_perfil,
                ubicacion_geografica: usuarioActualizado.profile?.ubicacion_geografica,
                estado_validado: usuarioActualizado.profile?.estado_validado,
            },
        });
    } catch (error: any) {
        console.error("Error al actualizar perfil profesional:", error);
        res.status(500).json({
            error: "Error interno al actualizar el perfil",
            detalle: error.message || error,
        });
    }
};

/**
 * POST /api/professionals/onboarding
 * Sube documentos de onboarding y CUIT del profesional.
 */
export const submitOnboarding = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: "No autenticado" });
            return;
        }

        const { cuit } = req.body;
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };

        const dataToUpdate: any = {};
        
        if (cuit) dataToUpdate.cuit = cuit;
        if (files?.dni_frente?.[0]) dataToUpdate.dni_frente = files.dni_frente[0].path;
        if (files?.dni_dorso?.[0]) dataToUpdate.dni_dorso = files.dni_dorso[0].path;
        if (files?.selfie_biometrica?.[0]) dataToUpdate.selfie_biometrica = files.selfie_biometrica[0].path;
        if (files?.antecedentes_penales?.[0]) dataToUpdate.antecedentes_penales = files.antecedentes_penales[0].path;
        if (files?.certificado_no_deudor?.[0]) dataToUpdate.certificado_no_deudor = files.certificado_no_deudor[0].path;
        if (files?.constancia_afip?.[0]) dataToUpdate.constancia_afip = files.constancia_afip[0].path;

        await prisma.profile.upsert({
            where: { userId },
            update: dataToUpdate,
            create: {
                userId,
                ...dataToUpdate,
                estado_validado: false,
            }
        });

        res.status(200).json({
            mensaje: "Onboarding completado exitosamente",
            documentosRecibidos: Object.keys(files || {}),
        });
    } catch (error: any) {
        console.error("Error en submitOnboarding:", error);
        res.status(500).json({
            error: "Error interno al procesar el onboarding",
            detalle: error.message || error,
        });
    }
};
