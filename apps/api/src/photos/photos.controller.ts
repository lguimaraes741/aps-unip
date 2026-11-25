import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Public } from '../common/auth/decorators';
import { MAX_PHOTO_BYTES, PhotosService } from './photos.service';

@ApiTags('photos')
@ApiBearerAuth()
@Controller()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post('occurrences/:id/photos')
  @ApiOperation({ summary: 'Envia uma foto (JPEG/PNG/WebP, até 10 MB; metadados EXIF são removidos)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0 } }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.photos.upload(user, id, file);
  }

  @Public()
  @Get('photos/:photoId')
  @ApiOperation({ summary: 'Arquivo da foto (público, para uso em <img> e Image.network)' })
  async file(@Param('photoId', ParseUUIDPipe) photoId: string): Promise<StreamableFile> {
    const { stream, mimeType, size } = await this.photos.open(photoId);
    return new StreamableFile(stream, {
      type: mimeType,
      length: size,
      disposition: 'inline',
    });
  }

  @Delete('photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma foto (autor ou moderação)' })
  async remove(@CurrentUser() user: AuthUser, @Param('photoId', ParseUUIDPipe) photoId: string): Promise<void> {
    await this.photos.remove(user, photoId);
  }
}
