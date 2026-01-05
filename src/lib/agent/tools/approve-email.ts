import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { db } from '@/lib/db';
import { emailThreads } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmailNow } from '@/lib/integrations/gmail/send';

interface ApproveEmailInput {
  email_id: string;
  action: 'approve' | 'reject' | 'edit';
  edited_body?: string;
  edited_subject?: string;
  edited_to?: string[];
  edited_cc?: string[];
}

export const approveEmailDef: ToolDefinition = {
  name: 'approve_email',
  description: `Handle user's response to an email confirmation request. Use 'approve' to send the email immediately, 'reject' to cancel it, or 'edit' to update content/recipients (you must then send a new confirmation SMS with the updated preview).`,
  input_schema: {
    type: 'object' as const,
    properties: {
      email_id: {
        type: 'string',
        description: 'The ID of the pending email',
      },
      action: {
        type: 'string',
        enum: ['approve', 'reject', 'edit'],
        description: 'Action to take: approve (send immediately), reject (cancel), or edit (update content/recipients)',
      },
      edited_body: {
        type: 'string',
        description: 'New email body (required for edit action)',
      },
      edited_subject: {
        type: 'string',
        description: 'New email subject (optional for edit action)',
      },
      edited_to: {
        type: 'array',
        items: { type: 'string' },
        description: 'New list of recipient email addresses (optional for edit action)',
      },
      edited_cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'New list of CC email addresses (optional for edit action)',
      },
    },
    required: ['email_id', 'action'],
  },
};

export async function approveEmail(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as ApproveEmailInput;

  const email = await db.query.emailThreads.findFirst({
    where: eq(emailThreads.id, params.email_id),
  });

  if (!email) {
    return { success: false, error: 'Email not found' };
  }

  // Check if email is pending (scheduledSendAt is null and sentAt is null)
  if (email.sentAt) {
    return { success: false, error: 'Email has already been sent' };
  }

  if (email.scheduledSendAt) {
    return { success: false, error: 'Email is already scheduled for sending (not pending confirmation)' };
  }

  switch (params.action) {
    case 'approve': {
      // Send the email immediately
      await sendEmailNow(context.userId, params.email_id);

      return {
        success: true,
        data: { message: 'Email approved and sent.' },
      };
    }

    case 'reject': {
      // Delete the pending email
      await db.delete(emailThreads).where(eq(emailThreads.id, params.email_id));

      return {
        success: true,
        data: { message: 'Email cancelled and deleted.' },
      };
    }

    case 'edit': {
      if (!params.edited_body) {
        return { success: false, error: 'edited_body is required for edit action' };
      }

      // Build update object
      const updateData: Record<string, unknown> = {
        bodyText: params.edited_body,
      };
      if (params.edited_subject) {
        updateData.subject = params.edited_subject;
      }
      if (params.edited_to) {
        updateData.toEmails = params.edited_to;
      }
      if (params.edited_cc) {
        updateData.ccEmails = params.edited_cc;
      }

      // Update email content and recipients
      await db.update(emailThreads).set(updateData).where(eq(emailThreads.id, params.email_id));

      // Fetch the updated email to return full details
      const updatedEmail = await db.query.emailThreads.findFirst({
        where: eq(emailThreads.id, params.email_id),
      });

      return {
        success: true,
        data: {
          message: 'Email updated. You must now send a new SMS/Telegram preview to the user for approval.',
          emailId: params.email_id,
          updatedSubject: updatedEmail?.subject,
          updatedBody: updatedEmail?.bodyText,
          to: updatedEmail?.toEmails,
          cc: updatedEmail?.ccEmails,
        },
      };
    }

    default:
      return { success: false, error: 'Invalid action' };
  }
}
