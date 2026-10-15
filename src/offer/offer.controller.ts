import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Role } from '@prisma/client'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { CreateOfferDto } from './dto/create-offer.dto'
import { OfferService } from './offer.service'

@Controller('offers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OfferController {
  constructor(private readonly service: OfferService) {}

  @Get()
  findAll() {
    return this.service.findAll()
  }

  // Nota de ruta: 'me' va antes que ':id' — si no, ParseIntPipe intenta
  // convertir "me" a número y devuelve 400 (mismo caso que /placements/accreditation).
  @Get('me')
  @Roles(Role.COMPANY)
  findMine(@Req() req: { user: { sub: number } }) {
    return this.service.findAllForCompanyUser(req.user.sub)
  }

  // E3-01 (hallazgo 5): el servicio decide si el borrador puede verse; por eso
  // necesita saber quién llama además del id.
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: { user: { sub: number; role: Role } }) {
    return this.service.findOne(id, req.user.sub, req.user.role)
  }

  // E3-01 (hallazgo 4a): el companyId del body se contrasta con la empresa del
  // usuario autenticado dentro del servicio.
  @Post()
  @Roles(Role.COMPANY, Role.COORDINATOR)
  create(@Body() dto: CreateOfferDto, @Req() req: { user: { sub: number; role: Role } }) {
    return this.service.create(dto, req.user.sub, req.user.role)
  }

  // E3-01 (hallazgo 4b): solo la empresa dueña de la oferta puede publicarla.
  @Patch(':id/publish')
  @Roles(Role.COMPANY, Role.COORDINATOR)
  publish(@Param('id', ParseIntPipe) id: number, @Req() req: { user: { sub: number; role: Role } }) {
    return this.service.publish(id, req.user.sub, req.user.role)
  }

  // E3-01 (hallazgo 4c): solo la empresa dueña de la oferta puede cerrarla.
  @Patch(':id/close')
  @Roles(Role.COMPANY, Role.COORDINATOR)
  close(@Param('id', ParseIntPipe) id: number, @Req() req: { user: { sub: number; role: Role } }) {
    return this.service.close(id, req.user.sub, req.user.role)
  }
}
