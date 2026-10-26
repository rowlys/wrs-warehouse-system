import { prisma } from './index';

afterAll(() => prisma.$disconnect());
