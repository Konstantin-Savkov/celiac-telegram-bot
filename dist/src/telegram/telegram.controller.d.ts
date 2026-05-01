import { TelegramService } from './telegram.service';
export declare class TelegramController {
    private readonly telegramService;
    private readonly logger;
    constructor(telegramService: TelegramService);
    handleWebhook(update: any): Promise<{
        ok: boolean;
    }>;
}
