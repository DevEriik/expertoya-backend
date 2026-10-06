import { Router } from "express";
import multer from "multer";
import {
    getProfile,
    updateProfile,
    submitOnboarding,
} from "../controllers/professional.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import fs from "fs";

const router = Router();

// Configuración básica de multer para guardar temporalmente
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './uploads/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

router.use(verifyToken);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);

router.post("/onboarding", upload.fields([
    { name: 'dni_frente', maxCount: 1 },
    { name: 'dni_dorso', maxCount: 1 },
    { name: 'selfie_biometrica', maxCount: 1 },
    { name: 'antecedentes_penales', maxCount: 1 },
    { name: 'certificado_no_deudor', maxCount: 1 },
    { name: 'constancia_afip', maxCount: 1 },
    // Si queremos recibir matrículas, podríamos agregar un campo genérico tipo array
]), submitOnboarding);

export default router;
