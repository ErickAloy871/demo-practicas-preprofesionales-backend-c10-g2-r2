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
    
    if (this.authService.isTokenInvalidated(token)) {
      throw new UnauthorizedException('token inválido o expirado')
    }

    try {
      request.user = await this.jwt.verifyAsync(token)
      return true
    } catch {
      throw new UnauthorizedException('token inválido')
    }
  }
}
