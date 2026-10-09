import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Role } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AuthService {
  private readonly invalidatedTokens = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('credenciales inválidas')
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, email, role: user.role })
    return {
      accessToken,
      // companyId solo es relevante para Role.COMPANY (ver User.companyId en
      // el schema); el resto de roles lo trae null. El front lo necesita para
      // armar CreateOfferDto sin tener que adivinar o listar todas las empresas.
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role as Role, companyId: user.companyId },
    }
  }

  isTokenInvalidated(token: string): boolean {
    return this.invalidatedTokens.has(token)
  }

  logout(token: string) {
    this.invalidatedTokens.add(token)
  }

  async refresh(token: string) {
    if (this.isTokenInvalidated(token)) {
      throw new UnauthorizedException('token ya fue invalidado')
    }
    try {
      // Ignoramos la expiración al verificar el token viejo, porque el propósito del refresh
      // es poder emitir uno nuevo incluso si este acaba de expirar (o está a punto de hacerlo).
      // Si el frontend lo envía a tiempo (antes de expirar), verifyAsync pasa normalmente.
      // Si lo envía después, verifyAsync lanzaría error si no ignoramos la expiración.
      // Dependiendo de la política de seguridad, podríamos permitir un "grace period" o requerir
      // que siempre se renueve ANTES de expirar.
      // La historia dice "Existe una forma de renovar la sesión sin volver a pedir credenciales,
      // y renovarla invalida el token anterior."
      // Para mayor seguridad en JWT, generalmente se usa un Refresh Token separado.
      // Como estamos renovando usando el Access Token mismo, asumiremos que se renueva
      // cuando está cerca de expirar, o aceptamos que ignore la expiración aquí.
      const payload = await this.jwt.verifyAsync(token, { ignoreExpiration: true })
      
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
      if (!user) throw new UnauthorizedException('usuario no encontrado')

      this.logout(token) // Invalidate the old token
      const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role })
      return { accessToken }
    } catch {
      throw new UnauthorizedException('token inválido para renovación')
    }
  }
}
