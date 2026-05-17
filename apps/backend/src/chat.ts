/**
 * Chat helper for streaming LLM responses.
 * Used by the /chat endpoint for rules clarification.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { LlmProvider } from '@bgb/shared';
import { makeLlm } from './llm.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  messages: ChatMessage[];
}

/**
 * Convert ChatMessage[] to LangChain BaseMessage[].
 */
function toBaseMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return new HumanMessage(msg.content);
    } else if (msg.role === 'assistant') {
      return new AIMessage(msg.content);
    } else {
      // System role — supported natively across all providers in @langchain/core ^0.3.
      return new SystemMessage(msg.content);
    }
  });
}

/**
 * Stream chat response from LLM, yielding each token.
 * @param opts - Chat options with provider, model, apiKey, and messages.
 * @returns AsyncIterable of string tokens.
 */
export async function* chatStream(opts: ChatOptions): AsyncIterable<string> {
  const { provider, model, apiKey, messages } = opts;

  const llm = await makeLlm(provider, model, apiKey);
  const baseMessages = toBaseMessages(messages);

  // Call the LLM's stream method
  const stream = await llm.stream(baseMessages);

  // Yield each token as it arrives
  for await (const chunk of stream) {
    // chunk is a BaseMessageChunk with .content
    if (chunk.content) {
      yield String(chunk.content);
    }
  }
}
