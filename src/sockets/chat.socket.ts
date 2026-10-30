import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { notificar } from "../services/notification.service";
import {
  marcarConectado,
  marcarDesconectado,
  estaUsuarioConectado,
} from "./presence";

interface SocketUser {
  userId: string;
  rol: string;
}

export interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
}

const ESTADOS_BLOQUEADOS = ["FINALIZADO", "DISPUTA", "RECHAZADO"];

export const initChatSocket = (io: Server) => {
  io.use((socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      if (!token) {
        return next(
          new Error("Autenticación requerida: Token no proporcionado"),
        );
      }

      const secret =
        process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
      const decoded = jwt.verify(token, secret) as SocketUser;
      socket.user = decoded;
      next();
    } catch (err: any) {
      console.error("Error autenticando socket:", err.message);
      next(new Error("Token inválido o expirado"));
    }
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    const userId = socket.user?.userId;
    console.log(
      `🔌 [Socket.io] Usuario conectado al chat: ${userId} (${socket.id})`,
    );
    if (userId) {
      marcarConectado(userId);
      socket.join(`usuario_${userId}`);
    }

    const handleJoinSolicitud = async (data: { solicitud_id: string }) => {
      try {
        const { solicitud_id } = data || {};
        if (!solicitud_id || !userId) return;
        const solicitud = await prisma.solicitudTrabajo.findUnique({
          where: { id: solicitud_id },
          include: {
            servicio: { select: { profesional_id: true } },
          },
        });

        if (!solicitud) {
          socket.emit("error_chat", { mensaje: "Solicitud no encontrada" });
          return;
        }

        const esCliente = solicitud.cliente_id === userId;
        const esProfesional = solicitud.servicio?.profesional_id === userId;

        if (!esCliente && !esProfesional) {
          socket.emit("error_chat", {
            mensaje: "No tienes autorización para acceder a este chat",
          });
          return;
        }

        const roomName = `solicitud_${solicitud_id}`;
        socket.join(roomName);

        const estadoActual = (
          solicitud.estado_solicitud_trabajo || ""
        ).toUpperCase();
        const bloqueado = ESTADOS_BLOQUEADOS.includes(estadoActual);

        socket.emit("chat_unido", {
          solicitud_id,
          bloqueado,
          estado_solicitud: estadoActual,
        });

        await prisma.mensajeChat.updateMany({
          where: {
            solicitud_id,
            remitente_id: { not: userId },
            leido: false,
          },
          data: { leido: true },
        });

        io.to(roomName).emit("mensajes_leidos", {
          solicitud_id,
          leido_por: userId,
        });
      } catch (error: any) {
        console.error("Error en join_solicitud:", error.message);
      }
    };

    socket.on("join_solicitud", handleJoinSolicitud);
    socket.on("unirse_sala", handleJoinSolicitud);

    socket.on(
      "enviar_mensaje",
      async (
        payload: {
          solicitud_id: string;
          contenido?: string;
          adjunto_url?: string;
          temp_id?: string;
        },
        callback?: (response: any) => void,
      ) => {
        try {
          const { solicitud_id, contenido, adjunto_url, temp_id } = payload;
          if (!userId) return;

          if (!contenido?.trim() && !adjunto_url) {
            callback?.({ error: "El mensaje no puede estar vacío" });
            return;
          }

          const solicitud = await prisma.solicitudTrabajo.findUnique({
            where: { id: solicitud_id },
            include: { servicio: { select: { profesional_id: true } } },
          });

          if (!solicitud) {
            callback?.({ error: "Solicitud de trabajo no encontrada" });
            return;
          }

          const estadoActual = (
            solicitud.estado_solicitud_trabajo || ""
          ).toUpperCase();
          if (ESTADOS_BLOQUEADOS.includes(estadoActual)) {
            const errorMsg = `No se pueden enviar mensajes: El trabajo se encuentra en estado ${estadoActual}.`;
            socket.emit("chat_bloqueado", { solicitud_id, motivo: errorMsg });
            callback?.({ error: errorMsg, bloqueado: true });
            return;
          }

          const nuevoMensaje = await prisma.mensajeChat.create({
            data: {
              solicitud_id,
              remitente_id: userId,
              contenido: contenido?.trim() || "",
              adjunto_url: adjunto_url || null,
              leido: false,
            },
          });

          const roomName = `solicitud_${solicitud_id}`;

          io.to(roomName).emit("nuevo_mensaje", {
            ...nuevoMensaje,
            temp_id,
          });

          socket.to(roomName).emit("usuario_detuvo_escribiendo", {
            solicitud_id,
            usuario_id: userId,
          });
          callback?.({
            status: "ENVIADO",
            mensaje: nuevoMensaje,
            temp_id,
            mensaje_id: nuevoMensaje.id,
          });

          const destinatarioId =
            userId === solicitud.cliente_id
              ? solicitud.servicio?.profesional_id
              : solicitud.cliente_id;

          if (destinatarioId && !estaUsuarioConectado(destinatarioId)) {
            const vistaPrevia = contenido?.trim()
              ? contenido.trim().slice(0, 80)
              : adjunto_url
                ? "Te enviaron un archivo adjunto"
                : "Nuevo mensaje";

            notificar(destinatarioId, {
              tipo: "MENSAJE_CHAT",
              titulo: "Nuevo mensaje",
              cuerpo: vistaPrevia,
              data: {
                ruta: `/chat/${solicitud_id}`,
                solicitudId: solicitud_id,
                mensajeId: nuevoMensaje.id,
              },
              critica: false,
            }).catch((error: any) =>
              console.error(
                "Error notificando mensaje de chat:",
                error?.message || error,
              ),
            );
          }
        } catch (error: any) {
          console.error("Error al persistir mensaje:", error.message);
          callback?.({ error: "Error interno al enviar el mensaje" });
        }
      },
    );

    socket.on(
      "confirmar_entrega",
      (data: { mensaje_id: string; solicitud_id: string }) => {
        const roomName = `solicitud_${data.solicitud_id}`;
        socket.to(roomName).emit("mensaje_entregado", {
          mensaje_id: data.mensaje_id,
        });
      },
    );

    socket.on("marcar_leido", async (data: { solicitud_id: string }) => {
      try {
        const { solicitud_id } = data;
        if (!userId || !solicitud_id) return;

        await prisma.mensajeChat.updateMany({
          where: {
            solicitud_id,
            remitente_id: { not: userId },
            leido: false,
          },
          data: { leido: true },
        });

        const roomName = `solicitud_${solicitud_id}`;
        io.to(roomName).emit("mensajes_leidos", {
          solicitud_id,
          leido_por: userId,
        });
      } catch (error: any) {
        console.error("Error en marcar_leido:", error.message);
      }
    });

    socket.on("escribiendo", (data: { solicitud_id: string }) => {
      const { solicitud_id } = data || {};
      if (!solicitud_id || !userId) return;
      const roomName = `solicitud_${solicitud_id}`;
      socket.to(roomName).emit("usuario_escribiendo", {
        solicitud_id,
        usuario_id: userId,
      });
    });

    socket.on("detener_escribiendo", (data: { solicitud_id: string }) => {
      const { solicitud_id } = data || {};
      if (!solicitud_id || !userId) return;
      const roomName = `solicitud_${solicitud_id}`;
      socket.to(roomName).emit("usuario_detuvo_escribiendo", {
        solicitud_id,
        usuario_id: userId,
      });
    });

    socket.on(
      "responder_propuesta",
      async (data: {
        solicitud_id: string;
        mensaje_id: string;
        nuevo_estado: "ACEPTADA" | "REPROGRAMAR";
        respuesta_texto?: string;
      }) => {
        try {
          const { solicitud_id, mensaje_id, nuevo_estado, respuesta_texto } =
            data || {};
          if (!solicitud_id || !mensaje_id || !userId) return;

          const mensaje = await prisma.mensajeChat.findUnique({
            where: { id: mensaje_id },
          });

          if (!mensaje || !mensaje.contenido.startsWith("[PROPUESTA_VISITA]:"))
            return;

          let propuestaData: any = {};
          try {
            propuestaData = JSON.parse(
              mensaje.contenido.slice("[PROPUESTA_VISITA]:".length),
            );
          } catch {
            return;
          }

          propuestaData.estado = nuevo_estado;
          const nuevoContenido = `[PROPUESTA_VISITA]:${JSON.stringify(propuestaData)}`;

          await prisma.mensajeChat.update({
            where: { id: mensaje_id },
            data: { contenido: nuevoContenido },
          });

          const roomName = `solicitud_${solicitud_id}`;

          io.to(roomName).emit("propuesta_actualizada", {
            solicitud_id,
            mensaje_id,
            nuevo_estado,
            contenido: nuevoContenido,
          });

          if (respuesta_texto?.trim()) {
            const confirmMsg = await prisma.mensajeChat.create({
              data: {
                solicitud_id,
                remitente_id: userId,
                contenido: respuesta_texto.trim(),
                leido: false,
              },
            });

            io.to(roomName).emit("nuevo_mensaje", confirmMsg);
          }
        } catch (error: any) {
          console.error("Error en socket responder_propuesta:", error.message);
        }
      },
    );

    socket.on("disconnect", () => {
      if (userId) marcarDesconectado(userId);
      console.log(`🔌 [Socket.io] Usuario desconectado: ${userId}`);
    });
  });
};
