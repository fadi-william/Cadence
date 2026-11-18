import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, Session } from './auth.service';
import { ChangePasswordBody, ForgotPasswordBody, LoginBody, ResetPasswordBody } from './dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './session-cookie';

/** Stricter limit for credential endpoints (per IP). */
const AUTH_LIMIT = { default: { limit: Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

export function sendSession(res: Response, session: Session) {
  if (session.refreshToken) setRefreshCookie(res, session.refreshToken, session.refreshMaxAgeMs);
  return session.response;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) res: Response) {
    return sendSession(res, await this.auth.login(body.email, body.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return sendSession(res, await this.auth.refresh(readRefreshCookie(req)));
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Throttle(AUTH_LIMIT)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendSession(res, await this.auth.changePassword(user.id, body.currentPassword, body.newPassword));
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body() body: ForgotPasswordBody) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body() body: ResetPasswordBody) {
    await this.auth.resetPassword(body.token, body.password);
  }
}
