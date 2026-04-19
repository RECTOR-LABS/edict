import { Resend } from "resend";
import { render } from "@react-email/render";
import type { ReactElement } from "react";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "edict@rectorspace.com";
const devPrint = process.env.DEV_PRINT_MAGIC_LINKS === "true";
const client = apiKey ? new Resend(apiKey) : null;

export async function sendMail(args: {
  to: string;
  subject: string;
  template: ReactElement;
}) {
  const html = await render(args.template);

  if (!client || devPrint) {
    console.warn("[mail:dev]", {
      to: args.to,
      subject: args.subject,
      html_length: html.length,
    });
    return { id: "dev-skip" };
  }

  const res = await client.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html,
  });

  if (res.error !== null) {
    throw new Error(`resend error: ${res.error.message}`);
  }

  return { id: res.data.id };
}
