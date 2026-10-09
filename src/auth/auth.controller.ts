import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password)
  }

  @Post('refresh')
  refresh(@Req() req: any) {
    const token = this.extractTokenFromHeader(req)
    if (!token) throw new UnauthorizedException('falta el token')
    return this.auth.refresh(token)
  }

  @Post('logout')
  logout(@Req() req: any) {
    const token = this.extractTokenFromHeader(req)
    if (token) {
      this.auth.logout(token)
    }
    return { success: true }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const header: string | undefined = request.headers.authorization
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined
  }
}
