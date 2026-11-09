import { Response } from "express";
import { Expo } from "expo-server-sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

export const registrarToken = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const { token, plataforma } = req.body as {
      token?: string;
      plataforma?: string;
    };

    if (!token || typeof token !== "string") {
      res
        .status(400)
        .json({ error: "El token del dispositivo es obligatorio" });
      return;
    }

    if (!Expo.isExpoPushToken(token)) {
      res.status(400).json({
        error: "El token no tiene formato de ExpoPushToken válido",
      });
      return;
    }

    const dispositivo = await prisma.dispositivoPush.upsert({
      where: { token },
      update: {
        userId,
        plataforma: plataforma || "DESCONOCIDA",
      },
      create: {
        userId,
        token,
        plataforma: plataforma || "DESCONOCIDA",
      },
    });

    res.status(201).json({
      mensaje: "Token de notificaciones registrado",
      dispositivo,
    });
  } catch (error: any) {
    console.error("Error al registrar token push:", error);
    res.status(500).json({ error: "Error interno al registrar el token" });
  }
};

export const listarNotificaciones = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const { leida, limit, cursor } = req.query as Record<
      string,
      string | undefined
    >;

    const take = Math.min(Math.max(Number(limit) || 30, 1), 100);

    const where: Prisma.NotificacionWhereInput = { userId };
    if (leida === "true") where.leida = true;
    if (leida === "false") where.leida = false;

    const [notificaciones, noLeidas] = await Promise.all([
      prisma.notificacion.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      }),
      prisma.notificacion.count({
        where: { userId, leida: false },
      }),
    ]);

    res.status(200).json({
      data: notificaciones,
      noLeidas,
    });
  } catch (error: any) {
    console.error("Error al listar notificaciones:", error);
    res.status(500).json({ error: "Error interno al listar notificaciones" });
  }
};

export const marcarLeida = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const { id } = req.params;

    const notificacion = await prisma.notificacion.findFirst({
      where: { id, userId },
    });

    if (!notificacion) {
      res.status(404).json({ error: "Notificación no encontrada" });
      return;
    }

    if (notificacion.leida) {
      res.status(200).json({
        mensaje: "La notificación ya estaba leída",
        notificacion,
      });
      return;
    }

    const actualizada = await prisma.notificacion.update({
      where: { id },
      data: { leida: true },
    });

    res.status(200).json({
      mensaje: "Notificación marcada como leída",
      notificacion: actualizada,
    });
  } catch (error: any) {
    console.error("Error al marcar notificación como leída:", error);
    res.status(500).json({ error: "Error interno al marcar la notificación" });
  }
};

export const marcarTodasLeidas = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const resultado = await prisma.notificacion.updateMany({
      where: { userId, leida: false },
      data: { leida: true },
    });

    res.status(200).json({
      mensaje: "Notificaciones marcadas como leídas",
      actualizadas: resultado.count,
    });
  } catch (error: any) {
    console.error("Error al marcar todas las notificaciones:", error);
    res
      .status(500)
      .json({ error: "Error interno al marcar las notificaciones" });
  }
};

export const actualizarPreferencias = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const { sonidoActivo } = req.body as { sonidoActivo?: boolean };

    if (typeof sonidoActivo !== "boolean") {
      res.status(400).json({
        error: "El campo sonidoActivo debe ser booleano",
      });
      return;
    }

    const usuario = await prisma.usuario.update({
      where: { id: userId },
      data: { sonidoActivo },
      select: { id: true, sonidoActivo: true },
    });

    res.status(200).json({
      mensaje: "Preferencias actualizadas",
      usuario,
    });
  } catch (error: any) {
    console.error("Error al actualizar preferencias:", error);
    res.status(500).json({ error: "Error interno al actualizar preferencias" });
  }
};
