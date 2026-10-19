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
            disponible: true,
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
      disponible: (usuarioConPerfil.profesional as any)?.disponible ?? true,
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
      disponible,
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
            ...(disponible !== undefined && { disponible: Boolean(disponible) }),
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
        disponible: (usuarioActualizado.profesional as any)?.disponible ?? true,
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
        disponible: true,
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

export const getAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const disponibilidades = await prisma.disponibilidadProfesional.findMany({
      where: { profesional_id: userId },
      orderBy: { dia_semana: "asc" },
    });

    const formateados = disponibilidades.map((d) => ({
      id: d.id,
      dia_semana: d.dia_semana,
      hora_inicio: d.hora_inicio.toISOString().substring(11, 16),
      hora_fin: d.hora_fin.toISOString().substring(11, 16),
    }));

    res.status(200).json(formateados);
  } catch (error: any) {
    console.error("Error al obtener disponibilidad:", error);
    res.status(500).json({ error: "Error al obtener disponibilidad" });
  }
};

export const updateAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const { horarios } = req.body;

    if (!Array.isArray(horarios)) {
      res.status(400).json({ error: "El formato de horarios debe ser una lista" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.disponibilidadProfesional.deleteMany({
        where: { profesional_id: userId },
      });

      if (horarios.length > 0) {
        await tx.disponibilidadProfesional.createMany({
          data: horarios.map((h: any) => ({
            profesional_id: userId,
            dia_semana: Number(h.dia_semana),
            hora_inicio: new Date(`1970-01-01T${h.hora_inicio}:00Z`),
            hora_fin: new Date(`1970-01-01T${h.hora_fin}:00Z`),
          })),
        });
      }
    });

    res.status(200).json({ mensaje: "Disponibilidad guardada correctamente" });
  } catch (error: any) {
    console.error("Error al actualizar disponibilidad:", error);
    res.status(500).json({ error: "Error interno al guardar disponibilidad" });
  }
};

export const getMyServices = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const services = await prisma.servicioPublicado.findMany({
      where: { profesional_id: userId },
      include: {
        oficio: {
          select: { id: true, nombre_oficio: true },
        },
      },
      orderBy: { id: "desc" },
    });

    const formatted = services.map((s) => ({
      id: s.id,
      profesional_id: s.profesional_id,
      oficio_id: s.oficio_id,
      nombre_oficio: s.oficio?.nombre_oficio,
      titulo_servicio: s.titulo_servicio,
      descripcion_servicio: s.descripcion_servicio,
      costo_estimado: Number(s.costo_estimado),
      duracion_estimada: s.duracion_estimada,
      fotos_servicio: Array.isArray(s.fotos_servicio) ? s.fotos_servicio : [],
      servicio_activo: s.servicio_activo,
    }));

    res.status(200).json(formatted);
  } catch (error: any) {
    console.error("Error al obtener servicios del profesional:", error);
    res.status(500).json({ error: "Error al obtener servicios" });
  }
};

export const getPublicServicesByProfessionalId = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "ID de profesional requerido" });
      return;
    }

    const services = await prisma.servicioPublicado.findMany({
      where: {
        profesional_id: id,
        servicio_activo: true,
      },
      include: {
        oficio: {
          select: { id: true, nombre_oficio: true },
        },
      },
      orderBy: { costo_estimado: "asc" },
    });

    const formatted = services.map((s) => ({
      id: s.id,
      profesional_id: s.profesional_id,
      oficio_id: s.oficio_id,
      nombre_oficio: s.oficio?.nombre_oficio,
      titulo_servicio: s.titulo_servicio,
      descripcion_servicio: s.descripcion_servicio,
      costo_estimado: Number(s.costo_estimado),
      duracion_estimada: s.duracion_estimada,
      fotos_servicio: Array.isArray(s.fotos_servicio) ? s.fotos_servicio : [],
      servicio_activo: s.servicio_activo,
    }));

    res.status(200).json(formatted);
  } catch (error: any) {
    console.error("Error al obtener servicios públicos:", error);
    res.status(500).json({ error: "Error al obtener servicios públicos" });
  }
};

export const createService = async (
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
      oficio_id,
      titulo_servicio,
      descripcion_servicio,
      costo_estimado,
      duracion_estimada,
      fotos_servicio,
      servicio_activo = true,
    } = req.body;

    if (!titulo_servicio || !oficio_id || !costo_estimado || !duracion_estimada) {
      res.status(400).json({
        error:
          "Los campos título, oficio, costo y duración estimada son obligatorios",
      });
      return;
    }

    if (Boolean(servicio_activo)) {
      const activeCount = await prisma.servicioPublicado.count({
        where: {
          profesional_id: userId,
          servicio_activo: true,
        },
      });

      if (activeCount >= 30) {
        res.status(400).json({
          error:
            "Has alcanzado el límite inicial máximo de 30 servicios activos por perfil.",
        });
        return;
      }
    }

    const nuevoServicio = await prisma.servicioPublicado.create({
      data: {
        profesional_id: userId,
        oficio_id: Number(oficio_id),
        titulo_servicio: String(titulo_servicio).trim(),
        descripcion_servicio: String(descripcion_servicio || "").trim(),
        costo_estimado: Number(costo_estimado),
        duracion_estimada: String(duracion_estimada).trim(),
        fotos_servicio: Array.isArray(fotos_servicio) ? fotos_servicio : [],
        servicio_activo: Boolean(servicio_activo),
      },
      include: {
        oficio: {
          select: { id: true, nombre_oficio: true },
        },
      },
    });

    res.status(201).json({
      mensaje: "Servicio publicado con éxito",
      servicio: {
        id: nuevoServicio.id,
        profesional_id: nuevoServicio.profesional_id,
        oficio_id: nuevoServicio.oficio_id,
        nombre_oficio: nuevoServicio.oficio?.nombre_oficio,
        titulo_servicio: nuevoServicio.titulo_servicio,
        descripcion_servicio: nuevoServicio.descripcion_servicio,
        costo_estimado: Number(nuevoServicio.costo_estimado),
        duracion_estimada: nuevoServicio.duracion_estimada,
        fotos_servicio: nuevoServicio.fotos_servicio,
        servicio_activo: nuevoServicio.servicio_activo,
      },
    });
  } catch (error: any) {
    console.error("Error al crear servicio:", error);
    res.status(500).json({ error: "Error interno al crear el servicio" });
  }
};

export const updateService = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const servicioExistente = await prisma.servicioPublicado.findFirst({
      where: { id, profesional_id: userId },
    });

    if (!servicioExistente) {
      res
        .status(404)
        .json({ error: "Servicio no encontrado o no pertenece a tu perfil" });
      return;
    }

    const {
      oficio_id,
      titulo_servicio,
      descripcion_servicio,
      costo_estimado,
      duracion_estimada,
      fotos_servicio,
      servicio_activo,
    } = req.body;

    if (servicio_activo === true && !servicioExistente.servicio_activo) {
      const activeCount = await prisma.servicioPublicado.count({
        where: {
          profesional_id: userId,
          servicio_activo: true,
          NOT: { id },
        },
      });

      if (activeCount >= 30) {
        res.status(400).json({
          error:
            "Has alcanzado el límite inicial máximo de 30 servicios activos por perfil.",
        });
        return;
      }
    }

    const servicioActualizado = await prisma.servicioPublicado.update({
      where: { id },
      data: {
        ...(oficio_id !== undefined && { oficio_id: Number(oficio_id) }),
        ...(titulo_servicio !== undefined && {
          titulo_servicio: String(titulo_servicio).trim(),
        }),
        ...(descripcion_servicio !== undefined && {
          descripcion_servicio: String(descripcion_servicio).trim(),
        }),
        ...(costo_estimado !== undefined && {
          costo_estimado: Number(costo_estimado),
        }),
        ...(duracion_estimada !== undefined && {
          duracion_estimada: String(duracion_estimada).trim(),
        }),
        ...(fotos_servicio !== undefined && {
          fotos_servicio: Array.isArray(fotos_servicio) ? fotos_servicio : [],
        }),
        ...(servicio_activo !== undefined && {
          servicio_activo: Boolean(servicio_activo),
        }),
      },
      include: {
        oficio: {
          select: { id: true, nombre_oficio: true },
        },
      },
    });

    res.status(200).json({
      mensaje: "Servicio actualizado con éxito",
      servicio: {
        id: servicioActualizado.id,
        profesional_id: servicioActualizado.profesional_id,
        oficio_id: servicioActualizado.oficio_id,
        nombre_oficio: servicioActualizado.oficio?.nombre_oficio,
        titulo_servicio: servicioActualizado.titulo_servicio,
        descripcion_servicio: servicioActualizado.descripcion_servicio,
        costo_estimado: Number(servicioActualizado.costo_estimado),
        duracion_estimada: servicioActualizado.duracion_estimada,
        fotos_servicio: servicioActualizado.fotos_servicio,
        servicio_activo: servicioActualizado.servicio_activo,
      },
    });
  } catch (error: any) {
    console.error("Error al actualizar servicio:", error);
    res.status(500).json({ error: "Error interno al actualizar el servicio" });
  }
};

export const deleteService = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const servicioExistente = await prisma.servicioPublicado.findFirst({
      where: { id, profesional_id: userId },
    });

    if (!servicioExistente) {
      res
        .status(404)
        .json({ error: "Servicio no encontrado o no pertenece a tu perfil" });
      return;
    }

    await prisma.servicioPublicado.delete({
      where: { id },
    });

    res.status(200).json({ mensaje: "Servicio eliminado con éxito" });
  } catch (error: any) {
    console.error("Error al eliminar servicio:", error);
    res.status(500).json({ error: "Error interno al eliminar el servicio" });
  }
};
