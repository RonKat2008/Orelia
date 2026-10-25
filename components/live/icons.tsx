import {
  Bot, CalendarClock, CheckCircle2, ClipboardList, FileCheck2, FileText, Globe, ListTodo, Mail, MessageSquare, MousePointerClick,
  Phone, PhoneCall, PhoneIncoming, PhoneOff, Reply, Send, ShieldCheck, XCircle, type LucideIcon,
} from "lucide-react";
import type { ActivityKind, LaneChannel } from "@/lib/activity/types";

export const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  agent_started: Bot, agent_finished: CheckCircle2, agent_failed: XCircle, contact_approved: ShieldCheck,
  email_sent: Send, reply_received: Reply, call_queued: Phone, call_ringing: PhoneIncoming, call_connected: PhoneCall,
  call_turn: MessageSquare, call_ended: PhoneOff, browser_step: MousePointerClick, application_filled: FileText,
  application_submitted: FileCheck2, task_created: ListTodo, follow_up_scheduled: CalendarClock, follow_up_sent: Send, agent_decision: ClipboardList,
};

export const CHANNEL_ICON: Record<LaneChannel, LucideIcon> = { email: Mail, voice: Phone, web: Globe };
export const CHANNEL_LABEL: Record<LaneChannel, string> = { email: "Email", voice: "Phone call", web: "Online form" };
