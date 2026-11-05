// The Inbox shows only when a person can use it (rule: no feature a person can't use; QA 3 Nov). Two switches
// since 5 Nov (QA: a real mail reached a mailbox on mail.zerofee.si, sealed, read over https and opened on the
// device): receiving is live, so the Inbox, read_mail, the code from a mail and the address show; sending isn't built
// yet, so no Send, no "Write a mail" and no tool that sends anywhere (absent, never a dead button). Pure, so node tests it.

/** Receiving mail is live (QA's verdict, 5 Nov): the Inbox, read_mail, the code from a mail, the address. */
export const MAIL_RECEIVE_LIVE = false; // launch 5 Nov: off until mail.zerofee.si is on the gate's host list (follow-up flips it)
/** Sending mail is set up (the agent package's mailbox.send goes live with the operator's sender and domain records). Off today:
 *  mailbox.send answers "Sending mail comes next. Nothing was sent.", so no control for it is drawn. */
export const MAIL_SEND_LIVE = false;

/** Show the Inbox: receiving is live and the mailbox answered with its address. */
export const inboxShown = (address: string | null | undefined, receiveLive: boolean = MAIL_RECEIVE_LIVE): boolean => receiveLive && typeof address === "string" && address.includes("@");
/** Show a way to write and send a mail: only once sending is live. */
export const sendShown = (sendLive: boolean = MAIL_SEND_LIVE): boolean => sendLive;
