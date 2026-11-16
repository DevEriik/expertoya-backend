import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import { subirArchivo } from "../services/storage.service";

/**
 * Configuración de Multer para la subida de imágenes de reseñas:
 * - Almacenamiento en memoria para subir directamente a Supabase Storage.
 * - Límite estricto de máximo 2 fotos por reseña.
 * - Filtro de tipos de archivo MIME (solo imágenes JPEG, PNG, WebP).
 * - Tamaño máximo de 5MB por archivo.
 */
const storage = multer.memoryStorage();

const uploadMulter = multer({
  storage,
  limits: {
    files: 2,
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const tiposPermitidos = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "image/heic",
      "image/heif",
    ];

    const isImageExt = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.originalname);
    const mime = (file.mimetype || "").toLowerCase();
    const isImageMime = tiposPermitidos.includes(mime) || mime.startsWith("image/");

    if (isImageExt || isImageMime) {
      // Normalizar el mimetype si vino genérico o como application/octet-stream desde React Native / Web
      if (!file.mimetype || file.mimetype === "application/octet-stream") {
        const ext = file.originalname.split(".").pop()?.toLowerCase();
        file.mimetype =
          ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";
      }
      cb(null, true);
    } else {
      console.log(
        `[Multer Reseña Rechazó] MimeType que llegó: "${file.mimetype}" | Nombre: "${file.originalname}"`
      );
      cb(
        new Error(
          "Formato de archivo inválido: solo se admiten imágenes JPG, PNG o WebP."
        )
      );
    }
  },
}).array("fotos", 2);

/**
 * Middleware para capturar y normalizar errores de Multer:
 * Retorna 400 Bad Request cuando se excede el límite de 2 fotos o el formato es incorrecto.
 */
export const uploadResenaFotosMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    return next();
  }

  uploadMulter(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (
          err.code === "LIMIT_UNEXPECTED_FILE" ||
          err.code === "LIMIT_FILE_COUNT"
        ) {
          res.status(400).json({
            error: "Máximo de fotos excedido",
            detalle: "Solo se permite adjuntar hasta 2 fotos por reseña.",
          });
          return;
        }
        res.status(400).json({
          error: "Error al procesar archivos adjuntos",
          detalle: err.message,
        });
        return;
      }
      res.status(400).json({
        error: "Archivo no admitido",
        detalle: err.message || "Las imágenes no cumplen con los requisitos.",
      });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length > 2) {
      res.status(400).json({
        error: "Máximo de fotos excedido",
        detalle: "Solo se permite adjuntar hasta 2 fotos por reseña.",
      });
      return;
    }

    next();
  });
};

/**
 * POST /api/reviews
 * Crea una reseña aplicando validación Closed-Loop e inmutabilidad estricta.
 * Protegido para rol CLIENTE.
 */
export const crearResena = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const clienteId = req.user?.userId;
    if (!clienteId) {
      res.status(401).json({ error: "Usuario no autenticado" });
      return;
    }

    const { solicitudId, calificacion, comentario } = req.body;

    if (!solicitudId || typeof solicitudId !== "string") {
      res
        .status(400)
        .json({ error: "El campo 'solicitudId' es obligatorio." });
      return;
    }

    const calificacionNum = parseInt(calificacion, 10);
    if (
      isNaN(calificacionNum) ||
      calificacionNum < 1 ||
      calificacionNum > 5
    ) {
      res.status(400).json({
        error: "Calificación inválida",
        detalle: "La calificación debe ser un número entero entre 1 y 5 estrellas.",
      });
      return;
    }

    // VALIDACIÓN CLOSED-LOOP (Circuito Cerrado Transaccional)
    const solicitud = await prisma.solicitudTrabajo.findUnique({
      where: { id: solicitudId },
      include: {
        servicio: {
          select: {
            profesional_id: true,
            titulo_servicio: true,
          },
        },
        pagos: {
          select: {
            id: true,
            estado_pago: true,
          },
        },
        resena: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!solicitud) {
      res.status(404).json({ error: "Solicitud de trabajo no encontrada." });
      return;
    }

    // 1) Pertenencia: la solicitud debe pertenecer al cliente autenticado
    if (solicitud.cliente_id !== clienteId) {
      res.status(403).json({
        error: "Acceso denegado",
        detalle: "No puedes calificar un servicio que no te pertenece.",
      });
      return;
    }

    // 2) Estado de la solicitud: debe ser 'FINALIZADA' / 'FINALIZADO'
    const estadoSolicitud = String(
      solicitud.estado_solicitud_trabajo
    ).toUpperCase();
    if (
      estadoSolicitud !== "FINALIZADO" &&
      estadoSolicitud !== "FINALIZADA"
    ) {
      res.status(400).json({
        error: "Estado no válido para reseña",
        detalle: `Solo se pueden calificar trabajos completados. Estado actual: '${estadoSolicitud}'.`,
      });
      return;
    }

    // 3) Estado de la transacción: el pago debe estar en estado 'LIBERADO'
    const tienePagoLiberado = solicitud.pagos.some(
      (p) => String(p.estado_pago).toUpperCase() === "LIBERADO"
    );
    if (!tienePagoLiberado) {
      res.status(400).json({
        error: "Transacción no liberada",
        detalle:
          "El pago del servicio debe encontrarse 'LIBERADO' por el sistema de custodia (Escrow) para emitir una calificación.",
      });
      return;
    }

    // 4) Garantía de calificación única: sin reseña previa (Inmutabilidad Closed-Loop)
    if (solicitud.resena) {
      res.status(409).json({
        error: "Reseña ya existente",
        detalle:
          "Ya existe una calificación registrada para este trabajo. Nuestro sistema cerrado garantiza una única reseña inmutable por servicio concretado.",
      });
      return;
    }

    const profesionalId = solicitud.servicio.profesional_id;

    // Subida de archivos a Supabase Storage (carpeta 'resenas')
    const files = (req.files as Express.Multer.File[]) || [];
    const fotosUrls: string[] = [];

    for (const file of files) {
      try {
        const publicUrl = await subirArchivo(file, "resenas");
        fotosUrls.push(publicUrl);
      } catch (uploadError: any) {
        console.error(
          "[crearResena] Error al subir foto a Supabase:",
          uploadError.message
        );
        res.status(500).json({
          error: "Error al almacenar las imágenes",
          detalle: uploadError.message,
        });
        return;
      }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Crear la reseña inmutable
      const nuevaResena = await tx.resena.create({
        data: {
          solicitudId: solicitud.id,
          clienteId,
          profesionalId,
          calificacion: calificacionNum,
          comentario: comentario ? String(comentario).trim() : null,
          fotosUrls,
        },
        include: {
          cliente: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              foto_perfil: true,
            },
          },
        },
      });

      // 2. Recalcular promedio y total en base a todas las reseñas del profesional
      const metricas = await tx.resena.aggregate({
        where: { profesionalId },
        _avg: { calificacion: true },
        _count: { id: true },
      });

      const nuevoPromedio = metricas._avg.calificacion
        ? Math.round(metricas._avg.calificacion * 10) / 10
        : calificacionNum;
      const nuevoTotal = metricas._count.id;

      // 3. Actualizar campos cacheados en el Perfil del Profesional
      await tx.profesional.update({
        where: { id: profesionalId },
        data: {
          calificacionPromedio: nuevoPromedio,
          totalResenas: nuevoTotal,
        },
      });

      return {
        resena: nuevaResena,
        calificacionPromedio: nuevoPromedio,
        totalResenas: nuevoTotal,
      };
    });

    res.status(201).json({
      message: "Reseña registrada con éxito.",
      data: resultado.resena,
      metricas: {
        calificacionPromedio: resultado.calificacionPromedio,
        totalResenas: resultado.totalResenas,
      },
    });
  } catch (error: any) {
    console.error("[crearResena] Error interno:", error);
    res.status(500).json({
      error: "Error al procesar la reseña",
      detalle: error.message || "Error interno del servidor.",
    });
  }
};

/**
 * POST /api/reviews/:id/reply
 * Permite al profesional responder por única vez a una reseña recibida.
 * Protegido para rol PROFESIONAL.
 */
export const responderResena = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const profesionalId = req.user?.userId;
    if (!profesionalId) {
      res.status(401).json({ error: "Usuario no autenticado" });
      return;
    }

    const { id } = req.params;
    const { respuesta } = req.body;

    if (!respuesta || typeof respuesta !== "string" || !respuesta.trim()) {
      res.status(400).json({
        error: "El texto de la réplica es obligatorio.",
      });
      return;
    }

    const resena = await prisma.resena.findUnique({
      where: { id },
    });

    if (!resena) {
      res.status(404).json({ error: "Reseña no encontrada." });
      return;
    }

    // Verificar que la reseña corresponde al profesional autenticado
    if (resena.profesionalId !== profesionalId) {
      res.status(403).json({
        error: "Acceso denegado",
        detalle: "Solo el profesional aludido puede emitir una réplica.",
      });
      return;
    }

    // Inmutabilidad de la réplica: solo se permite responder si respuestaProfesional es null
    if (resena.respuestaProfesional !== null) {
      res.status(409).json({
        error: "Réplica ya existente",
        detalle:
          "Esta reseña ya cuenta con una respuesta registrada. Las réplicas son inmutables y de única vez.",
      });
      return;
    }

    const resenaActualizada = await prisma.resena.update({
      where: { id },
      data: {
        respuestaProfesional: respuesta.trim(),
        fechaRespuesta: new Date(),
      },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            foto_perfil: true,
          },
        },
      },
    });

    res.status(200).json({
      message: "Respuesta publicada exitosamente.",
      data: resenaActualizada,
    });
  } catch (error: any) {
    console.error("[responderResena] Error interno:", error);
    res.status(500).json({
      error: "Error al publicar respuesta",
      detalle: error.message || "Error interno del servidor.",
    });
  }
};

/**
 * GET /api/professionals/:id/reviews
 * Endpoint público y paginado que devuelve las opiniones reales de los clientes
 * ordenadas en forma descendente por fecha de creación.
 */
export const obtenerResenasProfesional = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string, 10) || 10)
    );
    const skip = (page - 1) * limit;

    const [resenas, total, profesional] = await Promise.all([
      prisma.resena.findMany({
        where: { profesionalId: id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          cliente: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              foto_perfil: true,
            },
          },
        },
      }),
      prisma.resena.count({
        where: { profesionalId: id },
      }),
      prisma.profesional.findUnique({
        where: { id },
        select: {
          calificacionPromedio: true,
          totalResenas: true,
        },
      }),
    ]);

    const calificacionPromedio = profesional?.calificacionPromedio ?? 0;
    const totalResenas = profesional?.totalResenas ?? total;

    res.status(200).json({
      ok: true,
      data: {
        resenas,
        stats: {
          calificacionPromedio,
          totalResenas,
        },
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error: any) {
    console.error("[obtenerResenasProfesional] Error interno:", error);
    res.status(500).json({
      error: "Error al consultar las reseñas",
      detalle: error.message || "Error interno del servidor.",
    });
  }
};

