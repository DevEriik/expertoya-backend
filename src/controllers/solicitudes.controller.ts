import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const crearSolicitud = async (req: AuthRequest, res: Response) => {
  try {
    const clienteId = req.user?.userId;
    const {
      profesionalId, 
      servicioId,
      descripcion,
      fechaTentativa,
      franjaHoraria,
    } = req.body;

    if (!profesionalId || !servicioId || !descripcion || !fechaTentativa) {
      return res
        .status(400)
        .json({ error: "Todos los campos obligatorios son requeridos" });
    }

    const nuevaSolicitud = await prisma.solicitudTrabajo.create({
      data: {
        cliente_id: clienteId!,
        servicio_id: servicioId,
        fecha_solicitada: new Date(fechaTentativa),
        estado_solicitud_trabajo: "PENDIENTE",
        descripcion: descripcion,
        franja_horaria: franjaHoraria || "A coordinar",
        expira_at: new Date(Date.now() + 48 * 60 * 60 * 1000), 
      },
      include: {
        servicio: {
          include: {
            oficio: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: "Solicitud creada con éxito",
      data: nuevaSolicitud,
    });
  } catch (error) {
    console.error("Error al crear solicitud:", error);
    return res
      .status(500)
      .json({ error: "Error interno al procesar la solicitud" });
  }
};

export const obtenerSolicitudesCliente = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const clienteId = req.user?.userId;

    const solicitudes = await prisma.solicitudTrabajo.findMany({
      where: { cliente_id: clienteId },
      include: {
        servicio: {
          include: {
            oficio: true,
            profesional: {
              include: {
                usuario: {
                  select: { nombre: true, apellido: true, foto_perfil: true },
                },
              },
            },
          },
        },
      },
      orderBy: { actualizado_en: "desc" },
    });

    const solicitudesMapeadas = solicitudes.map((sol) => ({
      _id: sol.id,
      estado: sol.estado_solicitud_trabajo,
      fechaTentativa: sol.fecha_solicitada,
      createdAt: sol.actualizado_en,
      profesional: {
        usuario: {
          nombre: sol.servicio?.profesional?.usuario?.nombre || "Profesional",
          apellido: sol.servicio?.profesional?.usuario?.apellido || "",
          fotoPerfil: sol.servicio?.profesional?.usuario?.foto_perfil,
        },
      },
      descripcion: sol.descripcion || "",
      franjaHoraria: sol.franja_horaria || "A coordinar",
    }));

    return res.json({ data: solicitudesMapeadas });
  } catch (error) {
    console.error("Error al obtener solicitudes del cliente:", error);
    return res.status(500).json({ error: "Error al obtener el historial" });
  }
};

export const obtenerSolicitudesProfesional = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const usuarioId = req.user?.userId;

    const profesional = await prisma.profesional.findUnique({
      where: { id: usuarioId },
    });

    if (!profesional) {
      return res
        .status(404)
        .json({ error: "Perfil de profesional no encontrado" });
    }

    const serviciosDelPro = await prisma.servicioPublicado.findMany({
      where: { profesional_id: profesional.id },
      select: { id: true },
    });

    const servicioIds = serviciosDelPro.map((s: { id: string }) => s.id);

    const solicitudes = await prisma.solicitudTrabajo.findMany({
      where: { servicio_id: { in: servicioIds } },
      include: {
        cliente: {
          select: {
            nombre: true,
            apellido: true,
            telefono: true,
            foto_perfil: true,
          },
        },
        servicio: true,
      },
      orderBy: { actualizado_en: "desc" },
    });

    const solicitudesMapeadas = solicitudes.map((sol) => ({
      id: sol.id,
      _id: sol.id,
      estado: sol.estado_solicitud_trabajo,
      fechaTentativa: sol.fecha_solicitada,
      createdAt: sol.actualizado_en,
      cliente: {
        usuario: {
          nombre: sol.cliente?.nombre || "Cliente",
          apellido: sol.cliente?.apellido || "",
          telefono: sol.cliente?.telefono,
          fotoPerfil: sol.cliente?.foto_perfil,
        },
      },
      servicio: {
        titulo_servicio: sol.servicio?.titulo_servicio || "Servicio General",
      },
      descripcion: sol.descripcion || "Sin descripción",
      franjaHoraria: sol.franja_horaria || "A coordinar",
    }));

    return res.json({ data: solicitudesMapeadas });
  } catch (error) {
    console.error("Error al obtener solicitudes recibidas:", error);
    return res.status(500).json({ error: "Error al obtener las solicitudes" });
  }
};

export const responderSolicitud = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { accion } = req.body; 

    if (!["ACEPTADO", "RECHAZADO"].includes(accion)) {
      return res.status(400).json({ error: "Acción no válida" });
    }

    const solicitudActualizada = await prisma.solicitudTrabajo.update({
      where: { id },
      data: {
        estado_solicitud_trabajo: accion,
      },
    });

    return res.json({
      message: `Solicitud actualizada con éxito`,
      data: solicitudActualizada,
    });
  } catch (error) {
    console.error("Error al responder la solicitud:", error);
    return res
      .status(500)
      .json({ error: "Error interno al procesar la respuesta" });
  }
};
