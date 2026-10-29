import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";
import { supabase } from "../config/supabase";

const ESTADOS_BLOQUEADOS = ["FINALIZADO", "DISPUTA", "RECHAZADO"];

/**
 * Obtiene la lista de solicitudes/conversaciones del usuario actual
 */
export const obtenerMisConversaciones = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const solicitudes = await prisma.solicitudTrabajo.findMany({
      where: {
        OR: [
          { cliente_id: userId },
          { servicio: { profesional_id: userId } },
        ],
      },
      include: {
        cliente: {
          select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
        },
        servicio: {
          include: {
            profesional: {
              include: {
                usuario: {
                  select: { id: true, nombre: true, apellido: true, foto_perfil: true, rol: true },
                },
              },
            },
            oficio: true,
          },
        },
        mensajes: {
          orderBy: { enviado_en: "desc" },
          take: 1,
        },
      },
      orderBy: { actualizado_en: "desc" },
    });

    const conversaciones = solicitudes.map((s) => {
      const ultimoMensaje = s.mensajes[0];

      const clientParticipant = {
        id: s.cliente.id,
        name: `${s.cliente.nombre} ${s.cliente.apellido}`.trim(),
        profession: "Cliente",
        avatar:
          s.cliente.foto_perfil ||
          "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200",
        isVerified: true,
        role: "CLIENTE" as const,
      };

      const proUser = s.servicio.profesional.usuario;
      const proParticipant = {
        id: s.servicio.profesional_id,
        name: `${proUser.nombre} ${proUser.apellido}`.trim(),
        profession: s.servicio.oficio?.nombre_oficio || s.servicio.titulo_servicio,
        avatar:
          proUser.foto_perfil ||
          "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200",
        isVerified: true,
        role: "PROFESIONAL" as const,
      };

      return {
        id: s.id,
        client: clientParticipant,
        professional: proParticipant,
        lastMessage: ultimoMensaje
          ? ultimoMensaje.adjunto_url
            ? ultimoMensaje.contenido?.includes("🎤") ||
              ultimoMensaje.adjunto_url.match(/\.(webm|mp3|wav|m4a|ogg|aac)($|\?)/i)
              ? "Mensaje de voz"
              : "Foto adjunta"
            : ultimoMensaje.contenido.startsWith("[PROPUESTA_VISITA]:")
              ? "Propuesta de Visita y Presupuesto"
              : ultimoMensaje.contenido
          : "Sin mensajes aún",
        timestamp: ultimoMensaje
          ? new Date(ultimoMensaje.enviado_en).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
          : "Nuevo",
        unreadCount: 0,
        status:
          s.estado_solicitud_trabajo === "FINALIZADO"
            ? "COMPLETADO"
            : "EN PROGRESO",
        escrowStatus: "HELD" as const,
        escrowAmount: `$${s.servicio.costo_estimado}`,
        messages: [],
      };
    });

    res.json({ conversaciones });
  } catch (error: any) {
    console.error("Error al obtener mis conversaciones:", error.message);
    res.status(500).json({ error: "Error al recuperar conversaciones" });
  }
};

/**
 * Inicia o recupera una conversación entre el cliente autenticado y un profesional
 */
export const iniciarConversacion = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { profesional_id, primer_mensaje } = req.body;

    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    if (!profesional_id) {
      res.status(400).json({ error: "Se requiere el ID del profesional" });
      return;
    }

    if (userId === profesional_id) {
      res.status(400).json({
        error: "No puedes iniciar una conversación contigo mismo.",
      });
      return;
    }

    const pro = await prisma.profesional.findUnique({
      where: { id: profesional_id },
      include: {
        oficios: true,
        servicios_publicados: {
          where: { servicio_activo: true },
        },
      },
    });

    if (!pro) {
      res.status(404).json({ error: "Profesional no encontrado" });
      return;
    }

    if (pro.id === userId) {
      res.status(400).json({
        error: "No puedes iniciar una conversación contigo mismo.",
      });
      return;
    }

    let servicioId = pro.servicios_publicados[0]?.id;
    if (!servicioId) {
      const anyServicio = await prisma.servicioPublicado.findFirst({
        where: { profesional_id: pro.id },
      });
      if (anyServicio) {
        servicioId = anyServicio.id;
      } else {
        let oficioId = pro.oficios[0]?.id;
        if (!oficioId) {
          const primerOficio = await prisma.oficio.findFirst();
          oficioId = primerOficio?.id ?? 1;
        }

        const nuevoServicio = await prisma.servicioPublicado.create({
          data: {
            profesional_id: pro.id,
            oficio_id: oficioId,
            titulo_servicio: "Consulta y Presupuesto",
            descripcion_servicio: "Consulta inicial para coordinar detalles y presupuesto.",
            costo_estimado: 0,
            duracion_estimada: "30 min",
            fotos_servicio: [],
            servicio_activo: true,
          },
        });
        servicioId = nuevoServicio.id;
      }
    }

    let solicitud = await prisma.solicitudTrabajo.findFirst({
      where: {
        cliente_id: userId,
        servicio: { profesional_id: pro.id },
      },
      orderBy: { actualizado_en: "desc" },
    });

    if (!solicitud) {
      solicitud = await prisma.solicitudTrabajo.create({
        data: {
          cliente_id: userId,
          servicio_id: servicioId,
          fecha_solicitada: new Date(),
          estado_solicitud_trabajo: "ACEPTADO",
        },
      });
    }

    if (primer_mensaje && primer_mensaje.trim()) {
      await prisma.mensajeChat.create({
        data: {
          solicitud_id: solicitud.id,
          remitente_id: userId,
          contenido: primer_mensaje.trim(),
          leido: false,
        },
      });
    }

    res.json({
      mensaje: "Conversación iniciada con éxito",
      solicitud_id: solicitud.id,
    });
  } catch (error: any) {
    console.error("Error al iniciar conversación:", error.message);
    res.status(500).json({ error: "Error interno al iniciar la conversación" });
  }
};


/**
 * Recupera el historial de la conversación filtrado por solicitud_id
 */
export const obtenerHistorialChat = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { solicitud_id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const solicitud = await prisma.solicitudTrabajo.findUnique({
      where: { id: solicitud_id },
      include: {
        servicio: { select: { profesional_id: true } },
      },
    });

    if (!solicitud) {
      res.status(404).json({ error: "Solicitud de trabajo no encontrada" });
      return;
    }

    const esCliente = solicitud.cliente_id === userId;
    const esProfesional = solicitud.servicio?.profesional_id === userId;

    if (!esCliente && !esProfesional) {
      res.status(403).json({ error: "Acceso denegado a este chat" });
      return;
    }

    const estadoSolicitud = (solicitud.estado_solicitud_trabajo || "").toUpperCase();
    const bloqueado = ESTADOS_BLOQUEADOS.includes(estadoSolicitud);

    const mensajes = await prisma.mensajeChat.findMany({
      where: { solicitud_id },
      orderBy: { enviado_en: "asc" },
      select: {
        id: true,
        solicitud_id: true,
        remitente_id: true,
        contenido: true,
        adjunto_url: true,
        enviado_en: true,
        leido: true,
      },
    });

    res.json({
      solicitud_id,
      estado_solicitud: estadoSolicitud,
      bloqueado,
      mensajes,
    });
  } catch (error: any) {
    console.error("Error al obtener historial de chat:", error.message);
    res.status(500).json({ error: "Error interno al recuperar el historial" });
  }
};

/**
 * Sube una imagen adjunta a Supabase Storage y retorna su URL pública
 */
export const subirAdjuntoChat = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { solicitud_id } = req.params;
    const userId = req.user?.userId;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const file =
      req.file ||
      (files && files["audio"]?.[0]) ||
      (files && files["foto"]?.[0]) ||
      (files && files["adjunto"]?.[0]) ||
      (Array.isArray(req.files) ? (req.files[0] as Express.Multer.File) : undefined);

    if (!file) {
      res.status(400).json({ error: "No se proporcionó ningún archivo de imagen o audio" });
      return;
    }

    const solicitud = await prisma.solicitudTrabajo.findUnique({
      where: { id: solicitud_id },
      include: { servicio: { select: { profesional_id: true } } },
    });

    if (!solicitud) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    const esCliente = solicitud.cliente_id === userId;
    const esProfesional = solicitud.servicio?.profesional_id === userId;

    if (!esCliente && !esProfesional) {
      res.status(403).json({ error: "Acceso denegado a este chat" });
      return;
    }

    const estadoSolicitud = (solicitud.estado_solicitud_trabajo || "").toUpperCase();
    if (ESTADOS_BLOQUEADOS.includes(estadoSolicitud)) {
      res.status(403).json({
        error: "El chat está bloqueado debido al estado de la solicitud",
        estado_solicitud: estadoSolicitud,
      });
      return;
    }

    const bucketName = "chat-adjuntos";

    try {
      await supabase.storage.createBucket(bucketName, { public: true });
    } catch (_) {
    }

    const isAudio =
      file.mimetype.startsWith("audio/") ||
      Boolean(file.originalname.match(/\.(webm|mp3|wav|m4a|ogg|aac)$/i));

    let fileExt = file.originalname.split(".").pop();
    if (!fileExt || fileExt === file.originalname) {
      fileExt = isAudio ? "webm" : "jpg";
    }

    const filePath = `${solicitud_id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const contentType = file.mimetype && file.mimetype !== "application/octet-stream"
      ? file.mimetype
      : isAudio
        ? "audio/webm"
        : "image/jpeg";

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file.buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Error en Supabase Storage:", uploadError.message);
      res.status(500).json({ error: "Error al almacenar el archivo en Supabase" });
      return;
    }

    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(uploadData.path);

    res.json({
      mensaje: "Archivo adjunto subido con éxito",
      adjunto_url: urlData.publicUrl,
    });
  } catch (error: any) {
    console.error("Error en subirAdjuntoChat:", error.message);
    res.status(500).json({ error: "Error al procesar el archivo adjunto" });
  }
};

/**
 * Genera sugerencias contextuales con IA (Gemini) o motor contextual inteligente
 */
export const obtenerSugerenciasIA = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { solicitud_id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const solicitud = await prisma.solicitudTrabajo.findUnique({
      where: { id: solicitud_id },
      include: {
        cliente: { select: { id: true, nombre: true, apellido: true } },
        servicio: {
          select: {
            titulo_servicio: true,
            profesional_id: true,
            profesional: {
              select: {
                usuario: { select: { nombre: true, apellido: true } },
              },
            },
          },
        },
      },
    });

    if (!solicitud) {
      res.status(404).json({ error: "Solicitud de trabajo no encontrada" });
      return;
    }

    const esCliente = solicitud.cliente_id === userId;
    const esProfesional = solicitud.servicio?.profesional_id === userId;

    if (!esCliente && !esProfesional) {
      res.status(403).json({ error: "Acceso denegado a esta solicitud" });
      return;
    }

    const rol = esCliente ? "CLIENTE" : "PROFESIONAL";
    const otroNombre = esCliente
      ? solicitud.servicio?.profesional?.usuario?.nombre || "Profesional"
      : solicitud.cliente?.nombre || "Cliente";

    const ultimosMensajes = await prisma.mensajeChat.findMany({
      where: { solicitud_id },
      orderBy: { enviado_en: "desc" },
      take: 5,
    });
    ultimosMensajes.reverse();

    const seed = parseInt(req.query.variacion as string || "0", 10) || 0;

    const seleccionar = (pool: string[], salt: number): string[] => {
      if (pool.length <= 3) return pool;
      const start = (Math.abs(salt) * 3) % pool.length;
      const result: string[] = [];
      for (let i = 0; i < 3; i++) {
        result.push(pool[(start + i) % pool.length]);
      }
      return result;
    };

    const ultimoDelOtro = [...ultimosMensajes]
      .reverse()
      .find((m) => m.remitente_id !== userId);

    const ultimoMensaje = ultimoDelOtro || ultimosMensajes[ultimosMensajes.length - 1];
    const ultimoTexto = (ultimoMensaje?.contenido || "").toLowerCase();

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey && apiKey !== "" && apiKey !== "undefined") {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Eres el asistente de ExpertoYa, una app de oficios a domicilio.
El usuario que va a responder es: ${rol} (${esCliente ? "Cliente que contrató el servicio" : "Profesional técnico"}).
Interlocutor: ${otroNombre}.
Oficio / Servicio: ${solicitud.servicio?.titulo_servicio || "Oficio a domicilio"}.
Historial de los últimos mensajes:
${ultimosMensajes
            .map(
              (m) =>
                `${m.remitente_id === userId ? "Yo" : otroNombre}: "${m.contenido}"`
            )
            .join("\n")}

Genera exactamente 3 sugerencias de respuesta breves (máximo 10 palabras cada una), en español rioplatense/latinoamericano natural, sumamente educadas y pertinentes para responder al interlocutor.
Devuelve ÚNICAMENTE un JSON válido con este formato exacto:
{"sugerencias": ["texto 1", "texto 2", "texto 3"]}`;

        const geminiRes = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json", temperature: 0.4 },
        });

        const respuestaTexto = geminiRes.text?.trim() || "";
        const parsed = JSON.parse(respuestaTexto);
        if (Array.isArray(parsed?.sugerencias) && parsed.sugerencias.length > 0) {
          res.json({
            origen: "gemini_ai",
            sugerencias: parsed.sugerencias.slice(0, 3),
          });
          return;
        }
      } catch (geminiErr: any) {
        console.warn("Fallo o timeout en Gemini IA:", geminiErr?.message);
      }
    }

    let pool: string[] = [];

    const esEnCaminoOSaliendo =
      ultimoTexto.includes("saliendo") ||
      ultimoTexto.includes("en camino") ||
      ultimoTexto.includes("yendo") ||
      ultimoTexto.includes("voy para") ||
      ultimoTexto.includes("te aviso cuando") ||
      ultimoTexto.includes("avisame cuando") ||
      ultimoTexto.includes("estoy cerca") ||
      ultimoTexto.includes("llegando") ||
      ultimoTexto.includes("llego en") ||
      ultimoTexto.includes("en la puerta") ||
      ultimoTexto.includes("en viaje")
    const esPreguntaHorarioOVisita =
      ultimoTexto.includes("¿cuándo") ||
      ultimoTexto.includes("cuando podés") ||
      ultimoTexto.includes("cuando podes") ||
      ultimoTexto.includes("cuándo podés") ||
      ultimoTexto.includes("a qué hora") ||
      ultimoTexto.includes("a que hora") ||
      ultimoTexto.includes("qué día") ||
      ultimoTexto.includes("que dia") ||
      ultimoTexto.includes("horario") ||
      ultimoTexto.includes("disponibilidad") ||
      ultimoTexto.includes("podrías hoy") ||
      ultimoTexto.includes("podrias hoy") ||
      (ultimoTexto.includes("?") && (
        ultimoTexto.includes("venir") ||
        ultimoTexto.includes("pasar") ||
        ultimoTexto.includes("hoy") ||
        ultimoTexto.includes("mañana")
      ));

    const esPresupuestoOCosto =
      ultimoTexto.includes("presupuesto") ||
      ultimoTexto.includes("precio") ||
      ultimoTexto.includes("costo") ||
      ultimoTexto.includes("cuánto") ||
      ultimoTexto.includes("cuanto") ||
      ultimoTexto.includes("tarifa") ||
      ultimoTexto.includes("mano de obra") ||
      ultimoTexto.includes("repuesto") ||
      ultimoTexto.includes("cobras") ||
      ultimoTexto.includes("cobrás") ||
      ultimoTexto.includes("$");

    const esFotosOFalla =
      ultimoTexto.includes("foto") ||
      ultimoTexto.includes("imagen") ||
      ultimoTexto.includes("cámara") ||
      ultimoTexto.includes("camara") ||
      ultimoTexto.includes("adjunt") ||
      ultimoTexto.includes("cañería") ||
      ultimoTexto.includes("cañeria") ||
      ultimoTexto.includes("cable") ||
      ultimoTexto.includes("falla") ||
      ultimoTexto.includes("pérdida") ||
      ultimoTexto.includes("perdida") ||
      ultimoTexto.includes("roto") ||
      ultimoTexto.includes("rota");

    const esAgradecimientoOConfirmacion =
      ultimoTexto.includes("gracias") ||
      ultimoTexto.includes("muchas gracias") ||
      ultimoTexto.includes("excelente") ||
      ultimoTexto.includes("perfecto") ||
      ultimoTexto.includes("genial") ||
      ultimoTexto.includes("dale") ||
      ultimoTexto.includes("buenísimo") ||
      ultimoTexto.includes("buenisimo") ||
      ultimoTexto.includes("listo") ||
      ultimoTexto.includes("ok") ||
      ultimoTexto.includes("joya") ||
      ultimoTexto.includes("de diez") ||
      ultimoTexto.includes("quedamos así") ||
      ultimoTexto.includes("quedamos asi");

    if (esEnCaminoOSaliendo) {
      if (esCliente) {
        pool = [
          "¡Dale, te espero!",
          "Buenísimo, acá te espero en el domicilio.",
          "Genial, muchas gracias por avisar.",
          "Perfecto, te espero. Es timbre A.",
          "Avisame cuando estés en la puerta y bajo.",
          "Dale, buen viaje y con cuidado.",
          "Excelente, ya te dejo todo preparado.",
          "Cualquier cosa avisame por acá si te demoras.",
          "Genial, nos vemos en un ratito.",
        ];
      } else {
        pool = [
          "¡Buenísimo, te espero en el lugar!",
          "Dale, avisame cualquier cosa al llegar.",
          "Perfecto, ya tengo todo preparado.",
          "Genial, acá te espero.",
          "Avisame cuando estés afuera.",
          "De diez, te espero tranquilo.",
        ];
      }
    } else if (esPreguntaHorarioOVisita) {
      if (esCliente) {
        pool = [
          "A partir de las 14:00 hs me queda perfecto.",
          "Hoy por la tarde estoy en casa, podés pasar.",
          "¿A qué hora te quedaría más cómodo a vos?",
          "Mañana por la mañana antes de las 12 hs me viene genial.",
          "Cualquier día de esta semana después de las 17 hs.",
          "Si podés hoy mismo, te espero en el domicilio.",
          "¿El sábado por la mañana tendrías disponibilidad?",
          "A la hora que te quede libre, me acomodo sin problema.",
          "Coordinemos para mañana a primera hora.",
        ];
      } else {
        pool = [
          "Puedo pasar hoy mismo entre las 15:00 y las 17:00 hs.",
          "Mañana a primera hora estoy disponible para pasar a revisar.",
          "¿A qué horario estás en el domicilio para coordinar?",
          "Tengo un hueco hoy a las 16:30 hs, ¿te sirve?",
          "Pasame tu dirección exacta y calculo el horario de llegada.",
          "Mañana por la tarde puedo coordinar la visita técnica.",
          "¿Te quedaría bien coordinar para pasado mañana?",
          "Estoy libre hoy a última hora de la tarde.",
          "Coordinemos para el turno de la mañana.",
        ];
      }
    } else if (esFotosOFalla) {
      if (esCliente) {
        pool = [
          "Ya te tomo una foto con la cámara para que veas el detalle.",
          "En la foto se aprecia bien dónde está el problema.",
          "¿Se llega a ver con claridad o te saco otra foto?",
          "Ahí te adjunté la imagen del sector dañado.",
          "Es esa pieza la que pierde agua / hace chispas.",
          "Decime si con esa imagen te das una idea de qué herramienta traer.",
          "Si precisás un video corto avisame y te lo paso.",
          "La pérdida empezó ayer por la noche en esa zona.",
          "Es exactamente lo que se ve en la foto adjunta.",
        ];
      } else {
        pool = [
          "Con esa foto ya veo qué repuesto y herramientas llevar.",
          "¿Podrías enviarme otra foto con más luz o desde más cerca?",
          "Entendido, es una falla habitual, llevo los repuestos.",
          "Por lo que veo en la foto, se resuelve rápido en una visita.",
          "Llevo el juego de llaves y selladores para cambiar esa pieza.",
          "Recibí la foto perfecto, ya tengo un panorama claro del trabajo.",
        ];
      }
    } else if (esPresupuestoOCosto) {
      if (esCliente) {
        pool = [
          "El presupuesto me parece adecuado, avancemos.",
          "¿El valor incluye los repuestos y materiales necesarios?",
          "Perfecto, te confirmo el trabajo con ese monto.",
          "¿Podrías detallarme qué repuestos tendría que comprar?",
          "¿Aceptás transferencia por la app con custodia garantizada?",
          "De acuerdo, coordinemos la visita para empezar.",
          "¿Hacés factura o comprobante del trabajo realizado?",
          "Entendido, me parece un precio muy razonable.",
          "Confirmado el monto, coordinemos día y hora.",
        ];
      } else {
        pool = [
          "El presupuesto aproximado de mano de obra es de $15.000.",
          "Te paso el costo exacto en cuanto revise la falla en persona.",
          "Incluye la revisión técnica y la mano de obra completa.",
          "Los repuestos van aparte, pero te paso el desglose detallado.",
          "Si te parece bien, te armo la cotización formal por acá.",
          "El valor es estimado, sin sorpresas al finalizar.",
          "Te cobro la visita técnica y se descuenta si hacemos el arreglo.",
          "Acepto todos los medios de pago a través de ExpertoYa.",
          "Cualquier consulta sobre el presupuesto, decime sin compromiso.",
        ];
      }
    } else if (esAgradecimientoOConfirmacion) {
      if (esCliente) {
        pool = [
          "¡Genial, te espero entonces! Muchas gracias.",
          "¡Buenísimo, quedamos así! Nos vemos.",
          "Dale, te espero en el horario pactado.",
          "Muchas gracias por la rápida atención.",
          "De diez, cualquier cosa te aviso por acá.",
          "Perfecto, ya dejo todo listo para cuando llegues.",
          "Quedamos así coordinados, un saludo!",
          "Excelente, gracias a vos por la predisposición.",
          "Cualquier cambio de planes te aviso.",
        ];
      } else {
        pool = [
          "¡Por nada! Quedamos así coordinados.",
          "¡De diez, nos vemos en el horario fijado!",
          "Cualquier novedad te escribo por acá antes de salir.",
          "¡Un gusto! Ya agendé tu visita técnica.",
          "Perfecto, llevo los materiales necesarios.",
          "Hasta luego, que tengas buen día.",
          "Quedamos así, un placer ayudarte.",
          "Nos vemos pronto, saludos.",
          "Cualquier consulta previa avisame.",
        ];
      }
    } else {
      if (esCliente) {
        pool = [
          `Hola ${otroNombre}, ¿qué disponibilidad tienes para pasar a revisar?`,
          "¿A qué hora podrías pasar hoy a revisar?",
          "Hola! Quería consultar el presupuesto estimado para este trabajo.",
          "¿Qué herramientas o repuestos necesitarías?",
          "Dale, gracias! Te espero en ese horario.",
          "Buenas tardes, ¿qué días y horarios te quedan cómodos?",
        ];
      } else {
        pool = [
          `¡Hola ${otroNombre}! Sí, contame qué problema tenés y lo coordinamos.`,
          "Estoy en camino al domicilio 🚗",
          "Llego en aproximadamente 15 minutos.",
          "Buenas, ¿podrías indicarme tu zona o enviarme una foto de la falla?",
          "Hola! Tengo disponibilidad para pasar hoy por la tarde a revisar.",
          "Ya revisé el problema, te detallo el presupuesto a continuación.",
        ];
      }
    }

    const sugerencias = seleccionar(pool, seed);

    res.json({
      origen: "contextual_engine",
      sugerencias,
      variacion: seed,
    });
  } catch (error: any) {
    console.error("Error en obtenerSugerenciasIA:", error.message);
    res.json({
      origen: "fallback_engine",
      sugerencias: [
        "¡Dale, te espero!",
        "Buenísimo, acá te espero en el domicilio.",
        "Genial, muchas gracias por avisar.",
      ],
      variacion: 0,
    });
  }
};

/**
 * Actualiza el estado de una propuesta de visita técnica incrustada en el chat
 */
export const responderPropuestaVisita = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { solicitud_id, mensaje_id } = req.params;
    const { nuevo_estado, respuesta_texto } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    if (!["ACEPTADA", "REPROGRAMAR"].includes(nuevo_estado)) {
      res.status(400).json({ error: "Estado no válido. Debe ser ACEPTADA o REPROGRAMAR." });
      return;
    }

    const mensaje = await prisma.mensajeChat.findUnique({
      where: { id: mensaje_id },
    });

    if (!mensaje || mensaje.solicitud_id !== solicitud_id) {
      res.status(404).json({ error: "Mensaje de propuesta no encontrado" });
      return;
    }

    if (!mensaje.contenido.startsWith("[PROPUESTA_VISITA]:")) {
      res.status(400).json({ error: "El mensaje no es una propuesta de visita técnica." });
      return;
    }

    let propuestaData: any = {};
    try {
      propuestaData = JSON.parse(mensaje.contenido.slice("[PROPUESTA_VISITA]:".length));
    } catch {
      res.status(400).json({ error: "Formato de propuesta inválido" });
      return;
    }

    propuestaData.estado = nuevo_estado;
    const nuevoContenido = `[PROPUESTA_VISITA]:${JSON.stringify(propuestaData)}`;

    await prisma.mensajeChat.update({
      where: { id: mensaje_id },
      data: { contenido: nuevoContenido },
    });

    let nuevoMensaje = null;
    if (respuesta_texto && respuesta_texto.trim()) {
      nuevoMensaje = await prisma.mensajeChat.create({
        data: {
          solicitud_id,
          remitente_id: userId,
          contenido: respuesta_texto.trim(),
          leido: false,
        },
      });
    }

    res.json({
      ok: true,
      mensaje_actualizado: {
        id: mensaje_id,
        contenido: nuevoContenido,
      },
      nuevo_mensaje: nuevoMensaje,
    });
  } catch (error: any) {
    console.error("Error al responder propuesta:", error.message);
    res.status(500).json({ error: "Error interno al responder la propuesta" });
  }
};
