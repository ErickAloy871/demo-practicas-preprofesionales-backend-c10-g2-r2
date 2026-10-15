import 'dotenv/config'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/http-exception.filter'
import { getAllowedCorsOrigins } from './common/cors.config'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: getAllowedCorsOrigins(process.env.CORS_ORIGIN),
    credentials: true,
  })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(process.env.PORT ?? 3000)
}

void bootstrap()
