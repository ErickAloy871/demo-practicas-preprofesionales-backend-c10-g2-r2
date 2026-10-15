import { Body, Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.config'
import { LoginDto } from './dto/login.dto'

interface RequestWithHeaders {
  headers: { authorization?: string; cookie?: string }
}

interface ResponseWithHeaders {
  setHeader(name: string, value: string): void
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: ResponseWithHeaders,
  ) {
    const { accessToken, refreshToken, user } = await this.auth.login(dto.email, dto.password)
    this.setRefreshCookie(response, refreshToken)
    return { accessToken, user }
  }

  @Post('refresh')
  async refresh(
    @Req() request: RequestWithHeaders,
    @Res({ passthrough: true }) response: ResponseWithHeaders,
  ) {
    const refreshToken = this.extractRefreshToken(request)
    if (!refreshToken) throw new UnauthorizedException('falta el token de renovación')
    const result = await this.auth.refresh(refreshToken)
    this.setRefreshCookie(response, result.refreshToken)
    return { accessToken: result.accessToken }
  }

  @Post('logout')
  async logout(
    @Req() request: RequestWithHeaders,
    @Res({ passthrough: true }) response: ResponseWithHeaders,
  ) {
    await this.auth.logout(
      this.extractRefreshToken(request),
      this.extractAccessToken(request),
    )
    this.setRefreshCookie(response, '')
    return { success: true }
  }

  private extractRefreshToken(request: RequestWithHeaders): string | undefined {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('refresh_token='))
    return cookie?.slice('refresh_token='.length)
  }

  private extractAccessToken(request: RequestWithHeaders): string | undefined {
    const header = request.headers.authorization
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined
  }

  private setRefreshCookie(response: ResponseWithHeaders, token: string): void {
    const maxAge = token ? REFRESH_TOKEN_TTL_SECONDS : 0
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    response.setHeader(
      'Set-Cookie',
      `refresh_token=${token}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    )
  }
}
