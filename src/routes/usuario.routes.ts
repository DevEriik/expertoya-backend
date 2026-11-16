import { Router } from "express";
import multer from "multer";
import { verifyToken } from "../middlewares/auth.middleware";
import { actualizarPreferencias } from "../controllers/notification.controller";
import { subirFotoPerfil } from "../controllers/usuario.controller";

const router = Router();

const storage = multer.memoryStorage();
const uploadAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage =
      file.mimetype.startsWith("image/") ||
      /\.(jpe?g|png|webp|heic)$/i.test(file.originalname);
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error("Solo se admiten archivos de imagen (JPG, PNG, WebP)"));
    }
  },
});

router.use(verifyToken);

router.patch("/me/preferencias", actualizarPreferencias);
router.post(
  "/me/foto",
  uploadAvatar.fields([
    { name: "foto", maxCount: 1 },
    { name: "foto_perfil", maxCount: 1 },
  ]),
  subirFotoPerfil
);

export default router;
