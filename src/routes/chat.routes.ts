import { Router } from "express";
import multer from "multer";
import { verifyToken } from "../middlewares/auth.middleware";
import {
  obtenerMisConversaciones,
  iniciarConversacion,
  obtenerHistorialChat,
  subirAdjuntoChat,
  obtenerSugerenciasIA,
  responderPropuestaVisita,
} from "../controllers/chat.controller";


const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "application/octet-stream" ||
      file.originalname.match(/\.(jpg|jpeg|png|webp|gif|mp3|wav|m4a|webm|ogg|aac)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos de imagen o audio"));
    }
  },
});

router.use(verifyToken);

router.post("/iniciar", iniciarConversacion);

router.get("/conversaciones", obtenerMisConversaciones);

router.get("/:solicitud_id/mensajes", obtenerHistorialChat);

router.post(
  "/:solicitud_id/adjunto",
  upload.fields([
    { name: "foto", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "adjunto", maxCount: 1 },
  ]),
  subirAdjuntoChat
);

router.get("/:solicitud_id/sugerencias-ia", obtenerSugerenciasIA);

router.put("/:solicitud_id/propuesta/:mensaje_id", responderPropuestaVisita);

export default router;

