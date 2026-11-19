import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";
import { getIO } from "../sockets/io";
import { TipoMotivoReporte } from "@prisma/client";
import { finalizarLlamadaPorBloqueo } from "../sockets/chat.socket";

/**
 * Registra una denuncia formal sobre un usuario con motivo tipificado y descargo.
 * Opcionalmente permite bloquear al usuario denunciado de manera bilateral inmediata.
 */
export const crearReporteDenuncia = async (
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
      denunciado_id,
      solicitud_id,
      tipo_motivo,
      descripcion,
      captura_url,
      bloquear,
    } = req.body;

    if (!denunciado_id) {
      res.status(400).json({ error: "El ID del usuario denunciado es obligatorio" });
      return;
    }

    if (userId === denunciado_id) {
      res.status(400).json({ error: "No puedes denunciarte a ti mismo" });
      return;
    }

    if (!descripcion || typeof descripcion !== "string" || !descripcion.trim()) {
      res.status(400).json({ error: "La descripción o descargo de la denuncia es obligatorio" });
      return;
    }

    const motivosValidos = Object.values(TipoMotivoReporte);
    if (!tipo_motivo || !motivosValidos.includes(tipo_motivo)) {
      res.status(400).json({
        error: "Tipo de motivo de denuncia inválido",
        motivos_validos: motivosValidos,
      });
      return;
    }

    const usuarioDenunciado = await prisma.usuario.findUnique({
      where: { id: denunciado_id },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        rol: true,
        foto_perfil: true,
      },
    });

    if (!usuarioDenunciado) {
      res.status(404).json({ error: "El usuario denunciado no fue encontrado" });
      return;
    }

    if (solicitud_id) {
      const solicitudExiste = await prisma.solicitudTrabajo.findUnique({
        where: { id: solicitud_id },
      });
      if (!solicitudExiste) {
        res.status(404).json({ error: "La solicitud asociada no fue encontrada" });
        return;
      }
    }

    const nuevoReporte = await prisma.reporteDenuncia.create({
      data: {
        denunciante_id: userId,
        denunciado_id,
        solicitud_id: solicitud_id || null,
        tipo_motivo,
        descripcion: descripcion.trim(),
        captura_url: captura_url || null,
        estado: "PENDIENTE",
      },
      include: {
        denunciante: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            rol: true,
            foto_perfil: true,
          },
        },
        denunciado: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            rol: true,
            foto_perfil: true,
            strikes: true,
            activo: true,
          },
        },
      },
    });

    let bloqueoRealizado = null;
    if (bloquear) {
      const bloqueoExistente = await prisma.bloqueoUsuario.findFirst({
        where: {
          activo: true,
          bloqueador_id: userId,
          bloqueado_id: denunciado_id,
        },
      });

      if (!bloqueoExistente) {
        bloqueoRealizado = await prisma.bloqueoUsuario.create({
          data: {
            bloqueador_id: userId,
            bloqueado_id: denunciado_id,
            solicitud_id: solicitud_id || null,
            motivo: `Denuncia: ${tipo_motivo} - ${descripcion.trim()}`,
            activo: true,
          },
        });
      }

      if (solicitud_id) {
        await prisma.solicitudTrabajo.update({
          where: { id: solicitud_id },
          data: { estado_solicitud_trabajo: "BLOQUEADO" as any },
        }).catch(() => { });

        await finalizarLlamadaPorBloqueo(
          solicitud_id,
          "Llamada finalizada: La comunicación ha sido bloqueada por denuncia"
        );

        const io = getIO();
        io?.to(`solicitud_${solicitud_id}`).emit("chat_bloqueado", {
          solicitud_id,
          bloqueador_id: userId,
          bloqueado_id: denunciado_id,
          motivo: `Denuncia: ${tipo_motivo}`,
          estado_solicitud: "BLOQUEADO",
        });
      }
    }

    const io = getIO();
    const alertaAdmin = {
      tipo: "NUEVO_REPORTE",
      reporte_id: nuevoReporte.id,
      solicitud_id: nuevoReporte.solicitud_id,
      denunciante: nuevoReporte.denunciante,
      denunciado: nuevoReporte.denunciado,
      tipo_motivo: nuevoReporte.tipo_motivo,
      descripcion: nuevoReporte.descripcion,
      creado_en: nuevoReporte.creado_en,
      bloqueo_aplicado: Boolean(bloqueoRealizado),
    };

    io?.to("admins").emit("admin:nuevo_reporte", alertaAdmin);
    io?.emit("admin:nuevo_reporte", alertaAdmin);

    res.status(201).json({
      ok: true,
      mensaje: "Denuncia radicada exitosamente y enviada a auditoría",
      reporte: nuevoReporte,
      bloqueo: bloqueoRealizado,
    });
  } catch (error: any) {
    console.error("Error al crear reporte de denuncia:", error.message);
    res.status(500).json({ error: "Error interno al radicar la denuncia" });
  }
};

