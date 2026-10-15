import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException, Inject, forwardRef } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../auth.service'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const header: string | undefined = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw new UnauthorizedException('falta el token')
    
    let payload: Record<string, unknown>
    try {
      payload = await this.jwt.verifyAsync(token)
    } catch {
      throw new UnauthorizedException('token inválido')
    }

    if (!await this.authService.isSessionActive(payload.sid, payload.ver)) {
      throw new UnauthorizedException('sesión inválida o expirada')
    }
    request.user = payload
    return true
  }
}
