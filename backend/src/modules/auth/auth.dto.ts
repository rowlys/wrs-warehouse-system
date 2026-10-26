import { UserRole } from '@prisma/client';
import { IsString, Length } from 'class-validator';

export class LoginRequest {
  @IsString()
  @Length(1, 50)
  username!: string;

  @IsString()
  @Length(1, 100)
  password!: string;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export interface LoginResponse {
  accessToken: string;
  /** Seconds until expiry. */
  expiresIn: number;
  user: User;
}
