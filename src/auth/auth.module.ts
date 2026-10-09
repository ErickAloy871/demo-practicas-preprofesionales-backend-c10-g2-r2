import { Module, Global } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RolesGuard } from './guards/roles.guard'

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      // D-07: fallback hardcodeado si falta la env. Documentado en KNOWN_ISSUES.md.
      secret: process.env.JWT_SECRET ?? 'dev-secret-no-cambiar',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
