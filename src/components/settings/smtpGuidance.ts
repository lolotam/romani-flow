/**
 * The explanation of the relay precedence, shared by the relay cards.
 *
 * The rule is simple but easy to break, so it is written down once and shown
 * in both places where an administrator can change a relay:
 *
 * - the relay of the signed-in account wins over the relay of the workspace;
 * - the relay of the workspace is the default and is shared by the workspace;
 * - a member relay never changes the workspace relay and never touches
 *   another account;
 * - the designated sender is who sends the scheduled reminders of the
 *   workspace; naming one changes no relay at all.
 *
 * The module holds the text only. Each card renders it in its own markup.
 */

export interface SmtpGuidanceText {
  title: string;
  lines: string[];
}

/** The translated guidance. */
export function smtpGuidance(t: (key: string) => string): SmtpGuidanceText {
  return {
    title: t('settings.smtpGuidance.title'),
    lines: [
      t('settings.smtpGuidance.precedence'),
      t('settings.smtpGuidance.workspaceDefault'),
      t('settings.smtpGuidance.memberScope'),
      t('settings.smtpGuidance.designatedSender'),
    ],
  };
}
