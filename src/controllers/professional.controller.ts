import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

export const getProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const usuarioConPerfil = await prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        telefono: true,
        foto_perfil: true,
        rol: true,
        profesional: {
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

    if (!usuarioConPerfil || !usuarioConPerfil.profesional) {
      res.status(404).json({ error: "Perfil profesional no encontrado" });
      return;
    }

    res.status(200).json({
      id: usuarioConPerfil.profesional.id,
      userId: usuarioConPerfil.id,
      nombre: usuarioConPerfil.nombre,
      apellido: usuarioConPerfil.apellido,
      email: usuarioConPerfil.email,
      telefono: usuarioConPerfil.telefono,
      foto_perfil: usuarioConPerfil.foto_perfil,
      descripcion_perfil: usuarioConPerfil.profesional.descripcion_perfil,
      ubicacion_geografica: usuarioConPerfil.profesional.ubicacion_geografica,
      estado_validado: usuarioConPerfil.profesional.estado_validado,
      calificacion_promedio: usuarioConPerfil.profesional.calificacion_promedio,
    });
  } catch (error: any) {
    console.error("Error al obtener perfil profesional:", error);
    res
      .status(500)
      .json({
        error: "Error interno al obtener el perfil",
        detalle: error.message || error,
      });
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
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

    const perfilExistente = await prisma.profesional.findUnique({
      where: { id: userId },
    });

    if (!perfilExistente) {
      res.status(404).json({ error: "Perfil profesional no encontrado" });
      return;
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: userId },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(apellido !== undefined && { apellido }),
        ...(telefono !== undefined && { telefono }),
        ...(foto_perfil !== undefined && { foto_perfil }),
        profesional: {
          update: {
            ...(descripcion_perfil !== undefined && { descripcion_perfil }),
            ...(ubicacion_geografica !== undefined && { ubicacion_geografica }),
          },
        },
      },
      include: { profesional: true },
    });

    res.status(200).json({
      mensaje: "Perfil profesional actualizado con éxito",
      perfil: {
        id: usuarioActualizado.profesional?.id,
        userId: usuarioActualizado.id,
        nombre: usuarioActualizado.nombre,
        apellido: usuarioActualizado.apellido,
        telefono: usuarioActualizado.telefono,
        foto_perfil: usuarioActualizado.foto_perfil,
        descripcion_perfil: usuarioActualizado.profesional?.descripcion_perfil,
        ubicacion_geografica:
          usuarioActualizado.profesional?.ubicacion_geografica,
        estado_validado: usuarioActualizado.profesional?.estado_validado,
      },
    });
  } catch (error: any) {
    console.error("Error al actualizar perfil profesional:", error);
    res
      .status(500)
      .json({
        error: "Error interno al actualizar el perfil",
        detalle: error.message || error,
      });
  }
};

export const submitOnboarding = async (
  req: AuthRequest,
  res: Response,
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
    if (files?.dni_frente?.[0])
      dataToUpdate.dni_frente = files.dni_frente[0].path;
    if (files?.dni_dorso?.[0]) dataToUpdate.dni_dorso = files.dni_dorso[0].path;
    if (files?.selfie_biometrica?.[0])
      dataToUpdate.selfie_biometrica = files.selfie_biometrica[0].path;
    if (files?.antecedentes_penales?.[0])
      dataToUpdate.antecedentes_penales = files.antecedentes_penales[0].path;
    if (files?.certificado_no_deudor?.[0])
      dataToUpdate.certificado_no_deudor = files.certificado_no_deudor[0].path;
    if (files?.constancia_afip?.[0])
      dataToUpdate.constancia_afip = files.constancia_afip[0].path;

    await prisma.profesional.upsert({
      where: { id: userId },
      update: dataToUpdate,
      create: {
        id: userId,
        ...dataToUpdate,
        estado_validado: false,
      },
    });

    res.status(200).json({
      mensaje: "Onboarding completado exitosamente",
      documentosRecibidos: Object.keys(files || {}),
    });
  } catch (error: any) {
    console.error("Error en submitOnboarding:", error);
    res
      .status(500)
      .json({
        error: "Error interno al procesar el onboarding",
        detalle: error.message || error,
      });
  }
};
