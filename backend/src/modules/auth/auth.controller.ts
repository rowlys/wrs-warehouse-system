import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  Public,
} from '../../common/auth/auth.decorators';
import { LoginRequest, LoginResponse, User } from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.auth.login(body.username, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user.id);
  }
}
