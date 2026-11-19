import type { Server } from "socket.io";

let ioRef: Server | null = null;

export const setIO = (io: Server): void => {
  ioRef = io;
};

export const getIO = (): Server | null => ioRef;

export const emitToRoom = (
  room: string,
  evento: string,
  payload: unknown,
): void => {
  const io = getIO();
  if (!io) {
    console.warn(
      `[Socket] io no inicializado; se omite "${evento}" para la sala ${room}.`,
    );
    return;
  }

  io.to(room).emit(evento, payload);
};
