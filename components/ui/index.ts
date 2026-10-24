/**
 * Warm Paper primitives. Import from "@/components/ui".
 * See docs/DESIGN.md for usage rules and app/(design)/system for the live guide.
 */
export { Button, IconButton, buttonVariants, type ButtonProps, type IconButtonProps } from "./button";
export {
  Surface,
  Card,
  CardHeader,
  CardEyebrow,
  CardTitle,
  CardDescription,
  CardFooter,
  surfaceVariants,
  type SurfaceProps,
} from "./card";
export {
  Badge,
  badgeVariants,
  BADGE_BUDGET,
  PATIENT_BADGE_TONES,
  type BadgeProps,
  type PatientBadgeTone,
} from "./badge";
export { SourceChip, type SourceChipProps } from "./source-chip";
export { EvidenceBadge, type EvidenceBadgeProps, type EvidenceLevel } from "./evidence-badge";
export { Input, Textarea, Label, Field, controlClasses, type FieldProps } from "./field";
export { Checkbox, Switch, RadioGroup, RadioGroupItem, ChoiceRow, type ChoiceCardProps } from "./choice";
export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "./select";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./accordion";
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverClose,
} from "./overlay";
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./dialog";
export { ConfirmDialog, type ConfirmDialogProps } from "./dialog";
export { Sheet, SheetClose, type SheetProps } from "./sheet";
export { Toaster, toast } from "./toast";
export { Progress, Skeleton, Separator, Kbd, type ProgressProps } from "./feedback";
export {
  EmptyState,
  Stepper,
  Stat,
  StatGroup,
  AvatarInitials,
  type EmptyStateProps,
  type StepperProps,
  type StepperStep,
  type StepState,
  type StatProps,
  type AvatarInitialsProps,
} from "./display";
export { useMediaQuery, DESKTOP_QUERY } from "./use-media-query";

/* v2 primitives (docs/DESIGN-v2.md 6). */
export { List, ListRow, type ListProps, type ListRowProps } from "./list-row";
export { ActionCard, type ActionCardProps } from "./action-card";
export { PageHeader, BackLink, type PageHeaderProps, type BackLinkProps } from "./page-header";
export { Details, type DetailsProps } from "./details";
export { TwoPane, WIDE_QUERY, type TwoPaneProps } from "./two-pane";
export { ErrorSummary, type ErrorSummaryItem, type ErrorSummaryProps } from "./error-summary";
export {
  Question,
  SummaryList,
  type QuestionProps,
  type QuestionControlProps,
  type SummaryListProps,
  type SummaryListRow,
} from "./question";
export { LoadingState, CheckedMark, SLOW_LOADING_MS, type LoadingStateProps, type CheckedMarkProps } from "./states";
export { JudgeOnly, PatientOnly, useActiveView, useIsJudgeView } from "../view-mode/ViewOnly";
