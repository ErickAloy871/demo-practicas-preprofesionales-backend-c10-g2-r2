import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Role } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.config'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('credenciales inválidas')
    }
    const refreshToken = randomBytes(32).toString('base64url')
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.hashToken(refreshToken),
        expiresAt: this.getRefreshExpiry(),
      },
    })
    const accessToken = await this.signAccessToken(user, session.id, session.tokenVersion)
    return {
      accessToken,
      refreshToken,
      // companyId solo es relevante para Role.COMPANY (ver User.companyId en
      // el schema); el resto de roles lo trae null. El front lo necesita para
      // armar CreateOfferDto sin tener que adivinar o listar todas las empresas.
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role as Role, companyId: user.companyId },
    }
  }

  async isSessionActive(sessionId: unknown, tokenVersion: unknown): Promise<boolean> {
    if (typeof sessionId !== 'string' || !Number.isInteger(tokenVersion)) return false

    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { tokenVersion: true, expiresAt: true, revokedAt: true },
    })
    return Boolean(
      session &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > Date.now() &&
      session.tokenVersion === tokenVersion,
    )
  }

  async logout(refreshToken?: string, accessToken?: string) {
    let sessionId: string | undefined
    if (accessToken) {
      try {
        const payload = await this.jwt.verifyAsync(accessToken, { ignoreExpiration: true })
        if (typeof payload.sid === 'string') sessionId = payload.sid
      } catch {
        // A bad access token must not prevent revocation through the refresh cookie.
      }
    }

    if (refreshToken) {
      await this.prisma.authSession.updateMany({
        where: { refreshTokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    if (sessionId) {
      await this.prisma.authSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
  }

  async refresh(refreshToken: string) {
    const currentHash = this.hashToken(refreshToken)
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: currentHash },
      include: { user: true },
    })
    const now = new Date()
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException('sesión expirada o inválida')
    }

    const nextRefreshToken = randomBytes(32).toString('base64url')
    const nextTokenVersion = session.tokenVersion + 1
    const rotation = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: currentHash,
        tokenVersion: session.tokenVersion,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: this.hashToken(nextRefreshToken),
        tokenVersion: { increment: 1 },
        expiresAt: this.getRefreshExpiry(now),
      },
    })
    if (rotation.count !== 1) {
      throw new UnauthorizedException('token de renovación ya fue utilizado')
    }

    return {
      accessToken: await this.signAccessToken(session.user, session.id, nextTokenVersion),
      refreshToken: nextRefreshToken,
    }
  }

  private async signAccessToken(user: { id: number; email: string; role: Role }, sessionId: string, tokenVersion: number) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
      ver: tokenVersion,
    })
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private getRefreshExpiry(from = new Date()): Date {
    return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  }
}
