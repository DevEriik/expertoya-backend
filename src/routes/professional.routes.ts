import { Router } from "express";
import {
    getProfile,
    updateProfile,
} from "../controllers/professional.controller";
import { verifyToken } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyToken);

router.get("/profile", getProfile);

router.put("/profile", updateProfile);

export default router;
