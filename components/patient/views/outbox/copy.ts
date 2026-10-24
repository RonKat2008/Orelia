/** Every patient-facing string of the outbox view, in one place (scored by the readability script). */
export const OUTBOX_COPY = {
  title: "Messages to check",
  lede: "Read each message. Nothing is sent until you say OK.",
  loading: "Loading your messages",
  emptyTitle: "Nothing to check right now",
  emptyBody: "When a message is ready for you to read, it will show up here.",
  backLink: "Back to your case",
  consentTitle: "We need one more answer first",
  consentBody: (name: string) => `Tell ${name} what they may see, then we'll write the email.`,
  consentPrimary: "Choose what to share",
  missingTitle: "We couldn't find this case",
  missingBody: "It may have been removed, or the link may be incomplete.",
  missingLink: "Start again",
  errorTitle: "We couldn't load your messages just now",
  errorRetry: "Try again",
  fallbackName: "them",
} as const;
