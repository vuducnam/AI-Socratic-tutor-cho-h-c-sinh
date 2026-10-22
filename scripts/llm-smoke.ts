import 'dotenv/config';
import { z } from 'zod';
import { callLlm, setGatewayDependencies } from '@/server/llm/llm-gateway';
import { loadModelsConfig } from '@/server/llm/model-config';
import { OpenRouterProvider } from '@/server/llm/providers/openrouter-provider';

// Gọi thật một lượt rất nhỏ qua LlmGateway (vai trò `smoke`, không có dữ liệu học sinh) để kiểm
// llm_calls ghi đủ tokens, cost, latency, và structured output.
// Dùng: pnpm llm:smoke              (Claude API trực tiếp, fallback như thật)
//       pnpm llm:smoke openrouter   (chỉ đường OpenRouter, để kiểm đường dự phòng)
async function main() {
  if (process.argv[2] === 'openrouter') {
    const config = loadModelsConfig();
    const provider = new OpenRouterProvider({
      apiKey: process.env[config.providers.openrouter.api_key_env] ?? '',
      baseUrl: config.providers.openrouter.base_url,
    });
    setGatewayDependencies({ primary: provider, fallback: null });
  }
  const result = await callLlm({
    purpose: 'smoke',
    role: 'smoke',
    promptVersion: 'smoke/inline',
    system: [{ text: 'Trả lời bằng JSON {"word": "<một từ tiếng Việt>"}.' }],
    messages: [{ role: 'user', content: 'Màu của bầu trời ban ngày?' }],
    responseSchema: z.object({ word: z.string() }),
  });
  console.log(
    JSON.stringify({ parsed: result.parsed, provider: result.provider, model: result.model, costUsd: result.costUsd, llmCallId: result.llmCallId }),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
