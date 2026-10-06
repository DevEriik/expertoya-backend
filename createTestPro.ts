import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'pro@test.com';
  const existingUser = await prisma.user.findUnique({ where: { email } });
  
  if (existingUser) {
    console.log('Test professional already exists:', email);
    return;
  }

  const password_hash = await bcrypt.hash('123456', 10);

  const newPro = await prisma.user.create({
    data: {
      email,
      password_hash,
      nombre: 'Pedro',
      apellido: 'Profesional',
      telefono: '2991234567',
      rol: 'PROFESIONAL',
      profile: {
        create: {
          descripcion_perfil: 'Soy un electricista matriculado con 10 años de experiencia.',
          ubicacion_geografica: 'Neuquén, Cipolletti',
          estado_validado: true,
          calificacion_promedio: 4.8
        }
      }
    }
  });

  console.log('Created test professional:', newPro);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
