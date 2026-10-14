import { Module, Global } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RolesGuard } from './guards/roles.guard'

const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) {
  throw new Error('FALTA VARIABLE DE ENTORNO: JWT_SECRET es requerida para firmar los tokens de sesión. Genera una y colócala en tu archivo .env (mira el README).')
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: jwtSecret,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
