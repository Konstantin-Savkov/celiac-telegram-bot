import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { TelegramService } from './telegram.service';

@ApiTags('Webhook')
@Controller('webhook')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegramService: TelegramService) {}

  @Post('telegram')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram webhook endpoint' })
  @ApiBody({ description: 'Telegram Update object', type: Object })
  async handleWebhook(@Body() update: any): Promise<{ ok: boolean }> {
    this.logger.log(`Received update: ${update?.update_id}`);
    try {
      await this.telegramService.handleUpdate(update);
    } catch (error) {
      this.logger.error(`Error handling update: ${error.message}`, error.stack);
    }
    return { ok: true };
  }
}
