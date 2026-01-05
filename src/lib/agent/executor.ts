import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AgentContext, ToolName } from './types';
import { buildSystemPrompt } from './prompts';
import { toolDefinitions, executeTool } from './tools';
import { getConversationHistory } from '@/lib/integrations/notification/service';
import { logger } from '@/lib/utils/logger';

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

const MAX_ITERATIONS = 10;

export async function runAgent(context: AgentContext): Promise<void> {
  logger.info('Running agent', {
    userId: context.userId,
    assistantId: context.assistantId,
    triggerType: context.triggerType,
    schedulingRequestId: context.schedulingRequestId,
  });

  // Get user with assistant
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
    with: { assistant: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.assistant) {
    throw new Error('User has no assistant configured');
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(user, user.assistant, context);

  // Convert our tool definitions to Anthropic format
  const tools: Anthropic.Messages.Tool[] = toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  // Initial message from the trigger
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content: await buildInitialMessage(context),
    },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    logger.info('Agent iteration', { iteration: iterations });

    // Call Claude with optional extended thinking
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.useExtendedThinking ? 16000 : 4096,
      system: systemPrompt,
      tools,
      messages,
      ...(config.anthropic.useExtendedThinking && {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: config.anthropic.thinkingBudget,
        },
      }),
    });

    logger.info('Agent response', {
      stopReason: response.stop_reason,
      contentBlocks: response.content.length,
    });

    // Check if we're done
    if (response.stop_reason === 'end_turn') {
      logger.info('Agent completed naturally');
      break;
    }

    // Process tool uses
    if (response.stop_reason === 'tool_use') {
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          logger.info('Executing tool', { tool: block.name, input: block.input });

          const result = await executeTool(block.name as ToolName, block.input, context);

          logger.info('Tool result', { tool: block.name, result });

          // Critical tool failure - stop execution entirely
          if (!result.success && block.name === 'send_sms_to_user') {
            throw new Error(`Failed to notify user: ${result.error}`);
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
            is_error: !result.success,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      // Unknown stop reason
      logger.warn('Unknown stop reason', { stopReason: response.stop_reason });
      break;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    logger.warn('Agent hit max iterations limit', { maxIterations: MAX_ITERATIONS });
  }
}

async function buildInitialMessage(context: AgentContext): Promise<string> {
  if (context.triggerType === 'email') {
    const emailData = JSON.parse(context.triggerContent);
    const attendeesInfo =
      emailData.attendees?.length > 0
        ? `\nExternal party to schedule with: ${emailData.attendees.map((a: { email: string; name?: string }) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')}`
        : '';

    return `New inbound email received. Process this email and take appropriate action.

Email details:
${context.triggerContent}
${attendeesInfo}

The attendees list above shows who the meeting should be scheduled with. Use the available tools to check availability and propose times to the external party.`;
  }

  if (context.triggerType === 'sms') {
    // Fetch conversation history for this scheduling request
    let conversationSection = '';
    if (context.schedulingRequestId) {
      const history = await getConversationHistory(context.schedulingRequestId);
      if (history.length > 0) {
        const formattedHistory = history
          .map((msg) => `[${msg.direction === 'outbound' ? 'Assistant' : 'User'}]: ${msg.body}`)
          .join('\n');
        conversationSection = `\n\n## SMS conversation history:\n${formattedHistory}`;
      }
    }

    if (context.awaitingResponseType) {
      return `User responded to SMS. Their message: "${context.triggerContent}"

Awaiting response type: ${context.awaitingResponseType}${conversationSection}

Process this response and take the appropriate action based on the response type.`;
    }

    return `Received SMS from user: "${context.triggerContent}"${conversationSection}

Process this message. Note: There was no pending SMS awaiting response, so this may be a new instruction or query.`;
  }

  return context.triggerContent;
}
