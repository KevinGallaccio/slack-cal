import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { SYSTEM_PROMPT } from './prompt.js';
import type { ClassificationAction } from '../db/repos/classifications.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export interface ClassifierInput {
  calendar_source: 'work' | 'personal';
  event_title: string;
  event_description: string;
  event_location: string;
  attendees: string[];
  start: string;
  end: string;
}

export interface ClassifierOutput {
  action: ClassificationAction;
  status_text: string;
  emoji: string;
  reason: string;
  suggestions?: { label: string; status_text: string; emoji: string }[];
}

const MODEL = 'claude-haiku-4-5';

export async function classify(input: ClassifierInput): Promise<ClassifierOutput> {
  const userMessage =
    `${JSON.stringify(input, null, 2)}\n\nOutput valid JSON only, no prose.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = parseJsonLoose(text);
  validate(parsed);

  logger.debug(
    {
      event: input.event_title,
      action: parsed.action,
      cache_read: response.usage?.cache_read_input_tokens,
      cache_creation: response.usage?.cache_creation_input_tokens,
    },
    'classified event'
  );

  return parsed;
}

function parseJsonLoose(text: string): ClassifierOutput {
  const trimmed = text.trim();
  // strip code fences if present
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(fenceStripped) as ClassifierOutput;
  } catch {
    // fallback: extract first {...} block
    const match = fenceStripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`classifier output is not JSON: ${trimmed.slice(0, 200)}`);
    return JSON.parse(match[0]) as ClassifierOutput;
  }
}

function validate(o: ClassifierOutput): void {
  if (!['set', 'ask', 'skip'].includes(o.action)) {
    throw new Error(`invalid action: ${o.action}`);
  }
  if (typeof o.status_text !== 'string' || typeof o.emoji !== 'string') {
    throw new Error('classifier output missing status_text or emoji');
  }
  if (typeof o.reason !== 'string') {
    throw new Error('classifier output missing reason');
  }
}
