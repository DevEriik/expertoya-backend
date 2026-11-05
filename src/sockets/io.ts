import type { Server } from "socket.io";

/**
 * Guarda la instancia de Socket.io para poder emitir eventos desde
 * controladores y jobs (que no reciben `io` directamente).
 * Se registra una sola vez dentro de initChatSocket(io).
 */
let ioRef: Server | null = null;

export const setIO = (io: Server): void => {
  ioRef = io;
};

export const getIO = (): Server | null => ioRef;
