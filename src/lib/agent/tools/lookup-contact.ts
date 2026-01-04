import { google } from 'googleapis';
import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { getAuthenticatedClient } from '@/lib/auth/google-oauth';

interface LookupContactInput {
  email: string;
}

export const lookupContactDef: ToolDefinition = {
  name: 'lookup_contact',
  description: `Look up contact information by email address using Google Contacts/People API.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      email: {
        type: 'string',
        description: 'Email address to look up',
      },
    },
    required: ['email'],
  },
};

export async function lookupContact(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as LookupContactInput;

  try {
    const oauth2Client = await getAuthenticatedClient(context.assistantId);
    const people = google.people({ version: 'v1', auth: oauth2Client });

    // Search for the contact
    const response = await people.people.searchContacts({
      query: params.email,
      readMask: 'names,emailAddresses,phoneNumbers,organizations',
    });

    const results = response.data.results || [];

    if (results.length === 0) {
      return {
        success: true,
        data: {
          found: false,
          message: `No contact found for ${params.email}`,
        },
      };
    }

    // Get the first match
    const person = results[0].person;
    const names = person?.names || [];
    const emails = person?.emailAddresses || [];
    const phones = person?.phoneNumbers || [];
    const orgs = person?.organizations || [];

    return {
      success: true,
      data: {
        found: true,
        name: names[0]?.displayName || null,
        firstName: names[0]?.givenName || null,
        lastName: names[0]?.familyName || null,
        emails: emails.map((e) => e.value),
        phones: phones.map((p) => p.value),
        organization: orgs[0]?.name || null,
        title: orgs[0]?.title || null,
      },
    };
  } catch (error) {
    console.error('Contact lookup error:', error);
    return {
      success: true,
      data: {
        found: false,
        message: `Could not look up contact: ${params.email}`,
      },
    };
  }
}
