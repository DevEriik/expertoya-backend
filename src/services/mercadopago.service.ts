import { env } from "../config/env";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { format } from "date-fns";

// Tipo para la respuesta de la API de Mercado Pago al crear una preferencia
export interface PreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point: string;
  external_reference: string;
  expiration_date_from: string;
  expiration_date_to: string;
}

// Tipo para la respuesta de la API de Mercado Pago al consultar un pago
export interface PaymentResponse {
  id: number;
  status: string;
  status_detail: string;
  currency_id: string;
  transaction_amount: number;
  net_received_amount: number; // Nuevo campo para el monto neto recibido
  payment_method_id: string;
  payment_type_id: string;
  date_approved: string;
  date_created: string;
  transaction_details: {
    net_received_amount: number;
    total_paid_amount: number;
  };
  fee_details?: Array<{
    type: string;
    amount: number;
  }>;
  collector_id: number;
  external_reference: string;
  payments: Array<{
    id: number;
    amount: number;
    status: string;
    operation_type: string;
  }>;
  point_of_interaction?: {
    transaction_data?: {
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

export interface RefundResponse {
  id: number;
  payment_id: number;
  amount: number;
  date_created: string;
  status: string;
}

export class MercadoPagoService {
  private apiUrl: string;
  private accessToken: string;
  private webhookSecret: string;
  private collectorId?: string;

  constructor() {
    this.apiUrl =
      env.MP_ENV === "sandbox"
        ? "https://api.mercadopago.com"
        : "https://api.mercadopago.com";
    this.accessToken = env.MP_ACCESS_TOKEN;
    this.webhookSecret = env.MP_WEBHOOK_SECRET;
    this.collectorId = env.MP_COLLECTOR_ID;

    if (!this.accessToken) {
      console.warn(
        "MercadoPagoService: MP_ACCESS_TOKEN no está configurado. Las operaciones de MP fallarán.",
      );
    }
    if (env.NODE_ENV === "production" && !this.webhookSecret) {
      console.error(
        "MercadoPagoService: En producción, MP_WEBHOOK_SECRET es obligatorio.",
      );
      throw new Error("MP_WEBHOOK_SECRET es obligatorio en producción.");
    }
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Crea una preferencia de pago en Mercado Pago.
   * @param externalReference ID único para correlacionar con nuestro sistema (PagoEscrow.id).
   * @param title Título del producto/servicio.
   * @param unitPrice Precio unitario.
   * @param quantity Cantidad (siempre 1 para este caso).
   * @param payerEmail Email del cliente.
   * @param payerName Nombre del cliente.
   * @param payerSurname Apellido del cliente.
   * @param metadata Metadatos adicionales para la preferencia.
   * @returns La respuesta de Mercado Pago con los puntos de inicio (init_point, sandbox_init_point).
   */
  async createPreference(
    externalReference: string,
    title: string,
    unitPrice: Prisma.Decimal,
    quantity: number,
    payerEmail: string,
    payerName: string,
    payerSurname: string,
    metadata: {
      solicitud_id: string;
      pago_id: string;
      cliente_id: string;
      profesional_id: string;
    },
  ): Promise<PreferenceResponse> {
    if (!this.accessToken) {
      throw new Error("Mercado Pago Access Token no configurado.");
    }

    const expirationDateFrom = new Date();
    const expirationDateTo = new Date();
    expirationDateTo.setDate(expirationDateTo.getDate() + 1); // Expira en 24 horas

    const preference = {
      items: [
        {
          id: metadata.solicitud_id, // Puedes usar solicitud_id como ID del item
          title: title,
          quantity: quantity,
          unit_price: unitPrice.toNumber(), // Convertir Decimal a number para MP
          currency_id: "ARS",
        },
      ],
      payer: {
        email: payerEmail,
        name: payerName,
        surname: payerSurname,
      },
      external_reference: externalReference,
      notification_url: `${env.BACKEND_PUBLIC_URL}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${env.APP_PUBLIC_URL}/pago/success`,
        failure: `${env.APP_PUBLIC_URL}/pago/failure`,
        pending: `${env.APP_PUBLIC_URL}/pago/pending`,
      },
      auto_return: "approved",
      statement_descriptor: "EXPERTOYA", // Texto que verá el cliente en su resumen
      binary_mode: false, // Indica si el pago debe ser aprobado o rechazado sin intervención manual
      expires: true,
      expiration_date_from: format(
        expirationDateFrom,
        "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
      ),
      expiration_date_to: format(
        expirationDateTo,
        "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
      ),
      metadata: metadata,
    };

    console.log(
      "Creando preferencia de Mercado Pago:",
      JSON.stringify(preference, null, 2),
    );

    try {
      const response = await fetch(`${this.apiUrl}/checkout/preferences`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(preference),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        console.error("Error al crear preferencia de Mercado Pago:", errorBody);
        throw new Error(
          `Error al crear preferencia de Mercado Pago: ${response.status} - ${JSON.stringify(errorBody)}`,
        );
      }

      const data: PreferenceResponse = await response.json();
      console.log("Preferencia de Mercado Pago creada:", data);
      return data;
    } catch (error) {
      console.error(
        "Excepción al comunicarse con Mercado Pago (createPreference):",
        error,
      );
      throw error;
    }
  }

  /**
   * Valida la firma del webhook de Mercado Pago.
   * @param signatureHeader El valor del encabezado 'x-signature'.
   * @param requestId El valor del encabezado 'x-request-id'.
   * @param dataId El valor del parámetro 'data.id' de la URL.
   * @returns `true` si la firma es válida, `false` en caso contrario.
   */
  validateWebhookSignature(
    signatureHeader: string,
    requestId: string,
    dataId: string,
  ): boolean {
    if (!this.webhookSecret) {
      console.warn(
        "MP_WEBHOOK_SECRET no está configurado. La validación de firma no se realizará.",
      );
      return false; // En desarrollo se puede permitir, en producción debería fallar.
    }
    if (!signatureHeader || !requestId || !dataId) {
      console.warn(
        "Faltan datos en los headers o query params para validar la firma del webhook.",
      );
      return false;
    }

    const parts = signatureHeader.split(",");
    let ts: string | undefined;
    let v1: string | undefined;

    for (const part of parts) {
      if (part.startsWith("ts=")) {
        ts = part.substring(3);
      } else if (part.startsWith("v1=")) {
        v1 = part.substring(3);
      }
    }

    if (!ts || !v1) {
      console.warn("Formato de x-signature inválido.");
      return false;
    }

    // El 'manifest' que Mercado Pago firma
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hmac = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(manifest)
      .digest("hex");

    // Comparación segura contra ataques de temporización
    const signatureBuffer = Buffer.from(v1, "hex");
    const hmacBuffer = Buffer.from(hmac, "hex");

    if (signatureBuffer.length !== hmacBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, hmacBuffer);
  }

  /**
   * Consulta los detalles de un pago en la API de Mercado Pago.
   * @param paymentId El ID del pago de Mercado Pago.
   * @returns Los detalles del pago.
   */
  async getPaymentDetails(paymentId: string): Promise<PaymentResponse> {
    if (!this.accessToken) {
      throw new Error("Mercado Pago Access Token no configurado.");
    }
    try {
      const response = await fetch(`${this.apiUrl}/v1/payments/${paymentId}`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        console.error(
          `Error al consultar pago ${paymentId} en Mercado Pago:`,
          errorBody,
        );
        throw new Error(
          `Error al consultar pago en Mercado Pago: ${response.status} - ${JSON.stringify(errorBody)}`,
        );
      }

      const data: PaymentResponse = await response.json();
      return data;
    } catch (error) {
      console.error(
        `Excepción al comunicarse con Mercado Pago (getPaymentDetails ${paymentId}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Realiza un reembolso total de un pago en Mercado Pago.
   * @param paymentId El ID del pago de Mercado Pago.
   * @param idempotencyKey Una clave de idempotencia para asegurar que la operación no se duplique.
   * @returns La respuesta del reembolso.
   */
  async refundPayment(
    paymentId: string,
    idempotencyKey: string,
  ): Promise<RefundResponse> {
    if (!this.accessToken) {
      throw new Error("Mercado Pago Access Token no configurado.");
    }
    try {
      const response = await fetch(
        `${this.apiUrl}/v1/payments/${paymentId}/refunds`,
        {
          method: "POST",
          headers: {
            ...this.getAuthHeaders(),
            "X-Idempotency-Key": idempotencyKey, // Clave para idempotencia en reembolsos
          },
          body: JSON.stringify({ amount: undefined }), // undefined para reembolso total
        },
      );

      if (!response.ok) {
        const errorBody = await response.json();
        console.error(
          `Error al solicitar reembolso para el pago ${paymentId} en Mercado Pago:`,
          errorBody,
        );
        throw new Error(
          `Error al solicitar reembolso en Mercado Pago: ${response.status} - ${JSON.stringify(errorBody)}`,
        );
      }

      const data: RefundResponse = await response.json();
      return data;
    } catch (error) {
      console.error(
        `Excepción al comunicarse con Mercado Pago (refundPayment ${paymentId}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Verifica que el payment_id pertenece al collector_id configurado.
   * @param actualCollectorId El ID del collector real del pago.
   * @returns `true` si el ID coincide o no está configurado, `false` en caso contrario.
   */
  isCollectorIdValid(actualCollectorId: number): boolean {
    if (!this.collectorId) {
      // Si no se configuró, se asume que cualquier collector es válido (o no se valida)
      return true;
    }
    return actualCollectorId.toString() === this.collectorId;
  }
}

export const mercadoPagoService = new MercadoPagoService();
