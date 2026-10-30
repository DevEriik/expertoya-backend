import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import {
  analizarProblemaVisual,
  generateDescription,
} from "../controllers/ia.controller";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const uploadSingle = upload.single("imagen");
  uploadSingle(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "La imagen es demasiado grande. El máximo permitido es 5MB.",
        });
      }
      return res.status(400).json({ error: "Error al subir la imagen." });
    } else if (err) {
      return res
        .status(500)
        .json({ error: "Error desconocido al procesar el archivo." });
    }
    next();
  });
};

router.post("/diagnostico-visual", uploadMiddleware, analizarProblemaVisual);
router.post("/generate-description", generateDescription);

export default router;
