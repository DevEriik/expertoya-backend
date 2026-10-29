import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const crearSolicitud = async (req: Request, res: Response) => {
  try {
    const { profesional_id, descripcion, fecha_tentativa, franja_horaria } =
      req.body;
    const cliente_id = (req as any).user.id;

    const expira_at = new Date();
    expira_at.setHours(expira_at.getHours() + 48);

    const nuevaSolicitud = await prisma.solicitud.create({
      data: {
        cliente_id,
        profesional_id,
        descripcion,
        fecha_tentativa: new Date(fecha_tentativa),
        franja_horaria,
        expira_at,
        estado: "PENDIENTE",
      },
      include: {
        profesional: {
          include: { usuario: true },
        },
      },
    });


    res.status(201).json(nuevaSolicitud);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Error al crear la solicitud de contratación" });
  }
};

export const obtenerMisSolicitudes = async (req: Request, res: Response) => {
  try {
        const cliente_id = (req as any).user.id;
    const solicitudes = await prisma.solicitud.findMany({
      where: { cliente_id },
      include: {
        profesional: {
          include: { usuario: true }, 
        },
      },
      orderBy: { creado_en: "desc" },
    });
    res.json(solicitudes);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener el historial de solicitudes" });
  }
};

export const obtenerSolicitudesRecibidas = async (
  req: Request,
  res: Response,
) => {
  try {
    const profesional_id = (req as any).user.id; 
    const solicitudes = await prisma.solicitud.findMany({
      where: { profesional_id },
      include: {
        cliente: true, 
      },
      orderBy: { creado_en: "desc" },
    });
    res.json(solicitudes);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener las solicitudes recibidas" });
  }
};

export const actualizarEstadoSolicitud = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const profesional_id = (req as any).user.id;

    const solicitud = await prisma.solicitud.findUnique({ where: { id } });

    if (!solicitud) {
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }
    if (solicitud.profesional_id !== profesional_id) {
      return res
        .status(403)
        .json({ error: "No tienes permiso para modificar esta solicitud" });
    }
    if (solicitud.estado !== "PENDIENTE") {
      return res
        .status(400)
        .json({ error: "Solo se pueden responder solicitudes pendientes" });
    }

    const solicitudActualizada = await prisma.solicitud.update({
      where: { id },
      data: {
        estado,
        respondida_at: new Date(),
      },
    });

    res.json(solicitudActualizada);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar el estado de la solicitud" });
  }
};
