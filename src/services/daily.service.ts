/**
 * Servicio de integración con la API REST de Daily.co
 * Genera salas efímeras seguras para diagnósticos visuales en vivo (WebRTC P2P/SFU)
 */

interface CrearSalaDailyParams {
  solicitudId: string;
  duracionMinutos?: number;
}

interface SalaDailyResponse {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  expiresAt: number;
}

export class DailyService {
  private static readonly API_BASE = "https://api.daily.co/v1";

  /**
   * Obtiene la API Key de Daily configurada en el entorno
   */
  private static getApiKey(): string | null {
    const key = process.env.DAILY_API_KEY?.trim();
    return key && key !== "" ? key : null;
  }

  /**
   * Crea una sala efímera en Daily.co con vencimiento automático
   * @param params { solicitudId, duracionMinutos }
   * @returns Datos de la sala con su roomUrl
   */
  public static async crearSalaEfimera(
    params: CrearSalaDailyParams
  ): Promise<SalaDailyResponse> {
    const { solicitudId, duracionMinutos = 60 } = params;
    const apiKey = this.getApiKey();

    const timestamp = Date.now();
    const expSeconds = Math.floor(timestamp / 1000) + duracionMinutos * 60;
    const roomName = `exp-diag-${solicitudId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}-${timestamp.toString(36)}`;

    if (!apiKey) {
      const fixedRoomUrl = process.env.DAILY_ROOM_URL?.trim();
      if (fixedRoomUrl) {
        console.log(`📞 [DailyService] Utilizando sala fija real de Daily.co: ${fixedRoomUrl}`);
        return {
          id: roomName,
          name: roomName,
          url: fixedRoomUrl,
          createdAt: new Date().toISOString(),
          expiresAt: expSeconds,
        };
      }

      const domain = process.env.DAILY_DOMAIN || "expertoya.daily.co";
      console.warn(
        `⚠️ [DailyService] DAILY_API_KEY no está configurada en .env. Utilizando sala simulada (https://${domain}/${roomName}).`
      );
      return {
        id: roomName,
        name: roomName,
        url: `https://${domain}/${roomName}`,
        createdAt: new Date().toISOString(),
        expiresAt: expSeconds,
      };
    }

    try {
      const response = await fetch(`${this.API_BASE}/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: roomName,
          privacy: "public",
          properties: {
            exp: expSeconds,
            eject_at_room_exp: true,
            enable_chat: false,
            enable_screenshare: false,
            start_video_off: false,
            start_audio_off: false,
            max_participants: 2,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DailyService] Error en respuesta de Daily.co (${response.status}):`, errorText);
        throw new Error(`Daily API error: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return {
        id: data.id || roomName,
        name: data.name,
        url: data.url,
        createdAt: data.created_at,
        expiresAt: data.config?.exp || expSeconds,
      };
    } catch (error: any) {
      console.error("[DailyService] Fallo al invocar la API de Daily:", error.message);
      const domain = process.env.DAILY_DOMAIN || "expertoya.daily.co";
      return {
        id: roomName,
        name: roomName,
        url: `https://${domain}/${roomName}`,
        createdAt: new Date().toISOString(),
        expiresAt: expSeconds,
      };
    }
  }

  /**
   * Elimina una sala en Daily.co una vez finalizada la llamada
   */
  public static async eliminarSala(roomName: string): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey || !roomName) return false;

    try {
      const response = await fetch(`${this.API_BASE}/rooms/${roomName}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return response.ok;
    } catch (err: any) {
      console.warn(`[DailyService] No se pudo eliminar sala ${roomName}:`, err.message);
      return false;
    }
  }
}