import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { MembershipRole } from "@prisma/client";
import { diskStorage } from "multer";
import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Roles } from "../shared/decorators/roles.decorator";
import { Public } from "../shared/decorators/public.decorator";
import { MediaAssetsQueryDto, MediaUploadOptionsDto } from "./dto/media-assets-query.dto";
import { MEDIA_MAX_FILE_SIZE_BYTES } from "./media.constants";
import { MediaAssetsService, UploadedMediaFile } from "./media-assets.service";
import { MediaStorageService } from "./storage/media-storage.service";

const TEMP_UPLOAD_ROOT = path.join(
  tmpdir(),
  `instagram-automation-media-uploads-${process.pid}`,
);
const uploadStorage = diskStorage({
  destination: (_request, _file, callback) => {
    void mkdir(TEMP_UPLOAD_ROOT, { recursive: true, mode: 0o700 })
      .then(() => chmod(TEMP_UPLOAD_ROOT, 0o700))
      .then(() => callback(null, TEMP_UPLOAD_ROOT))
      .catch((error: Error) => callback(error, TEMP_UPLOAD_ROOT));
  },
  filename: (_request, _file, callback) => callback(null, randomUUID()),
});

@ApiTags("Media library")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/media-assets")
export class MediaAssetsController {
  constructor(private readonly media: MediaAssetsService) {}

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: uploadStorage,
      limits: {
        files: 1,
        fileSize: MEDIA_MAX_FILE_SIZE_BYTES,
        fields: 1,
        fieldSize: 128,
      },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiOperation({ summary: "Upload a tenant-scoped media file" })
  upload(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Query() options: MediaUploadOptionsDto,
  ) {
    if (!file) throw new BadRequestException("A media file is required");
    return this.media.upload(organizationId, file, options);
  }

  @Get()
  @ApiOperation({ summary: "List, search, and paginate organization media assets" })
  list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: MediaAssetsQueryDto,
  ) {
    return this.media.list(organizationId, query);
  }

  @Post("cleanup-orphans")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Remove old storage objects without media metadata" })
  cleanupOrphans(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.media.cleanupOrphans(organizationId);
  }

  @Get(":assetId/signed-url")
  @ApiOperation({ summary: "Create a temporary read URL for this media asset" })
  signedUrl(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    return this.media.getSignedReadUrl(organizationId, assetId);
  }

  @Get(":assetId/content")
  @ApiOperation({ summary: "Stream a media asset through authenticated tenant access" })
  async content(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    const file = await this.media.openContent(organizationId, assetId);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      disposition: `inline; filename="${safeDispositionName(file.originalFileName)}"`,
      length: file.sizeBytes,
    });
  }

  @Get(":assetId")
  @ApiOperation({ summary: "Read media metadata" })
  get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    return this.media.get(organizationId, assetId);
  }

  @Delete(":assetId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Delete a media asset and its storage object" })
  delete(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    return this.media.delete(organizationId, assetId);
  }
}

@ApiTags("Media library delivery")
@Controller("api/media")
export class LocalMediaDeliveryController {
  constructor(private readonly storage: MediaStorageService) {}

  @Get("local")
  @Public()
  @Header("Cache-Control", "private, max-age=60")
  @ApiOperation({ summary: "Deliver a local file using a temporary signed capability URL" })
  async localSignedContent(@Query("token") token?: string) {
    if (!token) throw new BadRequestException("A signed media token is required");
    const file = await this.storage.openLocalSignedToken(token);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.sizeBytes,
    });
  }
}

function safeDispositionName(fileName: string): string {
  return fileName
    .replace(/[\r\n"\\;]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_");
}
