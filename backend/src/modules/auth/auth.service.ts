import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hashSync } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginResponse, User } from './auth.dto';

const USER_FIELDS = {
  id: true,
  username: true,
  fullName: true,
  role: true,
} as const;

@Injectable()
export class AuthService {
  // Compared against for unknown usernames so both failure paths take the same time.
  private readonly dummyHash = hashSync(randomUUID(), 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const found = await this.prisma.user.findUnique({ where: { username } });
    const valid = await compare(
      password,
      found?.passwordHash ?? this.dummyHash,
    );
    if (!found || !valid) {
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        401,
        'Invalid username or password',
      );
    }
    const user: User = {
      id: found.id,
      username: found.username,
      fullName: found.fullName,
      role: found.role,
    };
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    const { iat, exp } = this.jwt.decode<{ iat: number; exp: number }>(
      accessToken,
    );
    return { accessToken, expiresIn: exp - iat, user };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_FIELDS,
    });
    if (!user) {
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        401,
        'User no longer exists',
      );
    }
    return user;
  }
}
