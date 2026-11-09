import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z
      .string()
      .transform((val) => parseInt(val, 10))
      .default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
    DIRECT_URL: z.string().optional(),
    JWT_SECRET: z.string().default("expertoya_clave_secreta_jwt_2026"),

    // GMAIL para Nodemailer (opcional en desarrollo, recomendado en prod)
    GMAIL_USER: z.string().optional(),
    GMAIL_APP_PASSWORD: z.string().optional(),

    MP_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    MP_ACCESS_TOKEN: z.string().default(""),
    MP_PUBLIC_KEY: z.string().default(""),
    MP_WEBHOOK_SECRET: z.string().default(""),
    MP_COLLECTOR_ID: z.string().optional(),

    BACKEND_PUBLIC_URL: z.string().default("http://localhost:3000"),
    APP_PUBLIC_URL: z.string().default("http://localhost:8081"),

    COMISION_PORCENTAJE: z
      .string()
      .transform((val) => parseFloat(val))
      .refine(
        (val) => val >= 0 && val <= 100,
        "COMISION_PORCENTAJE debe estar entre 0 y 100",
      )
      .default(10), // Cambiado de "10" a 10 (number)
    PAYOUT_MODE: z
      .enum(["SIMULADO", "MANUAL", "MERCADO_PAGO"])
      .default("SIMULADO"),
    ALLOW_PAYMENT_SIMULATION: z
      .string()
      .transform((val) => val === "true")
      .default(false),
  })
  .refine(
    (data) => {
      const isProd =
        data.NODE_ENV === "production" || data.MP_ENV === "production";
      if (isProd) {
        if (!data.MP_WEBHOOK_SECRET) return false;
        if (data.PAYOUT_MODE === "SIMULADO") return false;
        if (data.ALLOW_PAYMENT_SIMULATION === true) return false;
      }
      return true;
    },
    {
      message:
        "En producción se requiere MP_WEBHOOK_SECRET obligatorio, PAYOUT_MODE != SIMULADO y ALLOW_PAYMENT_SIMULATION = false",
    },
  );

export const env = envSchema.parse(process.env);
