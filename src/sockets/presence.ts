const usuariosConectados = new Map<string, number>();

export function marcarConectado(userId: string): void {
  usuariosConectados.set(userId, (usuariosConectados.get(userId) ?? 0) + 1);
}

export function marcarDesconectado(userId: string): void {
  const actuales = (usuariosConectados.get(userId) ?? 1) - 1;
  if (actuales <= 0) {
    usuariosConectados.delete(userId);
  } else {
    usuariosConectados.set(userId, actuales);
  }
}

export function estaUsuarioConectado(userId: string): boolean {
  return (usuariosConectados.get(userId) ?? 0) > 0;
}
