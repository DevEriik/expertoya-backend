import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import authRoutes from "./src/routes/auth.routes";
import adminRoutes from "./src/routes/admin.routes";
import professionalRoutes from "./src/routes/professional.routes";
import profesionalesRoutes from "./src/routes/professional.routes";
import profesionesRoutes from "./src/routes/profesiones.routes";
import iaRoutes from "./src/routes/ia.routes";
import chatRoutes from "./src/routes/chat.routes";
import { initChatSocket } from "./src/sockets/chat.socket";
import notificationRoutes from "./src/routes/notification.routes";
import usuarioRoutes from "./src/routes/usuario.routes";
import paymentRoutes from "./src/routes/payment.routes";
import adminPaymentRoutes from "./src/routes/admin-payment.routes";
import webhookRoutes from "./src/routes/webhook.routes";
import { iniciarCronNotificaciones } from "./src/jobs/notification.job";
import { setIO } from "./src/sockets/socket.registry";

const app = express();
const PORT = process.env.PORT || 3000;

import path from "path";
import fs from "fs";

app.use(cors());
app.use(express.json());

app.use("/uploads", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const decodedPath = decodeURIComponent(req.path);
  const rawPath = req.path;

  const candidateDecoded = path.join(uploadsDir, decodedPath);
  if (
    fs.existsSync(candidateDecoded) &&
    fs.statSync(candidateDecoded).isFile()
  ) {
    return res.sendFile(candidateDecoded);
  }

  const candidateRaw = path.join(uploadsDir, rawPath);
  if (fs.existsSync(candidateRaw) && fs.statSync(candidateRaw).isFile()) {
    return res.sendFile(candidateRaw);
  }

  return express.static("uploads")(req, res, next);
});

app.get("/", (req: Request, res: Response) => {
  res.json({
    mensaje:
      "¡El backend de ExpertoYa está corriendo exitosamente con TypeScript y Prisma!",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/professionals", professionalRoutes);
app.use("/api/profesionales", profesionalesRoutes);
app.use("/api/profesiones", profesionesRoutes);
app.use("/api/ia", iaRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notificaciones", notificationRoutes);
app.use("/api/usuarios", usuarioRoutes);

// Alias del webhook según la issue DAN-22 (además de /api/webhooks/mercadopago)
app.use("/api/payments/webhook", webhookRoutes);

app.use("/api/payments", paymentRoutes);
app.use("/api/admin/payments", adminPaymentRoutes);
app.use("/api/webhooks/mercadopago", webhookRoutes);

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Error capturado por Express:", err.message);
  res.status(400).json({
    error: err.message || "Error al procesar la solicitud",
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

initChatSocket(io);
setIO(io);

server.listen(PORT as number, "0.0.0.0", () => {
  console.log(`Servidor y Socket.io iniciados en http://0.0.0.0:${PORT}`);
  iniciarCronNotificaciones();
});
