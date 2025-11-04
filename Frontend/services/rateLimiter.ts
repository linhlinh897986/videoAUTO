interface RateLimits {
  rpm: number; // requests per minute
  tpm: number; // tokens per minute
}

interface RequestLog {
  timestamp: number;
  tokens: number;
}

const MINUTE = 60 * 1000;

export class RateLimiter {
  private limits: Map<string, RateLimits>;
  private history: Map<string, RequestLog[]>;

  constructor() {
    this.limits = new Map();
    this.history = new Map();
  }

  public setLimits(model: string, limits: RateLimits) {
    this.limits.set(model, limits);
    if (!this.history.has(model)) {
      this.history.set(model, []);
    }
  }

  private prune(model: string) {
    const now = Date.now();
    const modelHistory = this.history.get(model) || [];
    const recentHistory = modelHistory.filter(
      (req) => now - req.timestamp < MINUTE
    );
    this.history.set(model, recentHistory);
  }

  private checkLimits(model: string, tokens: number): { canProceed: boolean, waitTime: number } {
    this.prune(model);
    const modelLimits = this.limits.get(model);
    if (!modelLimits) {
      return { canProceed: true, waitTime: 0 };
    }

    const modelHistory = this.history.get(model) || [];
    const currentRequests = modelHistory.length;
    const currentTokens = modelHistory.reduce((sum, req) => sum + req.tokens, 0);

    if (currentRequests >= modelLimits.rpm) {
      const oldestRequest = modelHistory[0];
      const waitTime = MINUTE - (Date.now() - oldestRequest.timestamp);
      return { canProceed: false, waitTime: Math.max(0, waitTime) + 100 };
    }

    if (currentTokens + tokens > modelLimits.tpm) {
      const oldestRequest = modelHistory[0];
      if (oldestRequest) {
        const waitTime = MINUTE - (Date.now() - oldestRequest.timestamp);
        return { canProceed: false, waitTime: Math.max(0, waitTime) + 100 };
      }
      return { canProceed: false, waitTime: MINUTE };
    }

    return { canProceed: true, waitTime: 0 };
  }

  public async acquire(model: string, tokens: number): Promise<void> {
    const modelLimits = this.limits.get(model);
    if (!modelLimits) {
      return;
    }

    if (tokens > modelLimits.tpm) {
        console.warn(`Yêu cầu với ${tokens} token vượt quá giới hạn mỗi phút là ${modelLimits.tpm} cho model ${model}. Sẽ phải chờ đợi.`);
    }

    while (true) {
      const { canProceed, waitTime } = this.checkLimits(model, tokens);
      if (canProceed) {
        this.logRequest(model, tokens);
        return;
      }
      console.log(`Đã đạt đến giới hạn tỷ lệ cho ${model}. Đang chờ ${Math.round(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  private logRequest(model: string, tokens: number) {
    const modelHistory = this.history.get(model) || [];
    modelHistory.push({ timestamp: Date.now(), tokens });
    this.history.set(model, modelHistory);
  }
}

export const geminiRateLimiter = new RateLimiter();

// Đặt cấu hình giới hạn theo yêu cầu của người dùng
geminiRateLimiter.setLimits('gemini-2.5-pro', { rpm: 4, tpm: 60000 });
geminiRateLimiter.setLimits('gemini-2.5-flash', { rpm: 8, tpm: 60000 });
