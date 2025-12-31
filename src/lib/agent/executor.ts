import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AgentContext, ToolName } from './types';
import { buildSystemPrompt } from './prompts';
import { toolDefinitions, executeTool } from './tools';

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

const MAX_ITERATIONS = 10;

export async function runAgent(context: AgentContext): Promise<void> {
  console.log('Running agent with context:', {
    userId: context.userId,
    triggerType: context.triggerType,
    schedulingRequestId: context.schedulingRequestId,
  });

  // Get user
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(user, context);

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
      content: buildInitialMessage(context),
    },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`Agent iteration ${iterations}`);

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

    console.log('Agent response:', {
      stopReason: response.stop_reason,
      contentBlocks: response.content.length,
    });

    // Check if we're done
    if (response.stop_reason === 'end_turn') {
      console.log('Agent completed naturally');
      break;
    }

    // Process tool uses
    if (response.stop_reason === 'tool_use') {
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          console.log(`Executing tool: ${block.name}`, block.input);

          const result = await executeTool(
            block.name as ToolName,
            block.input,
            context
          );

          console.log(`Tool result:`, result);

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
      console.warn('Unknown stop reason:', response.stop_reason);
      break;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn('Agent hit max iterations limit');
  }
}

function buildInitialMessage(context: AgentContext): string {
  if (context.triggerType === 'email') {
    const emailData = JSON.parse(context.triggerContent);
    const attendeesInfo = emailData.attendees?.length > 0
      ? `\nExternal party to schedule with: ${emailData.attendees.map((a: { email: string; name?: string }) => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}`
      : '';

    return `New inbound email received. Process this email and take appropriate action.

Email details:
${context.triggerContent}
${attendeesInfo}

The attendees list above shows who the meeting should be scheduled with. Use the available tools to check availability and propose times to the external party.`;
  }

  if (context.triggerType === 'sms') {
    if (context.awaitingResponseType) {
      return `User responded to SMS. Their message: "${context.triggerContent}"

Awaiting response type: ${context.awaitingResponseType}

Process this response and take the appropriate action based on the response type.`;
    }

    return `Received SMS from user: "${context.triggerContent}"

Process this message. Note: There was no pending SMS awaiting response, so this may be a new instruction or query.`;
  }

  return context.triggerContent;
}
