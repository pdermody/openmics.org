export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailAdapter = {
  send(message: EmailMessage): Promise<void>;
};
