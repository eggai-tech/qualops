'use strict';

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
}

export function hasJudgeKeys(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

export async function callAnthropic(messages: LLMMessage[], model = 'claude-sonnet-4-6'): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0,
    messages,
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type');
  return block.text;
}

export async function callOpenAI(messages: LLMMessage[], model = 'gpt-4o'): Promise<string> {
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function callJudgeLLM(messages: LLMMessage[]): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(messages);
  }
  if (process.env.OPENAI_API_KEY) {
    return callOpenAI(messages);
  }
  throw new Error('No judge LLM API key available');
}
