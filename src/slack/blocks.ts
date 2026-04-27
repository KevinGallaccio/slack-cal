export interface ApprovalSuggestion {
  label: string;
  status_text: string;
  emoji: string;
}

export function approvalBlocks(opts: {
  approvalId: string;
  eventTitle: string;
  suggestions: ApprovalSuggestion[];
}): unknown[] {
  const buttons = opts.suggestions.map((s, i) => ({
    type: 'button',
    text: { type: 'plain_text', text: s.label },
    value: `${i}|${opts.approvalId}`,
    action_id: 'status_choice',
  }));

  buttons.push({
    type: 'button',
    text: { type: 'plain_text', text: "Don't post anything" },
    value: `skip|${opts.approvalId}`,
    action_id: 'status_choice',
  });

  buttons.push({
    type: 'button',
    text: { type: 'plain_text', text: 'Custom...' },
    value: `custom|${opts.approvalId}`,
    action_id: 'status_choice',
  });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${opts.eventTitle}* starts in ~1 minute.\nWhat should I show on Slack?`,
      },
    },
    { type: 'actions', elements: buttons },
  ];
}

export function confirmationBlocks(label: string): unknown[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:white_check_mark: Set status to *${label}*.` },
    },
  ];
}

export function customStatusModal(approvalId: string): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: 'custom_status_submit',
    private_metadata: approvalId,
    title: { type: 'plain_text', text: 'Custom status' },
    submit: { type: 'plain_text', text: 'Set' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'status_block',
        label: { type: 'plain_text', text: 'Status text' },
        element: {
          type: 'plain_text_input',
          action_id: 'status_text',
          max_length: 100,
        },
      },
      {
        type: 'input',
        block_id: 'emoji_block',
        label: { type: 'plain_text', text: 'Emoji code (e.g. :house:)' },
        element: {
          type: 'plain_text_input',
          action_id: 'emoji',
          initial_value: ':speech_balloon:',
        },
      },
    ],
  };
}
