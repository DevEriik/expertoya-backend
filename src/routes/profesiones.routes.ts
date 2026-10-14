import { Router } from "express";
import { listarProfesiones } from "../controllers/search.controller";

const router = Router();
router.get("/", listarProfesiones);

export default router;
