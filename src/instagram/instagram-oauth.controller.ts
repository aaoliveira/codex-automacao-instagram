import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Public } from "../shared/decorators/public.decorator";
import { InstagramOAuthCallbackDto } from "./dto/instagram-oauth-callback.dto";
import { InstagramAccountsService } from "./instagram-accounts.service";

@ApiTags("Instagram OAuth")
@Controller("api/instagram/oauth")
export class InstagramOAuthController {
  constructor(private readonly instagramAccounts: InstagramAccountsService) {}

  @Get("callback")
  @Public()
  @ApiQuery({ name: "code", required: false })
  @ApiQuery({ name: "state", required: true })
  @ApiQuery({ name: "error", required: false })
  @ApiOperation({
    summary: "Complete an Instagram OAuth connection using its one-time state",
  })
  callback(@Query() query: InstagramOAuthCallbackDto) {
    return this.instagramAccounts.handleOAuthCallback(query);
  }
}
