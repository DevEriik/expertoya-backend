import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./src/routes/auth.routes";
import adminRoutes from "./src/routes/admin.routes";
import professionalRoutes from "./src/routes/professional.routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.json({
    mensaje:
      "¡El backend de ExpertoYa está corriendo exitosamente con TypeScript y Prisma!",
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/admin", adminRoutes);
app.use("/admin", adminRoutes);

app.use("/api/professionals", professionalRoutes);

app.listen(PORT as number, "0.0.0.0", () => {
  console.log(`Servidor iniciado en http://0.0.0.0:${PORT}`);
});
