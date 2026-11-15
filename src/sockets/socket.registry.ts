import type { Server } from "socket.io";

/**
 * Registro global de la instancia de Socket.io.
 *
 * index.ts llama a setIO(io) al arrancar. Los servicios (por ejemplo
 * PaymentService) pueden emitir eventos sin recibir `io` por constructor,
 * evitando ciclos de imports.
 */
let ioInstance: Server | null = null;

export const setIO = (io: Server): void => {
  ioInstance = io;
};

export const getIO = (): Server | null => ioInstance;

/**
 * Emite un evento a una sala. Si Socket.io todavía no está inicializado
 * (por ejemplo, en un script de consola), no hace nada.
 */
export const emitToRoom = (
  room: string,
  evento: string,
  payload: unknown,
): void => {
  if (!ioInstance) {
    console.warn(
      `[Socket] io no inicializado; se omite "${evento}" para la sala ${room}.`,
    );
    return;
  }

  ioInstance.to(room).emit(evento, payload);
};
