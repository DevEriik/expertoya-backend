import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import emailService from "../services/email.service";
import { subirArchivo } from "../services/storage.service";

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
            estado_auditoria: true,
            motivo_rechazo: true,
            calificacion_promedio: true,
          },
        },
      },
    });

    if (!usuarioConPerfil) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.status(200).json({
      id: usuarioConPerfil.profesional?.id || usuarioConPerfil.id,
      userId: usuarioConPerfil.id,
      nombre: usuarioConPerfil.nombre,
      apellido: usuarioConPerfil.apellido,
      email: usuarioConPerfil.email,
      telefono: usuarioConPerfil.telefono,
      foto_perfil: usuarioConPerfil.foto_perfil,
      rol: usuarioConPerfil.rol,
      descripcion_perfil:
        usuarioConPerfil.profesional?.descripcion_perfil || null,
      ubicacion_geografica:
        usuarioConPerfil.profesional?.ubicacion_geografica || null,
      estado_validado: usuarioConPerfil.profesional?.estado_validado ?? false,
      estado_auditoria: usuarioConPerfil.profesional?.estado_auditoria || null,
      motivo_rechazo: usuarioConPerfil.profesional?.motivo_rechazo || null,
      tiene_solicitud: Boolean(usuarioConPerfil.profesional),
      calificacion_promedio:
        usuarioConPerfil.profesional?.calificacion_promedio ?? 0,
    });
  } catch (error: any) {
    console.error("Error al obtener perfil profesional:", error);
    res.status(500).json({
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
      latitud,
      longitud,
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
            ...(latitud !== undefined && {
              latitud: latitud === null ? null : Number(latitud),
            }),
            ...(longitud !== undefined && {
              longitud: longitud === null ? null : Number(longitud),
            }),
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
    res.status(500).json({
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

    const { cuit, oficios_ids } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    console.log(`[Onboarding] Usuario: ${userId}`);
    console.log(
      `[Onboarding] Archivos recibidos:`,
      Object.entries(files || {}).map(
        ([key, list]) =>
          `${key}: ${list?.[0]?.originalname} (${list?.[0]?.size} bytes)`,
      ),
    );

    const dataToUpdate: any = {};

    if (cuit) dataToUpdate.cuit = cuit;

    if (files?.dni_frente?.[0])
      dataToUpdate.dni_frente = await subirArchivo(files.dni_frente[0]);
    if (files?.dni_dorso?.[0])
      dataToUpdate.dni_dorso = await subirArchivo(files.dni_dorso[0]);
    if (files?.selfie_biometrica?.[0])
      dataToUpdate.selfie_biometrica = await subirArchivo(
        files.selfie_biometrica[0],
      );
    if (files?.antecedentes_penales?.[0])
      dataToUpdate.antecedentes_penales = await subirArchivo(
        files.antecedentes_penales[0],
      );
    if (files?.certificado_no_deudor?.[0])
      dataToUpdate.certificado_no_deudor = await subirArchivo(
        files.certificado_no_deudor[0],
      );
    if (files?.constancia_afip?.[0])
      dataToUpdate.constancia_afip = await subirArchivo(
        files.constancia_afip[0],
      );
    if (files?.matricula_documento && files.matricula_documento.length > 0) {
      const urls = await Promise.all(
        files.matricula_documento.map((f) => subirArchivo(f)),
      );
      dataToUpdate.matricula_documento = urls.join(",");
    }

    let oficiosPrisma: { id: number }[] = [];

    const tradeSlugToId: Record<string, number> = {
      plumber: 1,
      plomero: 1,
      gas_fitter: 2,
      gasista: 2,
      electrician: 3,
      electricista: 3,
      painter: 4,
      pintor: 4,
    };

    if (oficios_ids) {
      try {
        const parsedIds =
          typeof oficios_ids === "string"
            ? JSON.parse(oficios_ids)
            : oficios_ids;
        const rawList = Array.isArray(parsedIds) ? parsedIds : [parsedIds];
        const numIds = rawList
          .map((item: any) => {
            const num = Number(item);
            if (!isNaN(num) && num > 0) return num;
            const mapped = tradeSlugToId[String(item).toLowerCase()];
            return mapped || null;
          })
          .filter((n): n is number => n !== null);

        oficiosPrisma = numIds.map((id) => ({ id }));
      } catch (e) {
        const parts = String(oficios_ids).split(",");
        const numIds = parts
          .map((p) => {
            const trimmed = p.trim();
            const num = Number(trimmed);
            if (!isNaN(num) && num > 0) return num;
            return tradeSlugToId[trimmed.toLowerCase()] || null;
          })
          .filter((n): n is number => n !== null);
        oficiosPrisma = numIds.map((id) => ({ id }));
      }
    }

    if (oficiosPrisma.length > 0) {
      const oficiosExistentes = await prisma.oficio.findMany({
        where: { id: { in: oficiosPrisma.map((o) => o.id) } },
        select: { id: true },
      });
      oficiosPrisma = oficiosExistentes.map((o) => ({ id: o.id }));
    }

    await prisma.profesional.upsert({
      where: { id: userId },
      update: {
        ...dataToUpdate,
        estado_validado: false,
        estado_auditoria: "PENDIENTE",
        motivo_rechazo: null,
        fecha_validacion: null,
        ...(oficiosPrisma.length > 0 && { oficios: { set: oficiosPrisma } }),
      },
      create: {
        id: userId,
        ...dataToUpdate,
        estado_validado: false,
        estado_auditoria: "PENDIENTE",
        ...(oficiosPrisma.length > 0 && {
          oficios: { connect: oficiosPrisma },
        }),
      },
    });

    try {
      const usuarioInfo = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { email: true, nombre: true },
      });

      if (usuarioInfo?.email) {
        emailService
          .sendOnboardingSubmittedEmail(usuarioInfo.email, usuarioInfo.nombre)
          .catch((err) =>
            console.error("Error enviando email al profesional:", err),
          );
        const oficiosNombres =
          oficiosPrisma.length > 0
            ? (
                await prisma.oficio.findMany({
                  where: { id: { in: oficiosPrisma.map((o) => o.id) } },
                  select: { nombre_oficio: true },
                })
              ).map((o) => o.nombre_oficio)
            : [];

        const adminUsers = await prisma.usuario.findMany({
          where: { rol: "ADMIN" },
          select: { email: true },
        });

        for (const admin of adminUsers) {
          emailService
            .sendAdminNewSolicitudEmail(
              admin.email,
              usuarioInfo.nombre,
              usuarioInfo.email,
              oficiosNombres,
            )
            .catch((err) =>
              console.error("Error enviando alerta al admin:", err),
            );
        }
      }
    } catch (emailErr) {
      console.error(
        "Error al despachar notificaciones de onboarding:",
        emailErr,
      );
    }

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

export const getOficios = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const oficios = await prisma.oficio.findMany({
      orderBy: { id: "asc" },
    });
    res.status(200).json(oficios);
  } catch (error: any) {
    console.error("Error al obtener oficios:", error);
    res.status(500).json({
      error: "Error interno al obtener los oficios",
      detalle: error.message || error,
    });
  }
};

export const getPublicProfessionals = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const profesionales = await prisma.profesional.findMany({
      where: {
        estado_validado: true,
        estado_auditoria: "APROBADO",
      },
      include: {
        oficios: true,
        usuario: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            foto_perfil: true,
          },
        },
      },
      orderBy: { calificacion_promedio: "desc" },
    });

    res.status(200).json(profesionales);
  } catch (error: any) {
    console.error("Error al obtener profesionales públicos:", error);
    res
      .status(500)
      .json({ error: "Error interno al obtener profesionales públicos" });
  }
};
