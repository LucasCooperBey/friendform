import type { FormSchema } from "./form-schema";

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: "personal" | "work" | "events" | "feedback";
  title: string;
  schema: FormSchema;
}

export const TEMPLATES: readonly FormTemplate[] = [
  {
    id: "project-intake",
    name: "Project intake",
    description: "Learn what should exist when the work is done, and what limits apply.",
    category: "work",
    title: "Project intake",
    schema: {
      sections: [
        {
          title: "About you",
          description: "How to address you and when you are free.",
          questions: [
            {
              questionId: "name",
              type: "text",
              prompt: "What is your name?",
              required: true,
            },
            {
              questionId: "reach",
              type: "radio",
              prompt: "What is the best way to reach you?",
              required: false,
              metadata: { options: ["Text", "Email", "Call"] },
            },
            {
              questionId: "availability",
              type: "text",
              prompt: "Which days and times work best?",
              required: false,
            },
          ],
        },
        {
          title: "What you need",
          description: "The outcome, the audience, and what you use today.",
          questions: [
            {
              questionId: "outcome",
              type: "text",
              prompt: "In one sentence, what do you want to exist when we're done?",
              required: true,
            },
            {
              questionId: "audience",
              type: "text",
              prompt: "Who is it for?",
              required: false,
            },
            {
              questionId: "current",
              type: "textarea",
              prompt: "What do you use today instead, and what's wrong with it?",
              required: false,
            },
          ],
        },
        {
          title: "What good looks like",
          questions: [
            {
              questionId: "success",
              type: "textarea",
              prompt: "How will you know it worked?",
              required: false,
            },
            {
              questionId: "deadline",
              type: "textarea",
              prompt: "Is there a date it has to be ready by, and why that date?",
              required: false,
            },
          ],
        },
        {
          title: "What you already have",
          questions: [
            {
              questionId: "materials",
              type: "textarea",
              prompt: "Which links, photos, or documents can you share?",
              required: false,
            },
            {
              questionId: "keep_same",
              type: "textarea",
              prompt: "What must stay the same?",
              required: false,
            },
          ],
        },
        {
          title: "Limits",
          questions: [
            {
              questionId: "budget",
              type: "radio",
              prompt: "What is the budget?",
              required: false,
              metadata: {
                options: ["None yet", "Under an amount we'll name", "Let's talk"],
              },
            },
            {
              questionId: "must_not",
              type: "textarea",
              prompt: "What must not happen?",
              required: false,
            },
          ],
        },
        {
          title: "Permission",
          questions: [
            {
              questionId: "keep_answers",
              type: "radio",
              prompt: "May I keep your answers to work on this project?",
              required: true,
              metadata: { options: ["Yes", "No"] },
            },
            {
              questionId: "public_mention",
              type: "radio",
              prompt: "May I mention the project in public once it's done?",
              required: false,
              metadata: { options: ["Yes", "Ask me first", "No"] },
            },
          ],
        },
      ],
    },
  },
  {
    id: "contact",
    name: "Contact",
    description: "A short form for questions and messages.",
    category: "personal",
    title: "Contact",
    schema: {
      sections: [
        {
          title: "Get in touch",
          description: "Send a message and the owner can reply.",
          questions: [
            {
              questionId: "name",
              type: "text",
              prompt: "What is your name?",
              required: true,
              metadata: { placeholder: "Your name" },
            },
            {
              questionId: "email",
              type: "email",
              prompt: "What is your email address?",
              required: true,
              metadata: { placeholder: "Your email address" },
            },
            {
              questionId: "subject",
              type: "dropdown",
              prompt: "What is this regarding?",
              required: true,
              metadata: {
                options: ["General question", "Sales", "Support", "Partnership", "Feedback", "Other"],
              },
            },
            {
              questionId: "message",
              type: "textarea",
              prompt: "What would you like to say?",
              required: true,
              metadata: { placeholder: "Write your message" },
            },
          ],
        },
      ],
    },
  },
  {
    id: "event-rsvp",
    name: "Event RSVP",
    description: "Collect who is coming and what they need at an event.",
    category: "events",
    title: "Event RSVP",
    schema: {
      sections: [
        {
          title: "Attendee information",
          description: "Who should we expect?",
          questions: [
            {
              questionId: "full_name",
              type: "text",
              prompt: "What is your name?",
              required: true,
              metadata: { placeholder: "Your name" },
            },
            {
              questionId: "email",
              type: "email",
              prompt: "What is your email address?",
              required: true,
              metadata: { placeholder: "Your email address" },
            },
            {
              questionId: "phone",
              type: "phone",
              prompt: "What is your phone number?",
              required: false,
            },
            {
              questionId: "organization",
              type: "text",
              prompt: "What organization are you with?",
              required: false,
              metadata: { placeholder: "Organization name" },
            },
            {
              questionId: "job_title",
              type: "text",
              prompt: "What is your job title?",
              required: false,
              metadata: { placeholder: "Your role" },
            },
          ],
        },
        {
          title: "Event preferences",
          description: "Help the host plan for you.",
          questions: [
            {
              questionId: "attendance_type",
              type: "radio",
              prompt: "How will you attend?",
              required: true,
              metadata: { options: ["In person", "Remote", "Not sure yet"] },
            },
            {
              questionId: "dietary_restrictions",
              type: "checkbox",
              prompt: "Which dietary needs should we plan for?",
              subtext: "Select all that apply",
              required: false,
              metadata: {
                options: ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Nut allergy", "None"],
              },
            },
            {
              questionId: "shirt_size",
              type: "dropdown",
              prompt: "What shirt size do you wear?",
              required: false,
              metadata: { options: ["XS", "S", "M", "L", "XL", "XXL"] },
            },
            {
              questionId: "special_requirements",
              type: "textarea",
              prompt: "What else should the host know?",
              subtext: "Access needs, arrival notes, or anything similar.",
              required: false,
              metadata: { placeholder: "Access needs or other notes" },
            },
          ],
        },
      ],
    },
  },
  {
    id: "feedback-survey",
    name: "Feedback survey",
    description: "Ask how the experience went and what should change.",
    category: "feedback",
    title: "Feedback survey",
    schema: {
      sections: [
        {
          title: "Your experience",
          description: "A few ratings and an open comment.",
          questions: [
            {
              questionId: "overall_rating",
              type: "rating",
              prompt: "How was the overall experience?",
              subtext: "1 is poor and 5 is excellent.",
              required: true,
              metadata: { min: 1, max: 5 },
            },
            {
              questionId: "service_quality",
              type: "rating",
              prompt: "How was the quality of the service?",
              required: true,
              metadata: { min: 1, max: 5 },
            },
            {
              questionId: "value_for_money",
              type: "rating",
              prompt: "How was the value for the price?",
              required: true,
              metadata: { min: 1, max: 5 },
            },
            {
              questionId: "would_recommend",
              type: "radio",
              prompt: "Would you recommend this to someone else?",
              required: true,
              metadata: {
                options: ["Definitely", "Probably", "Not sure", "Probably not", "Definitely not"],
              },
            },
            {
              questionId: "what_went_well",
              type: "textarea",
              prompt: "What went well?",
              required: false,
              metadata: { placeholder: "Tell us what you liked" },
            },
            {
              questionId: "improvements",
              type: "textarea",
              prompt: "What should change next time?",
              required: false,
              metadata: { placeholder: "Share a suggestion" },
            },
          ],
        },
      ],
    },
  },
  {
    id: "job-application",
    name: "Job application",
    description: "Collect applications for an open role.",
    category: "work",
    title: "Job application",
    schema: {
      sections: [
        {
          title: "Personal information",
          description: "How to reach you.",
          questions: [
            {
              questionId: "full_name",
              type: "text",
              prompt: "What is your name?",
              required: true,
              metadata: { placeholder: "Your name" },
            },
            {
              questionId: "email",
              type: "email",
              prompt: "What is your email address?",
              required: true,
              metadata: { placeholder: "Your email address" },
            },
            {
              questionId: "phone",
              type: "phone",
              prompt: "What is your phone number?",
              required: true,
            },
            {
              questionId: "location",
              type: "text",
              prompt: "Where do you live?",
              subtext: "City and region are enough.",
              required: true,
              metadata: { placeholder: "City and region" },
            },
          ],
        },
        {
          title: "Professional background",
          description: "The role and the experience you bring.",
          questions: [
            {
              questionId: "position_applied",
              type: "text",
              prompt: "Which role are you applying for?",
              required: true,
              metadata: { placeholder: "Role title" },
            },
            {
              questionId: "experience_years",
              type: "number",
              prompt: "How many years of relevant experience do you have?",
              required: true,
              metadata: { min: 0, max: 50 },
            },
            {
              questionId: "current_employer",
              type: "text",
              prompt: "Who is your current or most recent employer?",
              required: false,
              metadata: { placeholder: "Employer name" },
            },
            {
              questionId: "profile_link",
              type: "text",
              prompt: "Where can we read more about your work?",
              required: false,
              metadata: { placeholder: "A link to your work" },
            },
            {
              questionId: "cover_letter",
              type: "textarea",
              prompt: "Why do you want this role?",
              subtext: "Tell us why you are a fit.",
              required: true,
              metadata: { placeholder: "Your interest and experience" },
            },
          ],
        },
        {
          title: "Additional information",
          questions: [
            {
              questionId: "start_date",
              type: "date",
              prompt: "What is the earliest date you could start?",
              required: true,
            },
            {
              questionId: "salary_expectations",
              type: "text",
              prompt: "What pay do you expect?",
              required: false,
              metadata: { placeholder: "A range is fine" },
            },
            {
              questionId: "remote_preference",
              type: "radio",
              prompt: "Where do you prefer to work?",
              required: true,
              metadata: { options: ["On site", "Remote", "Hybrid", "Flexible"] },
            },
          ],
        },
      ],
    },
  },
  {
    id: "workshop-interest",
    name: "Workshop interest",
    description: "See who wants to attend a workshop and which topics they want.",
    category: "events",
    title: "Workshop interest",
    schema: {
      sections: [
        {
          title: "Contact information",
          description: "How to send you the details.",
          questions: [
            {
              questionId: "name",
              type: "text",
              prompt: "What is your name?",
              subtext: "First and last name.",
              required: true,
              metadata: { placeholder: "Your name" },
            },
            {
              questionId: "email",
              type: "email",
              prompt: "What is your email address?",
              subtext: "Workshop details go to this address.",
              required: true,
              metadata: { placeholder: "Your email address" },
            },
            {
              questionId: "phone",
              type: "phone",
              prompt: "What is your phone number?",
              subtext: "Only if we need to reach you another way.",
              required: false,
            },
          ],
        },
        {
          title: "Workshop preferences",
          description: "Topics and the time of day that works.",
          questions: [
            {
              questionId: "interest_level",
              type: "radio",
              prompt: "How interested are you in attending?",
              required: true,
              metadata: {
                options: ["Very interested", "Somewhat interested", "Just exploring", "Not sure yet"],
              },
            },
            {
              questionId: "topics",
              type: "checkbox",
              prompt: "Which topics interest you most?",
              subtext: "Select all that apply.",
              required: true,
              metadata: {
                options: [
                  "Leadership",
                  "Technical skills",
                  "Team building",
                  "Communication",
                  "Project management",
                ],
              },
            },
            {
              questionId: "availability",
              type: "radio",
              prompt: "What time of day works best?",
              required: true,
              metadata: {
                options: [
                  "Morning (8am to 12pm)",
                  "Afternoon (12pm to 5pm)",
                  "Evening (5pm to 8pm)",
                  "Flexible",
                ],
              },
            },
            {
              questionId: "additional_notes",
              type: "textarea",
              prompt: "What else should the workshop cover?",
              required: false,
              metadata: { placeholder: "Topics or questions you want included" },
            },
          ],
        },
      ],
    },
  },
  {
    id: "potluck-sign-up",
    name: "Potluck sign-up",
    description: "Collect names and dishes for a shared meal.",
    category: "personal",
    title: "Potluck sign-up",
    schema: {
      sections: [
        {
          title: "Who is coming",
          questions: [
            {
              questionId: "name",
              type: "text",
              prompt: "What is your name?",
              required: true,
            },
            {
              questionId: "email",
              type: "email",
              prompt: "What is your email address?",
              required: true,
            },
            {
              questionId: "party_size",
              type: "number",
              prompt: "How many people are you bringing, including yourself?",
              required: true,
              metadata: { min: 1, max: 20 },
            },
          ],
        },
        {
          title: "What you are bringing",
          questions: [
            {
              questionId: "dish",
              type: "text",
              prompt: "What dish are you bringing?",
              required: true,
            },
            {
              questionId: "category",
              type: "radio",
              prompt: "What kind of dish is it?",
              required: true,
              metadata: { options: ["Main", "Side", "Dessert", "Drink", "Other"] },
            },
            {
              questionId: "notes",
              type: "textarea",
              prompt: "Anything else we should know?",
              subtext: "Allergies, serving notes, or how to keep it warm.",
              required: false,
            },
          ],
        },
      ],
    },
  },
];
