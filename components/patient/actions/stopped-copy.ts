/**
 * What the patient reads when an approved message did not go out. Only a gate refusal is "our safety check"; a
 * provider refusal is the sending service; an ambiguous send must never be described as "nothing was sent".
 */
export function stoppedCopy(reasons: readonly string[]): { title: string; detail: string } {
  if (reasons.includes("send_status_unknown")) {
    return {
      title: "We could not confirm this went out",
      detail: "It may have been sent. It will not be sent a second time. Check your tracker before you try anything else.",
    };
  }
  if (reasons.includes("send_rejected")) {
    return { title: "The sending service turned this message down", detail: "Nothing was sent. You can try again later." };
  }
  return { title: "Our safety check stopped this message", detail: "Nothing was sent. You can try again later, or change the message." };
}
