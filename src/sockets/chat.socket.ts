import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { DailyService } from "../services/daily.service";

interface SocketUser {
  userId: string;
  rol: string;
}

export interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
}

const ESTADOS_BLOQUEADOS = ["FINALIZADO", "DISPUTA", "RECHAZADO"];

interface LlamadaActiva {
  solicitud_id: string;
  caller_id: string;
  caller_socket_id: string;
  recipient_id: string;
  recipient_socket_id?: string;
  room_url: string;
  room_name: string;
  sesion_id?: string;
  iniciado_en: Date;
  estado: "invitando" | "conectada" | "finalizada";
}

const llamadasActivas = new Map<string, LlamadaActiva>();
const socketToSolicitudLlamada = new Map<string, string>();

export const initChatSocket = (io: Server) => {
  io.use((socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      if (!token) {
        return next(new Error("Autenticación requerida: Token no proporcionado"));
      }

      const secret = process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
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
    console.log(`🔌 [Socket.io] Usuario conectado al chat: ${userId} (${socket.id})`);

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

        const estadoActual = (solicitud.estado_solicitud_trabajo || "").toUpperCase();
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
        callback?: (response: any) => void
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

          const estadoActual = (solicitud.estado_solicitud_trabajo || "").toUpperCase();
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
        } catch (error: any) {
          console.error("Error al persistir mensaje:", error.message);
          callback?.({ error: "Error interno al enviar el mensaje" });
        }
      }
    );

    socket.on("confirmar_entrega", (data: { mensaje_id: string; solicitud_id: string }) => {
      const roomName = `solicitud_${data.solicitud_id}`;
      socket.to(roomName).emit("mensaje_entregado", {
        mensaje_id: data.mensaje_id,
      });
    });

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
          const { solicitud_id, mensaje_id, nuevo_estado, respuesta_texto } = data || {};
          if (!solicitud_id || !mensaje_id || !userId) return;

          const mensaje = await prisma.mensajeChat.findUnique({
            where: { id: mensaje_id },
          });

          if (!mensaje || !mensaje.contenido.startsWith("[PROPUESTA_VISITA]:")) return;

          let propuestaData: any = {};
          try {
            propuestaData = JSON.parse(mensaje.contenido.slice("[PROPUESTA_VISITA]:".length));
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
      }
    );

    /**
     * Emite una invitación para iniciar videollamada de diagnóstico visual
     */
    socket.on(
      "call:invite",
      async (
        data: { solicitud_id: string },
        callback?: (res: any) => void
      ) => {
        try {
          const { solicitud_id } = data || {};
          if (!solicitud_id || !userId) {
            callback?.({ error: "Parámetros incompletos para iniciar llamada" });
            return;
          }

          const solicitud = await prisma.solicitudTrabajo.findUnique({
            where: { id: solicitud_id },
            include: {
              cliente: {
                select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
              },
              servicio: {
                select: {
                  profesional_id: true,
                  profesional: {
                    include: {
                      usuario: {
                        select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
                      },
                      oficios: true,
                    },
                  },
                },
              },
            },
          });

          if (!solicitud) {
            socket.emit("call:error", { mensaje: "Solicitud no encontrada" });
            callback?.({ error: "Solicitud no encontrada" });
            return;
          }

          const esCliente = solicitud.cliente_id === userId;
          const esProfesional = solicitud.servicio?.profesional_id === userId;

          if (!esCliente && !esProfesional) {
            socket.emit("call:error", {
              mensaje: "No tienes autorización para iniciar videollamada en este chat",
            });
            callback?.({ error: "No autorizado" });
            return;
          }

          const estadoActual = (solicitud.estado_solicitud_trabajo || "").toUpperCase();
          if (ESTADOS_BLOQUEADOS.includes(estadoActual)) {
            const errorMsg = `No se puede iniciar la llamada: la conversación se encuentra cerrada o en estado ${estadoActual}.`;
            socket.emit("call:error", { mensaje: errorMsg });
            callback?.({ error: errorMsg });
            return;
          }

          const recipientId = esCliente
            ? solicitud.servicio.profesional_id
            : solicitud.cliente_id;

          const callerData = esCliente
            ? {
              id: solicitud.cliente.id,
              name: `${solicitud.cliente.nombre} ${solicitud.cliente.apellido}`.trim(),
              avatar: solicitud.cliente.foto_perfil,
              role: "CLIENTE" as const,
            }
            : {
              id: solicitud.servicio.profesional.usuario.id,
              name: `${solicitud.servicio.profesional.usuario.nombre} ${solicitud.servicio.profesional.usuario.apellido}`.trim(),
              avatar: solicitud.servicio.profesional.usuario.foto_perfil,
              role: "PROFESIONAL" as const,
            };

          const salaDaily = await DailyService.crearSalaEfimera({
            solicitudId: solicitud.id,
            duracionMinutos: 60,
          });

          const sesion = await prisma.sesionVideollamada.create({
            data: {
              solicitud_id,
              proveedor_id: salaDaily.url,
              hora_inicio: new Date(),
            },
          });

          const llamada: LlamadaActiva = {
            solicitud_id,
            caller_id: userId,
            caller_socket_id: socket.id,
            recipient_id: recipientId,
            room_url: salaDaily.url,
            room_name: salaDaily.name,
            sesion_id: sesion.id,
            iniciado_en: new Date(),
            estado: "invitando",
          };

          llamadasActivas.set(solicitud_id, llamada);
          socketToSolicitudLlamada.set(socket.id, solicitud_id);

          const roomName = `solicitud_${solicitud_id}`;

          socket.to(roomName).emit("call:invite", {
            solicitud_id,
            roomUrl: salaDaily.url,
            roomName: salaDaily.name,
            caller: callerData,
            sesion_id: sesion.id,
          });

          socket.emit("call:ringing", {
            solicitud_id,
            roomUrl: salaDaily.url,
            roomName: salaDaily.name,
            sesion_id: sesion.id,
          });

          callback?.({
            ok: true,
            roomUrl: salaDaily.url,
            roomName: salaDaily.name,
            sesion_id: sesion.id,
          });
        } catch (error: any) {
          console.error("Error en call:invite:", error.message);
          callback?.({ error: "Error interno al iniciar videollamada" });
        }
      }
    );

    /**
     * El receptor acepta la videollamada entrante
     */
    socket.on("call:accept", (data: { solicitud_id: string }) => {
      try {
        const { solicitud_id } = data || {};
        if (!solicitud_id) return;

        const llamada = llamadasActivas.get(solicitud_id);
        if (llamada) {
          llamada.estado = "conectada";
          llamada.recipient_socket_id = socket.id;
          socketToSolicitudLlamada.set(socket.id, solicitud_id);

          const roomName = `solicitud_${solicitud_id}`;
          io.to(roomName).emit("call:accepted", {
            solicitud_id,
            roomUrl: llamada.room_url,
            roomName: llamada.room_name,
            sesion_id: llamada.sesion_id,
          });
        }
      } catch (err: any) {
        console.error("Error en call:accept:", err.message);
      }
    });

    /**
     * El receptor rechaza la videollamada
     */
    socket.on(
      "call:reject",
      async (data: { solicitud_id: string; reason?: string }) => {
        try {
          const { solicitud_id, reason } = data || {};
          if (!solicitud_id) return;

          const llamada = llamadasActivas.get(solicitud_id);
          const roomName = `solicitud_${solicitud_id}`;

          io.to(roomName).emit("call:rejected", {
            solicitud_id,
            reason: reason || "Llamada rechazada",
          });

          const senderId = userId || llamada?.caller_id;
          if (senderId) {
            try {
              const msgRechazo = await prisma.mensajeChat.create({
                data: {
                  solicitud_id,
                  remitente_id: senderId,
                  contenido: "📞 Videollamada rechazada",
                  leido: false,
                },
                include: {
                  remitente: {
                    select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
                  },
                },
              });
              io.to(roomName).emit("nuevo_mensaje", msgRechazo);
              io.to(roomName).emit("mensaje_recibido", msgRechazo);
            } catch (e: any) {
              console.warn("No se pudo registrar mensaje de llamada rechazada:", e.message);
            }
          }

          if (llamada) {
            if (llamada.sesion_id) {
              await prisma.sesionVideollamada
                .update({
                  where: { id: llamada.sesion_id },
                  data: { hora_fin: new Date(), duracion_segundos: 0 },
                })
                .catch(() => { });
            }

            llamadasActivas.delete(solicitud_id);
            socketToSolicitudLlamada.delete(socket.id);
            if (llamada.caller_socket_id) {
              socketToSolicitudLlamada.delete(llamada.caller_socket_id);
            }
            if (llamada.recipient_socket_id) {
              socketToSolicitudLlamada.delete(llamada.recipient_socket_id);
            }
          }
        } catch (err: any) {
          console.error("Error en call:reject:", err.message);
        }
      }
    );

    /**
     * Finaliza la videollamada en curso y persiste la duración
     */
    socket.on("call:end", async (data: { solicitud_id: string; duracion?: number }) => {
      try {
        const { solicitud_id, duracion: duracionParam } = data || {};
        if (!solicitud_id) return;

        const llamada = llamadasActivas.get(solicitud_id);
        const roomName = `solicitud_${solicitud_id}`;

        let duracion = duracionParam ?? 0;
        if (!duracion && llamada) {
          duracion = Math.max(
            0,
            Math.round((Date.now() - llamada.iniciado_en.getTime()) / 1000)
          );
        }

        if (llamada) {
          if (llamada.sesion_id) {
            await prisma.sesionVideollamada
              .update({
                where: { id: llamada.sesion_id },
                data: { hora_fin: new Date(), duracion_segundos: duracion },
              })
              .catch(() => { });
          }

          llamadasActivas.delete(solicitud_id);
          socketToSolicitudLlamada.delete(socket.id);
          if (llamada.caller_socket_id) {
            socketToSolicitudLlamada.delete(llamada.caller_socket_id);
          }
          if (llamada.recipient_socket_id) {
            socketToSolicitudLlamada.delete(llamada.recipient_socket_id);
          }
        }

        io.to(roomName).emit("call:ended", {
          solicitud_id,
          duracion,
          finalizado_por: userId,
        });

        let resumenTexto = "";
        if (duracion > 0) {
          const mins = Math.floor(duracion / 60);
          const secs = duracion % 60;
          const tiempoStr = mins > 0 ? `${mins} min ${secs} seg` : `${secs} seg`;
          resumenTexto = `📞 Videollamada de Diagnóstico finalizada · ${tiempoStr}`;
        } else if (llamada?.estado === "conectada") {
          resumenTexto = `📞 Videollamada de Diagnóstico finalizada`;
        } else {
          resumenTexto = "📞 Videollamada perdida / cancelada";
        }

        let endSenderId = userId || llamada?.caller_id;
        if (!endSenderId) {
          const sol = await prisma.solicitudTrabajo.findUnique({
            where: { id: solicitud_id },
            select: { cliente_id: true },
          });
          endSenderId = sol?.cliente_id;
        }

        if (resumenTexto && endSenderId) {
          try {
            const msgFin = await prisma.mensajeChat.create({
              data: {
                solicitud_id,
                remitente_id: endSenderId,
                contenido: resumenTexto,
                leido: false,
              },
              include: {
                remitente: {
                  select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
                },
              },
            });
            io.to(roomName).emit("nuevo_mensaje", msgFin);
            io.to(roomName).emit("mensaje_recibido", msgFin);
          } catch (e: any) {
            console.warn("No se pudo registrar mensaje resumen de llamada:", e.message);
          }
        }
      } catch (err: any) {
        console.error("Error en call:end:", err.message);
      }
    });

    /**
     * Gestión de desconexión del socket (Teardown automático si estaba en llamada)
     */
    socket.on("disconnect", async () => {
      console.log(`🔌 [Socket.io] Usuario desconectado: ${userId}`);

      const solicitudId = socketToSolicitudLlamada.get(socket.id);
      if (solicitudId) {
        setTimeout(async () => {
          const llamada = llamadasActivas.get(solicitudId);
          if (llamada && (llamada.caller_socket_id === socket.id || llamada.recipient_socket_id === socket.id)) {
            const roomName = `solicitud_${solicitudId}`;
            try {
              const socketsInRoom = await io.in(roomName).fetchSockets();
              const sigueEnSala = socketsInRoom.some((s: any) => s.user?.userId === userId);
              if (sigueEnSala) {
                console.log(`🔌 [Socket.io] Usuario ${userId} sigue presente con otro socket. Manteniendo llamada.`);
                return;
              }
            } catch (_) { }

            console.log(`🔌 [Socket.io] Usuario ${userId} ausente tras tolerancia. Finalizando llamada.`);
            llamada.estado = "finalizada";
            const duracion = Math.max(
              0,
              Math.round((Date.now() - llamada.iniciado_en.getTime()) / 1000)
            );

            if (llamada.sesion_id) {
              await prisma.sesionVideollamada
                .update({
                  where: { id: llamada.sesion_id },
                  data: { hora_fin: new Date(), duracion_segundos: duracion },
                })
                .catch(() => { });
            }

            io.to(roomName).emit("call:ended", {
              solicitud_id: solicitudId,
              duracion,
              motivo: "El interlocutor se ha desconectado de la red",
            });

            const discSenderId = userId || llamada.caller_id;
            if (discSenderId) {
              try {
                const mins = Math.floor(duracion / 60);
                const secs = duracion % 60;
                const durTxt = mins > 0 ? `${mins} min ${secs} seg` : `${secs} seg`;
                const msgDesc = await prisma.mensajeChat.create({
                  data: {
                    solicitud_id: solicitudId,
                    remitente_id: discSenderId,
                    contenido: `📞 Videollamada finalizada por desconexión de red · ${durTxt}`,
                    leido: false,
                  },
                  include: {
                    remitente: {
                      select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
                    },
                  },
                });
                io.to(roomName).emit("nuevo_mensaje", msgDesc);
                io.to(roomName).emit("mensaje_recibido", msgDesc);
              } catch (_) { }
            }

            llamadasActivas.delete(solicitudId);
          }
        }, 6000);

        socketToSolicitudLlamada.delete(socket.id);
      }
    });
  });
};
