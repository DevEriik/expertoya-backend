import { Router } from "express";
import multer from "multer";
import {
  getProfile,
  updateProfile,
  submitOnboarding,
  getOficios,
  getPublicProfessionals,
} from "../controllers/professional.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { buscarProfesionales } from "../controllers/search.controller";

const router = Router();

router.get("/oficios", getOficios);
router.get("/public", getPublicProfessionals);
router.get("/buscar", buscarProfesionales);

const storage = multer.memoryStorage();

const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const imageMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const docMimes = ["application/pdf"];

  const isImageExt = /\.(jpe?g|png|webp)$/i.test(file.originalname);
  const isDocExt = /\.(pdf)$/i.test(file.originalname);

  const isImage =
    imageMimes.includes(file.mimetype.toLowerCase()) || isImageExt;
  const isDoc = docMimes.includes(file.mimetype.toLowerCase()) || isDocExt;

  const imageOnlyFields = ["dni_frente", "dni_dorso", "selfie_biometrica"];

  if (imageOnlyFields.includes(file.fieldname)) {
    if (isImage) {
      cb(null, true);
    } else {
      console.log(
        `[Multer Rechazó] Campo: ${file.fieldname} | MimeType que llegó: "${file.mimetype}" | Nombre: "${file.originalname}"`,
      );
      cb(
        new Error(
          `Formato inválido: El campo ${file.fieldname} solo admite imágenes (JPG, PNG).`,
        ),
      );
    }
  } else {
    if (isDoc || isImage) {
      cb(null, true);
    } else {
      console.log(
        `[Multer Rechazó] Campo: ${file.fieldname} | MimeType que llegó: "${file.mimetype}" | Nombre: "${file.originalname}"`,
      );
      cb(
        new Error(
          `Formato inválido: El campo ${file.fieldname} solo admite documentos PDF o imágenes (JPG, PNG).`,
        ),
      );
    }
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

router.use(verifyToken);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);

router.post(
  "/onboarding",
  upload.fields([
    { name: "dni_frente", maxCount: 1 },
    { name: "dni_dorso", maxCount: 1 },
    { name: "selfie_biometrica", maxCount: 1 },
    { name: "antecedentes_penales", maxCount: 1 },
    { name: "certificado_no_deudor", maxCount: 1 },
    { name: "constancia_afip", maxCount: 1 },
    { name: "matricula_documento", maxCount: 5 },
  ]),
  submitOnboarding,
);

export default router;
