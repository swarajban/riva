import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { db } from '@/lib/db';
import { schedulingRequests, Attendee, ProposedTime } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface UpdateRequestInput {
  status?: 'pending' | 'proposing' | 'awaiting_confirmation' | 'confirmed' | 'expired' | 'cancelled' | 'error';
  attendees?: Attendee[];
  meeting_title?: string;
  meeting_length_minutes?: number;
  proposed_times?: ProposedTime[];
  error_message?: string;
}

export const updateRequestDef: ToolDefinition = {
  name: 'update_scheduling_request',
  description: `Update the current scheduling request with new information like status, attendees, or proposed times.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'proposing', 'awaiting_confirmation', 'confirmed', 'expired', 'cancelled', 'error'],
        description: 'New status for the request',
      },
      attendees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['email'],
        },
        description: 'Updated list of attendees',
      },
      meeting_title: {
        type: 'string',
        description: 'Title for the meeting',
      },
      meeting_length_minutes: {
        type: 'number',
        description: 'Duration of the meeting in minutes',
      },
      proposed_times: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
            round: { type: 'number' },
          },
          required: ['start', 'end', 'round'],
        },
        description: 'Times proposed to external party',
      },
      error_message: {
        type: 'string',
        description: 'Error message if status is "error"',
      },
    },
  },
};

export async function updateRequest(input: unknown, context: AgentContext): Promise<ToolResult> {
  if (!context.schedulingRequestId) {
    return { success: false, error: 'No scheduling request in context' };
  }

  const params = input as UpdateRequestInput;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (params.status) updateData.status = params.status;
  if (params.attendees) updateData.attendees = params.attendees;
  if (params.meeting_title) updateData.meetingTitle = params.meeting_title;
  if (params.meeting_length_minutes) updateData.meetingLengthMinutes = params.meeting_length_minutes;
  if (params.proposed_times) updateData.proposedTimes = params.proposed_times;
  if (params.error_message) updateData.errorMessage = params.error_message;

  await db.update(schedulingRequests).set(updateData).where(eq(schedulingRequests.id, context.schedulingRequestId));

  return {
    success: true,
    data: {
      message: 'Scheduling request updated.',
      updates: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
    },
  };
}
