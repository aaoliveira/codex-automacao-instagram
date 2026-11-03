import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { Public } from "../shared/decorators/public.decorator";
import { MockInstagramWebhookDto } from "./dto/mock-instagram-webhook.dto";
import { InstagramWebhookSecurityService } from "./instagram-webhook-security.service";
import { InstagramWebhooksService } from "./instagram-webhooks.service";

@Controller("api/webhooks/instagram")
@ApiTags("Instagram Webhooks")
export class InstagramWebhooksController {
  constructor(
    private readonly security: InstagramWebhookSecurityService,
    private readonly webhooks: InstagramWebhooksService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "Verify the Meta webhook subscription" })
  @ApiQuery({ name: "hub.mode", required: true })
  @ApiQuery({ name: "hub.verify_token", required: true })
  @ApiQuery({ name: "hub.challenge", required: true })
  verifySubscription(
    @Query("hub.mode") mode: string | undefined,
    @Query("hub.verify_token") token: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
    @Res() response: Response,
  ) {
    const acceptedChallenge = this.security.verifyChallenge(
      mode,
      token,
      challenge,
    );
    return response
      .status(HttpStatus.OK)
      .type("text/plain")
      .send(acceptedChallenge);
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept a signed Meta Instagram notification" })
  @ApiHeader({ name: "X-Hub-Signature-256", required: true })
  async receiveMetaEvent(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Body() payload: unknown,
  ) {
    this.security.verifySignature(request.rawBody, signature);
    return this.webhooks.receiveMetaEvent(payload);
  }

  @Post("mock")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Generate a local MOCK Instagram webhook event" })
  async receiveMockEvent(@Body() payload: MockInstagramWebhookDto) {
    if (this.config.get<string>("NODE_ENV") === "production") {
      throw new ForbiddenException("Mock webhook events are disabled");
    }
    return this.webhooks.receiveMockEvent(payload);
  }
}
