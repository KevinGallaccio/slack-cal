import { describe, it, expect } from 'vitest';
import { approvalBlocks } from '../src/slack/blocks.js';

describe('approvalBlocks', () => {
  it('renders a section + actions row with skip and custom buttons', () => {
    const blocks = approvalBlocks({
      approvalId: 'abc',
      eventTitle: 'chez maman',
      suggestions: [
        { label: 'Out of office', status_text: 'Out of office', emoji: ':palm_tree:' },
      ],
    }) as Array<{ type: string; elements?: Array<{ value: string }> }>;

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe('section');
    expect(blocks[1]?.type).toBe('actions');

    const values = blocks[1]?.elements?.map((e) => e.value) ?? [];
    expect(values).toContain('skip|abc');
    expect(values).toContain('custom|abc');
    expect(values).toContain('0|abc');
  });
});
